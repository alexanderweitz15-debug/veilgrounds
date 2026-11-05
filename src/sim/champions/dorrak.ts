// Dorrak Sandschlund hooks (burrowing jungle juggernaut). Contract: ./hooks.ts, behaviour list: docs/champion-hooks.md.
// W burrows: untargetable, +35 % move speed, cannot attack (buff kind 'disarm'), regenerates (passive Sandgut) and leaves a
// dust trail the enemy team sees (snapshot objects). Q/R surface him first; E erupts, stronger from underground.
import type { Sim } from '../sim';
import { sec } from '../types';
import { addBuff, healUnit, removeBuffs } from '../buffs';
import { closeRecast, openRecast, rv } from '../systems/abilities';
import type { ChampionHooks, ChampionVisuals, VisualObject } from './hooks';
import { hookState, peekState } from './util';
import V from '../../data/champions/dorrak.values.json';

interface DState {
  /** Tick the burrow ends (-1 = on the surface). */
  until: number;
  /** Dust trail: recent positions with their tick. */
  trail: { x: number; y: number; t: number }[];
  /** E: prep saw him underground (eruption bonus). */
  eruptBoost: boolean;
}
const KEY = 'dorrak';
const state = (sim: Sim, eid: number): DState => {
  const m = hookState<DState>(sim, KEY);
  let s = m.get(eid);
  if (!s) m.set(eid, (s = { until: -1, trail: [], eruptBoost: false }));
  return s;
};
const BURROW_IDS = ['dorrak_burrow', 'dorrak_burrow_ms', 'dorrak_burrow_disarm'];

/** Underground right now (tests, bots, visuals). Read-only. */
export const dorrakBurrowed = (sim: Sim, eid: number): boolean => {
  const s = peekState<DState>(sim, KEY)?.get(eid);
  return !!s && s.until > sim.tick && !!sim.c.Unit.alive[eid];
};

function surface(sim: Sim, eid: number, s: DState): void {
  if (s.until < 0) return;
  s.until = -1;
  removeBuffs(sim, eid, (b) => BURROW_IDS.includes(b.id));
  closeRecast(sim, eid, 1);
}

function dorrakTick(sim: Sim, eid: number): void {
  const s = hookState<DState>(sim, KEY).get(eid);
  if (!s) return;
  if (!sim.c.Unit.alive[eid]) {
    s.until = -1;
    s.trail = [];
    return;
  }
  s.trail = s.trail.filter((p) => sim.tick - p.t <= sec(V.burrow.trailLifeSec));
  if (s.until < 0) return;
  if (sim.tick >= s.until) return surface(sim, eid, s);
  const { Pos, Hp } = sim.c;
  // re-applied every tick so the buffs end the moment the burrow does (surface removes them too)
  addBuff(sim, eid, { kind: 'stat', stat: 'untargetable', id: 'dorrak_burrow', src: eid, ticks: 2 });
  addBuff(sim, eid, { kind: 'stat', stat: 'ms', id: 'dorrak_burrow_ms', src: eid, pct: V.burrow.msPct, ticks: 2 });
  addBuff(sim, eid, { kind: 'disarm', id: 'dorrak_burrow_disarm', src: eid, ticks: 2 });
  healUnit(sim, eid, (Hp.max[eid]! * V.burrow.regenPctPerSec) / 100 / 30);
  if (sim.tick % V.burrow.trailEveryTicks === 0) {
    s.trail.push({ x: Pos.x[eid]!, y: Pos.y[eid]!, t: sim.tick });
    if (s.trail.length > V.burrow.trailMax) s.trail.shift();
  }
}

/** Snapshot (read-only): dust trail discs (visible to everyone), burrow aura, passive badge. */
function dorrakVisuals(sim: Sim, eid: number): ChampionVisuals {
  const burrowed = dorrakBurrowed(sim, eid);
  const v: ChampionVisuals = { passive: { ready: burrowed } };
  const s = peekState<DState>(sim, KEY)?.get(eid);
  if (!s) return v;
  if (burrowed) v.aura = 1;
  const life = sec(V.burrow.trailLifeSec);
  const objs: VisualObject[] = s.trail
    .filter((p) => sim.tick - p.t <= life)
    .map((p, i) => ({ key: `${eid}:t${i}`, tag: 'dorrak_trail', x: p.x, y: p.y, r: 80, shape: 'disc', left: life - (sim.tick - p.t), total: life, hue: 38 }));
  if (objs.length) v.objects = objs;
  return v;
}

export const hooks: ChampionHooks = {
  visuals: dorrakVisuals,
  onTick: dorrakTick,
  passive: {
    dorrak_sandgut: {
      onSpawn(sim, eid) {
        state(sim, eid);
      },
    },
  },
  effects: {
    // W: dive; the recast (or the end of the timer) surfaces.
    dorrak_w_burrow(sim, ctx) {
      const s = state(sim, ctx.caster);
      if (ctx.phase === 'recast') return surface(sim, ctx.caster, s);
      if (ctx.phase !== 'cast') return;
      s.until = sim.tick + sec(rv(ctx.ability.duration, ctx.rank) || 4);
      s.trail = [];
      openRecast(sim, ctx.caster, 1, sim.tick + sec(V.burrow.recastDelaySec), s.until);
    },
    // Q / R: surface before the damage.
    dorrak_q_surface: (sim, ctx) => void (ctx.phase === 'cast' && surface(sim, ctx.caster, state(sim, ctx.caster))),
    dorrak_r_surface: (sim, ctx) => void (ctx.phase === 'cast' && surface(sim, ctx.caster, state(sim, ctx.caster))),
    // Q (after the damage): -15 % armor for 3 s (negative pct is not allowed in ability data).
    dorrak_q_shred(sim, ctx) {
      if (ctx.phase !== 'cast') return;
      for (const t of ctx.hits) addBuff(sim, t, { kind: 'stat', stat: 'armor', id: 'dorrak_q', src: ctx.caster, pct: -V.shred.pct, ticks: sec(V.shred.sec) });
    },
    // E (before the damage): from underground +30 % damage.
    dorrak_e_prep(sim, ctx) {
      if (ctx.phase !== 'cast') return;
      const s = state(sim, ctx.caster);
      s.eruptBoost = dorrakBurrowed(sim, ctx.caster);
      if (s.eruptBoost) ctx.dmgMult = (ctx.dmgMult ?? 1) * V.erupt.burrowDmgMult;
    },
    // E (after the damage): longer knock-up from underground, then surface.
    dorrak_e_finish(sim, ctx) {
      if (ctx.phase !== 'cast') return;
      const s = state(sim, ctx.caster);
      if (s.eruptBoost) {
        for (const t of ctx.hits) addBuff(sim, t, { kind: 'airborne', id: 'dorrak_e', src: ctx.caster, ticks: sec(V.erupt.airSec + V.erupt.burrowExtraAirSec) });
      }
      s.eruptBoost = false;
      surface(sim, ctx.caster, s);
    },
  },
};
