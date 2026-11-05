// Kerrin Fesselschatten hooks (chain-shadow assassin). Passive Chain Mark (ability hits on champions stack marks, +4 % damage
// each), Q hook (pulls her to the unit hit, or over a wall), E next-auto root, R leap + execute at three marks below a
// threshold. Behaviour list: docs/champion-hooks.md; tunables: kerrin.values.json. All state lives in sim.state.
import { query } from 'bitecs';
import type { Sim } from '../sim';
import { isStructure, sec } from '../types';
import { dealDamage } from '../damage';
import { walkable } from '../map';
import { champAbil, landingPoint, leapTo, rv } from '../systems/abilities';
import { projectileSource } from '../systems/projectiles';
import type { ChampionHooks, ChampionVisuals, UnitMark, VisualObject } from './hooks';
import { hookState, isChampLike, peekState } from './util';
import V from '../../data/champions/kerrin.values.json';

interface Mark {
  n: number;
  until: number;
  serial: number;
}
/** Q wall anchor: the hook stopped at a wall at distance `d` along (dx, dy) from (ox, oy). */
interface Anchor {
  ox: number;
  oy: number;
  dx: number;
  dy: number;
  d: number;
  tick: number;
}
/** Visual chain while she is pulled: from her position to (x, y) until `until`. */
interface Pull {
  x: number;
  y: number;
  until: number;
  total: number;
}

const MARKS = 'kerrinMarks';
const ANCHOR = 'kerrinAnchor';
const PULL = 'kerrinPull';

const marksOf = (sim: Sim, eid: number): Map<number, Mark> => {
  const m = hookState<Map<number, Mark>>(sim, MARKS);
  let r = m.get(eid);
  if (!r) m.set(eid, (r = new Map()));
  return r;
};

/** Live mark count of `eid`'s chain marks on `t` (read-only). */
export function kerrinMarks(sim: Sim, eid: number, t: number): number {
  const mk = peekState<Map<number, Mark>>(sim, MARKS)?.get(eid)?.get(t);
  return mk && mk.until > sim.tick && mk.serial === sim.c.Unit.serial[t] ? mk.n : 0;
}

function addMark(sim: Sim, eid: number, t: number): void {
  const m = marksOf(sim, eid);
  const n = kerrinMarks(sim, eid, t);
  m.set(t, { n: Math.min(V.mark.max, n + 1), until: sim.tick + sec(V.mark.sec), serial: sim.c.Unit.serial[t]! });
}

/** Newest line projectile of slot 0 still at its start (the hook just thrown). */
function freshHook(sim: Sim, eid: number): number {
  const { Proj } = sim.c;
  let best = -1;
  for (const p of query(sim.world, [Proj])) if (Proj.src[p] === eid && Proj.travelled[p] === 0 && projectileSource(sim, p).slot === 0) best = p;
  return best;
}

/** Pull Kerrin to (x, y) over a time that follows the distance (hook speed 1900). */
function pullTo(sim: Sim, eid: number, x: number, y: number, ticks?: number): void {
  const { Pos } = sim.c;
  const d = Math.sqrt((x - Pos.x[eid]!) ** 2 + (y - Pos.y[eid]!) ** 2);
  const t = ticks ?? Math.max(V.hook.leapTicks - 3, Math.ceil((d / 1900) * 30) + 3);
  leapTo(sim, eid, eid, x, y, t);
  hookState<Pull>(sim, PULL).set(eid, { x, y, until: sim.tick + t, total: t });
}

/** Point beside `t` on the line from Kerrin, a gap away from both hitboxes (walkable). */
function beside(sim: Sim, eid: number, t: number): { x: number; y: number } {
  const { Pos, Unit } = sim.c;
  const dx = Pos.x[t]! - Pos.x[eid]!;
  const dy = Pos.y[t]! - Pos.y[eid]!;
  const l = Math.sqrt(dx * dx + dy * dy) || 1;
  const gap = Unit.radius[t]! + Unit.radius[eid]! + V.hook.stopGap;
  return landingPoint(sim, Pos.x[eid]!, Pos.y[eid]!, Pos.x[t]! - (dx / l) * gap, Pos.y[t]! - (dy / l) * gap);
}

function kerrinVisuals(sim: Sim, eid: number): ChampionVisuals {
  const v: ChampionVisuals = {};
  const mk = peekState<Map<number, Mark>>(sim, MARKS)?.get(eid);
  const rRank = champAbil(sim, eid).ranks[3]!;
  const marks: UnitMark[] = [];
  let top = 0;
  if (mk)
    for (const [t, m] of mk) {
      if (m.until <= sim.tick || m.serial !== sim.c.Unit.serial[t] || !sim.c.Unit.alive[t]) continue;
      top = Math.max(top, m.n);
      marks.push({ target: t, id: 'kerrin_mal', n: m.n, max: V.mark.max, left: m.until - sim.tick, ...(rRank > 0 ? { exec: rv(V.execute.pct, rRank) / 100 } : {}) });
    }
  if (marks.length) v.marks = marks;
  v.passive = { stacks: top, max: V.mark.max, ready: top >= V.mark.max };
  const pull = peekState<Pull>(sim, PULL)?.get(eid);
  if (pull && pull.until > sim.tick) {
    const o: VisualObject = { key: `${eid}:chain`, tag: 'kerrin_q_chain', x: sim.c.Pos.x[eid]!, y: sim.c.Pos.y[eid]!, x2: pull.x, y2: pull.y, r: 20, shape: 'line', left: pull.until - sim.tick, total: pull.total };
    v.objects = [o];
  }
  return v;
}

export const hooks: ChampionHooks = {
  visuals: kerrinVisuals,
  passive: {
    kerrin_mal: {
      // Ability hits on champions (not the execute) add a mark.
      onAbilityHit(sim, eid, target, ctx) {
        if (ctx.slot !== 3 && isChampLike(sim, target) && !isStructure(sim.c.Unit.kind[target]!)) addMark(sim, eid, target);
      },
      modifyDamage(sim, eid, target, amount) {
        const n = kerrinMarks(sim, eid, target);
        return n ? amount * (1 + V.mark.dmgPerMark * n) : amount;
      },
      // A fresh hook that will meet a wall before max range: stop it there and remember the anchor for the pull.
      onCast(sim, eid, slot) {
        if (slot !== 0) return;
        const anchors = hookState<Anchor>(sim, ANCHOR);
        anchors.delete(eid);
        const p = freshHook(sim, eid);
        if (p < 0) return;
        const { Proj, Pos } = sim.c;
        const [ox, oy, dx, dy] = [Pos.x[p]!, Pos.y[p]!, Proj.dx[p]!, Proj.dy[p]!];
        for (let d = 20; d <= Proj.maxDist[p]!; d += 20) {
          if (walkable(sim.map.nav, ox + dx * d, oy + dy * d)) continue;
          Proj.maxDist[p] = d;
          anchors.set(eid, { ox, oy, dx, dy, d, tick: sim.tick });
          return;
        }
      },
    },
  },
  effects: {
    // Q: unit hit -> pull to it; max range at a wall (phase expire) -> pull over the wall.
    kerrin_q_hook(sim, ctx) {
      const anchors = hookState<Anchor>(sim, ANCHOR);
      if (ctx.phase === 'cast') {
        const t = ctx.hits[0];
        anchors.delete(ctx.caster);
        if (t === undefined || !sim.c.Unit.alive[t]) return;
        const p = beside(sim, ctx.caster, t);
        pullTo(sim, ctx.caster, p.x, p.y);
        return;
      }
      if (ctx.phase !== 'expire') return;
      const a = anchors.get(ctx.caster);
      anchors.delete(ctx.caster);
      if (!a || sim.tick - a.tick > sec(2)) return;
      for (let d = a.d + 10; d <= a.d + V.hook.wallLeapMax; d += 10) {
        const x = a.ox + a.dx * d;
        const y = a.oy + a.dy * d;
        if (!walkable(sim.map.nav, x, y)) continue;
        pullTo(sim, ctx.caster, x, y);
        return;
      }
    },
    // E: the generic effects (speed, damage, root) do the work; the engine arms the next auto.
    kerrin_e_next_auto() {},
    // R: leap to the target; with three marks and HP below the threshold after the hit it is executed.
    kerrin_r_execute(sim, ctx) {
      if (ctx.phase !== 'cast') return;
      const t = ctx.hits[0] ?? ctx.target;
      if (t < 0 || !sim.c.Unit.alive[t]) return;
      const p = beside(sim, ctx.caster, t);
      pullTo(sim, ctx.caster, p.x, p.y, V.execute.leapTicks);
      const full = kerrinMarks(sim, ctx.caster, t) >= V.mark.max;
      marksOf(sim, ctx.caster).delete(t);
      if (!full) return;
      const { Hp } = sim.c;
      if (Hp.cur[t]! + Hp.shield[t]! <= (Hp.max[t]! * rv(V.execute.pct, ctx.rank)) / 100) dealDamage(sim, ctx.caster, t, Hp.cur[t]! + Hp.shield[t]! + 1, 'true', { raw: true });
    },
  },
};
