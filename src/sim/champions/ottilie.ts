// Ottilie Wolfsrufer hooks: the wolf Hark (passive pet), Hark leap (Q), scout (W), retreat shot (E), hunting call (R).

import type { Sim } from '../sim';
import { isRef } from '../sim';
import { Kind, sec } from '../types';
import { addBuff, healUnit } from '../buffs';
import { dist2 } from '../vec';
import { displaceTo } from '../systems/abilities';
import { spawnProjectile } from '../systems/projectiles';
import { attackProjectileSpeed, canTarget, type AutoPayload } from '../systems/attack';
import { setPetBehaviour, spawnPet } from '../summons';
import type { ChampionHooks, ChampionVisuals, VisualObject } from './hooks';
import { stateMap, unitsWhere } from './dagny';
import { peekState } from './util';

const HARK = 'ottilie_hark';
const RESPAWN = sec(30);
const HARK_VISION = 400;

interface Pack {
  hark: number;
  serial: number;
  respawnAt: number;
  /** R: enlarged until this tick. */
  rUntil: number;
  /** W: scouting until this tick. */
  scoutUntil: number;
  /** W: scout destination (render only). */
  scoutX: number;
  scoutY: number;
  /** Q: hunt focus (and a pending leap while `leap`). */
  hunt: number;
  huntSerial: number;
  huntUntil: number;
  leap: boolean;
  /** Hark's attack timer last tick (a change = he attacked). */
  lastReady: number;
}
const packs = (sim: Sim): Map<number, Pack> => stateMap<Pack>(sim, 'ottiliePack');
function pack(sim: Sim, eid: number): Pack {
  let p = packs(sim).get(eid);
  if (!p) packs(sim).set(eid, (p = { hark: -1, serial: 0, respawnAt: 0, rUntil: 0, scoutUntil: 0, scoutX: 0, scoutY: 0, hunt: -1, huntSerial: 0, huntUntil: 0, leap: false, lastReady: 0 }));
  return p;
}

/** Live Hark of this Ottilie, or -1. */
export function harkOf(sim: Sim, eid: number): number {
  const p = packs(sim).get(eid);
  return p && isRef(sim, p.hark, p.serial) ? p.hark : -1;
}

const harkMaxHp = (sim: Sim, eid: number, p: Pack): number => 300 + 60 * Math.max(1, sim.c.Champ.level[eid]!) + (p.rUntil > sim.tick ? 300 : 0);

function spawnHark(sim: Sim, eid: number, p: Pack): void {
  const { Pos, Stats } = sim.c;
  const hp = harkMaxHp(sim, eid, p);
  p.hark = spawnPet(sim, { owner: eid, tag: HARK, x: Pos.x[eid]! - 80, y: Pos.y[eid]!, ticks: 0, hp, ad: 0.5 * Stats.ad[eid]!, as: 1, range: 125, ms: 345, radius: 45, armor: 20, mr: 20, vision: HARK_VISION, behaviour: 'follow' });
  p.serial = sim.c.Unit.serial[p.hark]!;
  p.lastReady = sim.c.Atk.nextReady[p.hark]!;
}

function packTick(sim: Sim, eid: number): void {
  const p = pack(sim, eid);
  const { Unit, Hp, Stats, Atk, Pos, Vision } = sim.c;
  let h = harkOf(sim, eid);
  if (h < 0) {
    if (p.hark >= 0) (p.hark = -1), (p.respawnAt = sim.tick + RESPAWN); // just died
    if (!Unit.alive[eid] || sim.tick < p.respawnAt) return;
    spawnHark(sim, eid, p);
    h = p.hark;
  }
  // stats follow Ottilie's level and AD (R: double damage, +300 HP)
  const enlarged = p.rUntil > sim.tick;
  const max = harkMaxHp(sim, eid, p);
  if (max !== Hp.max[h]) {
    Hp.cur[h] = Math.max(1, Math.min(max, Hp.cur[h]! + (max - Hp.max[h]!)));
    Hp.max[h] = max;
  }
  Stats.ad[h] = 0.5 * Stats.ad[eid]! * (enlarged ? 2 : 1);
  // R: Hark's attacks slow by 30 % for 1 s (detected one tick late through his attack timer)
  if (Atk.nextReady[h] !== p.lastReady) {
    p.lastReady = Atk.nextReady[h]!;
    const t = Atk.target[h]!;
    if (enlarged && t >= 0 && isRef(sim, t, Atk.targetSerial[h]!)) addBuff(sim, t, { kind: 'slow', id: 'ottilie_r', src: eid, pct: 30, ticks: sec(1) });
  }
  // W: scouting ends -> follow again
  if (p.scoutUntil > 0 && sim.tick >= p.scoutUntil) {
    p.scoutUntil = 0;
    Vision.r[h] = HARK_VISION;
    setPetBehaviour(sim, h, 'follow', { focus: -1 });
  }
  if (p.scoutUntil > 0) return;
  // Q: hunt focus for 4 s; leap (300) onto the target once in range
  if (p.hunt >= 0) {
    if (sim.tick >= p.huntUntil || !isRef(sim, p.hunt, p.huntSerial)) {
      p.hunt = -1;
      p.leap = false;
      setPetBehaviour(sim, h, 'follow', { focus: -1 });
    } else if (p.leap) {
      const t = p.hunt;
      const gap = Math.sqrt(dist2(Pos.x[h]!, Pos.y[h]!, Pos.x[t]!, Pos.y[t]!)) - Unit.radius[h]! - Unit.radius[t]!;
      if (gap <= 300) {
        p.leap = false;
        if (gap > 0) {
          const k = gap / (gap + Unit.radius[h]! + Unit.radius[t]!);
          displaceTo(sim, eid, h, Pos.x[h]! + (Pos.x[t]! - Pos.x[h]!) * k, Pos.y[h]! + (Pos.y[t]! - Pos.y[h]!) * k, Math.max(1, Math.round((gap * 30) / 1200)));
        }
        addBuff(sim, t, { kind: 'slow', id: 'ottilie_q_leap', src: eid, pct: 50, ticks: sec(0.75) });
      }
    }
  }
}

/** E: at the start of the hop, a 130 % basic attack at the nearest enemy champion (else unit) in front, in range. */
function retreatShot(sim: Sim, eid: number, fx: number, fy: number): void {
  const { Pos, Unit, Stats } = sim.c;
  const ox = Pos.x[eid]!;
  const oy = Pos.y[eid]!;
  const inFront = (e: number): boolean => {
    const vx = Pos.x[e]! - ox;
    const vy = Pos.y[e]! - oy;
    const reach = Stats.range[eid]! + Unit.radius[eid]! + Unit.radius[e]!;
    return vx * fx + vy * fy > 0 && vx * vx + vy * vy <= reach * reach;
  };
  const cands = unitsWhere(sim, (e) => canTarget(sim, eid, e) && Unit.kind[e] !== Kind.Ward && inFront(e));
  const champs = cands.filter((e) => Unit.kind[e] === Kind.Champion);
  const pool = champs.length ? champs : cands;
  let best = -1;
  let bestD = Infinity;
  for (const e of pool) {
    const d = dist2(Pos.x[e]!, Pos.y[e]!, ox, oy);
    if (d < bestD) (bestD = d), (best = e);
  }
  if (best < 0) return;
  const payload: AutoPayload = { t: 'auto', src: eid, srcSerial: Unit.serial[eid]!, amount: 1.3 * Stats.ad[eid]!, type: 'phys', raw: false, crit: false, miss: false };
  spawnProjectile(sim, { kind: 0, src: eid, team: Unit.team[eid]!, x: ox, y: oy, target: best, speed: attackProjectileSpeed(sim, eid) || 2000, payload });
}

const SCOUT = sec(6);
const CALL = sec(8);

/**
 * Snapshot visuals (read-only): passive = Hark alive (ready) or his respawn timer; W scout destination pin with the
 * scouting timer (own team only); Q leap line Hark -> hunted target while the leap is pending; R enlarged Hark mark.
 */
function ottilieVisuals(sim: Sim, eid: number): ChampionVisuals {
  const p = peekState<Pack>(sim, 'ottiliePack')?.get(eid);
  if (!p) return {};
  const h = isRef(sim, p.hark, p.serial) ? p.hark : -1;
  const v: ChampionVisuals = {
    passive: h >= 0 ? { ready: true } : { ready: false, cdLeft: Math.max(0, p.respawnAt - sim.tick), cdTotal: RESPAWN },
  };
  if (h < 0) return v;
  const { Pos } = sim.c;
  const objects: VisualObject[] = [];
  if (p.scoutUntil > sim.tick)
    objects.push({ key: `${eid}`, tag: 'ottilie_w_scout', x: p.scoutX, y: p.scoutY, r: 60, shape: 'pin', left: p.scoutUntil - sim.tick, total: SCOUT, hidden: true });
  else if (p.hunt >= 0 && p.leap && sim.tick < p.huntUntil && isRef(sim, p.hunt, p.huntSerial))
    objects.push({ key: `${eid}`, tag: 'ottilie_q_leap', x: Pos.x[h]!, y: Pos.y[h]!, x2: Pos.x[p.hunt]!, y2: Pos.y[p.hunt]!, follow: p.hunt, r: 8, shape: 'line' });
  if (objects.length) v.objects = objects;
  if (p.rUntil > sim.tick) v.marks = [{ target: h, id: 'ottilie_r_call', left: p.rUntil - sim.tick }];
  return v;
}

export const hooks: ChampionHooks = {
  visuals: ottilieVisuals,
  onTick: packTick,
  passive: {
    ottilie_pack_hark: {
      // Hark spawns on the first tick (packTick) and respawns 30 s after dying
      onSpawn(sim, eid) {
        pack(sim, eid);
      },
      // monster kills heal Hark for 15 % of his max HP
      onKill(sim, eid, victim) {
        const h = harkOf(sim, eid);
        if (h >= 0 && sim.c.Unit.kind[victim] === Kind.Monster) healUnit(sim, h, 0.15 * sim.c.Hp.max[h]!);
      },
    },
  },
  effects: {
    // On hit: Hark hunts the marked target for 4 s and leaps onto it (300) when in range, slowing it 50 % for 0.75 s.
    ottilie_q_hark_leap(sim, ctx) {
      const t = ctx.hits[0];
      const h = harkOf(sim, ctx.caster);
      if (ctx.phase !== 'cast' || t === undefined || h < 0) return;
      const p = pack(sim, ctx.caster);
      if (p.scoutUntil > 0) return; // ponytail: a scouting Hark ignores the hunt
      Object.assign(p, { hunt: t, huntSerial: sim.c.Unit.serial[t]!, huntUntil: sim.tick + sec(4), leap: true });
      setPetBehaviour(sim, h, 'follow', { focus: t });
    },
    // Hark runs to the target point (up to 2000) and stays up to 6 s with 800 vision, ignoring enemies.
    // ponytail: the 6 s count from the cast (travel included).
    ottilie_w_scout(sim, ctx) {
      const h = harkOf(sim, ctx.caster);
      if (ctx.phase !== 'cast' || h < 0) return;
      const p = pack(sim, ctx.caster);
      p.scoutUntil = sim.tick + SCOUT;
      p.scoutX = ctx.x;
      p.scoutY = ctx.y;
      p.hunt = -1;
      p.leap = false;
      sim.c.Vision.r[h] = 800;
      setPetBehaviour(sim, h, 'walk', { tx: ctx.x, ty: ctx.y, focus: -1 });
    },
    // Backward hop (away from the cursor) with a 130 % shot forward at the start.
    ottilie_e_retreat_shot(sim, ctx) {
      if (ctx.phase !== 'dashStart' || !ctx.dash) return;
      retreatShot(sim, ctx.caster, ctx.dash.dx, ctx.dash.dy);
      ctx.dash.dx = -ctx.dash.dx;
      ctx.dash.dy = -ctx.dash.dy;
    },
    // 8 s: Hark enlarged (+100 % damage, +300 HP, slowing attacks); a dead Hark respawns at once.
    ottilie_r_hunting_call(sim, ctx) {
      if (ctx.phase !== 'cast') return;
      const p = pack(sim, ctx.caster);
      p.rUntil = sim.tick + CALL;
      if (harkOf(sim, ctx.caster) < 0) spawnHark(sim, ctx.caster, p);
    },
  },
};
