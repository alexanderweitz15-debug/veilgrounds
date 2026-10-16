// Kiran Fadenleser hooks: foresight thread (passive), sweet-spot root (Q), fate link (E).

import type { Sim } from '../sim';
import { Kind, sec } from '../types';
import { addBuff, hasStat } from '../buffs';
import { dealDamage } from '../damage';
import { dir, dist2 } from '../vec';
import { rv } from '../systems/abilities';
import type { ChampionHooks, ChampionVisuals, VisualObject } from './hooks';
import { stateMap, unitsWhere } from './dagny';
import { peekState } from './util';

// ------------------------------------------------------------------ passive: foresight

/** Foresight per Kiran: next check tick and the current thread (direction only; read by render/HUD). */
interface Foresight {
  next: number;
  until: number;
  dx: number;
  dy: number;
}
const foresight = (sim: Sim): Map<number, Foresight> => stateMap<Foresight>(sim, 'kiranForesight');

export const kiranThread = (sim: Sim, eid: number): { dx: number; dy: number } | null => {
  const f = foresight(sim).get(eid);
  return f && f.until > sim.tick ? { dx: f.dx, dy: f.dy } : null;
};

/** Every 15 s: a 1 s thread toward the nearest invisible enemy champion within 1800 (no reveal). */
function foresightTick(sim: Sim, eid: number): void {
  let f = foresight(sim).get(eid);
  if (!f) foresight(sim).set(eid, (f = { next: sim.tick + sec(15), until: 0, dx: 0, dy: 0 }));
  if (sim.tick < f.next || !sim.c.Unit.alive[eid]) return;
  f.next = sim.tick + sec(15);
  const { Pos, Unit } = sim.c;
  let best = -1;
  let bestD = 1800 * 1800;
  for (const e of unitsWhere(sim, (u) => !!Unit.alive[u] && Unit.kind[u] === Kind.Champion && Unit.team[u] !== Unit.team[eid] && hasStat(sim, u, 'invisible'))) {
    const d = dist2(Pos.x[e]!, Pos.y[e]!, Pos.x[eid]!, Pos.y[eid]!);
    if (d <= bestD) (bestD = d), (best = e);
  }
  if (best < 0) return;
  [f.dx, f.dy] = dir(Pos.x[eid]!, Pos.y[eid]!, Pos.x[best]!, Pos.y[best]!);
  f.until = sim.tick + sec(1);
}

// ------------------------------------------------------------------ E: fate link

const LINK_RANGE = 1000;
const LINK_ID = 'kiran_e_link';
/** Linked ally per Kiran: the ally takes 20 % less (dmgReduction), Kiran takes that 20 % as true damage. */
interface Link {
  ally: number;
  serial: number;
  until: number;
  lastHp: number;
}
const links = (sim: Sim): Map<number, Link> => stateMap<Link>(sim, 'kiranLink');

/**
 * ponytail: the redirect is measured from the ally's HP loss per tick (after the 20 % reduction: original = loss /
 * 0.8, Kiran's share = loss / 4). Damage absorbed by the ally's shields and same-tick heals are not redirected.
 * Upgrade: an engine damage-redirect hook on the ally.
 */
function linkTick(sim: Sim, eid: number): void {
  const l = links(sim).get(eid);
  if (!l) return;
  const { Unit, Pos, Hp } = sim.c;
  const ok =
    sim.tick < l.until &&
    !!Unit.alive[eid] &&
    Unit.serial[l.ally] === l.serial &&
    !!Unit.alive[l.ally] &&
    dist2(Pos.x[l.ally]!, Pos.y[l.ally]!, Pos.x[eid]!, Pos.y[eid]!) <= LINK_RANGE * LINK_RANGE;
  const lost = Math.max(0, l.lastHp - Hp.cur[l.ally]!);
  l.lastHp = Hp.cur[l.ally]!;
  if (lost > 0) dealDamage(sim, -1, eid, lost / 4, 'true');
  if (!ok) return void links(sim).delete(eid);
  addBuff(sim, l.ally, { kind: 'stat', stat: 'dmgReduction', id: LINK_ID, src: eid, pct: 20, ticks: 2 });
}

// ------------------------------------------------------------------ Q

const qOrigins = (sim: Sim): Map<number, { x: number; y: number }> => stateMap(sim, 'kiranQ');
const Q_ROOT = [0.75, 0.85, 0.95, 1.05, 1.15];

/** Length of the foresight thread drawn from Kiran (direction only, never the enemy's position). */
const THREAD_LEN = 600;
const FORESIGHT_TICKS = sec(15);

/**
 * Snapshot (read-only): P = foresight thread as a short line from Kiran (own team only) + HUD cooldown to the next
 * check; E = the fate link as a line from Kiran to the linked ally (follows the ally) with its 3 s timer.
 */
function kiranVisuals(sim: Sim, eid: number): ChampionVisuals {
  const { Pos, Unit } = sim.c;
  const x = Pos.x[eid]!;
  const y = Pos.y[eid]!;
  const objects: VisualObject[] = [];
  const f = peekState<Foresight>(sim, 'kiranForesight')?.get(eid);
  const threadLeft = f ? f.until - sim.tick : 0;
  if (f && threadLeft > 0 && Unit.alive[eid]) {
    objects.push({ key: String(eid), tag: 'kiran_p_thread', x, y, r: 20, shape: 'line', x2: x + f.dx * THREAD_LEN, y2: y + f.dy * THREAD_LEN, left: threadLeft, total: sec(1), hidden: true });
  }
  const l = peekState<Link>(sim, 'kiranLink')?.get(eid);
  if (l && l.until > sim.tick && Unit.alive[eid] && Unit.alive[l.ally] && Unit.serial[l.ally] === l.serial) {
    objects.push({ key: String(eid), tag: 'kiran_e_link', x, y, r: 20, shape: 'line', x2: Pos.x[l.ally]!, y2: Pos.y[l.ally]!, follow: l.ally, left: l.until - sim.tick, total: sec(3) });
  }
  const passive = f ? (threadLeft > 0 ? { ready: true } : { ready: false, cdLeft: Math.max(0, f.next - sim.tick), cdTotal: FORESIGHT_TICKS }) : undefined;
  return { objects, ...(passive ? { passive } : {}) };
}

export const hooks: ChampionHooks = {
  visuals: kiranVisuals,
  onTick(sim, eid) {
    foresightTick(sim, eid);
    linkTick(sim, eid);
  },
  passive: {
    kiran_foresight: {
      // the Q projectile spawns in the same resolution that calls onCast: this is its origin
      onCast(sim, eid, slot) {
        if (slot === 0) qOrigins(sim).set(eid, { x: sim.c.Pos.x[eid]!, y: sim.c.Pos.y[eid]! });
      },
    },
  },
  effects: {
    kiran_q_sweetspot_root(sim, ctx) {
      const o = qOrigins(sim).get(ctx.caster);
      if (!o || dist2(o.x, o.y, ctx.x, ctx.y) <= 700 * 700) return;
      for (const t of ctx.hits) addBuff(sim, t, { kind: 'root', id: 'kiran_q', src: ctx.caster, ticks: sec(rv(Q_ROOT, ctx.rank)) });
    },
    kiran_e_fate_link(sim, ctx) {
      if (ctx.target < 0) return;
      links(sim).set(ctx.caster, { ally: ctx.target, serial: sim.c.Unit.serial[ctx.target]!, until: sim.tick + sec(3), lastHp: sim.c.Hp.cur[ctx.target]! });
      addBuff(sim, ctx.target, { kind: 'stat', stat: 'dmgReduction', id: LINK_ID, src: ctx.caster, pct: 20, ticks: 2 });
    },
  },
};
