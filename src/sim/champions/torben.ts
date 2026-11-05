// Torben Wutmähne hooks: Rage (0-100, built by autos, ability hits and damage taken; +0.3 AD per point, +20 % move speed at
// 100), War Cry (+15 Rage), Undying Roar (HP cannot drop below 1 for 5 s, Rage locked at 100, heal at the end).
// All state in sim.state keyed by champion eid; no Math.random/sin/cos.

import type { Sim } from '../sim';
import { sec } from '../types';
import { healUnit } from '../buffs';
import { rv } from '../systems/abilities';
import type { ChampionHooks, ChampionVisuals } from './hooks';
import { hookState, peekState } from './util';

const MAX = 100;
const PER_AUTO = 4;
const PER_ABILITY = 6;
const AD_PER_POINT = 0.3;
const FULL_MS_MULT = 1.2;
const DECAY_AFTER = sec(4);
const DECAY_PER_TICK = 10 / 30;
const UNDYING_SEC = 5;
const HEAL_PCT = [15, 25, 35];

interface Rage {
  v: number;
  /** Last tick the champion hit or was hit (Rage fades 4 s after). */
  combat: number;
  /** Last tick an ability hit already paid Rage (AoE hits pay once). */
  abilityTick: number;
  undyingUntil: number;
  undyingRank: number;
}
const rage = (sim: Sim, eid: number): Rage => {
  const m = hookState<Rage>(sim, 'tobenRage');
  let r = m.get(eid);
  if (!r) m.set(eid, (r = { v: 0, combat: -1e9, abilityTick: -1, undyingUntil: -1, undyingRank: 1 }));
  return r;
};

/** Current Rage of a champion (0 for unknown ids). */
export const tobenRage = (sim: Sim, eid: number): number => peekState<Rage>(sim, 'tobenRage')?.get(eid)?.v ?? 0;

const undying = (sim: Sim, r: Rage): boolean => sim.tick < r.undyingUntil;

function tobenTick(sim: Sim, eid: number): void {
  const { Unit, Hp } = sim.c;
  const r = rage(sim, eid);
  if (!Unit.alive[eid]) {
    r.v = 0;
    r.undyingUntil = -1;
    return;
  }
  if (r.undyingUntil >= 0 && sim.tick >= r.undyingUntil) {
    r.undyingUntil = -1;
    healUnit(sim, eid, Hp.max[eid]! * (HEAL_PCT[Math.min(HEAL_PCT.length, Math.max(1, r.undyingRank)) - 1]! / 100));
  }
  if (undying(sim, r)) r.v = MAX;
  else if (sim.tick - r.combat > DECAY_AFTER) r.v = Math.max(0, r.v - DECAY_PER_TICK);
}

function tobenVisuals(sim: Sim, eid: number): ChampionVisuals {
  const r = peekState<Rage>(sim, 'tobenRage')?.get(eid);
  const v = r?.v ?? 0;
  const out: ChampionVisuals = { passive: { stacks: Math.floor(v), max: MAX, ready: v >= MAX } };
  if (r && sim.tick < r.undyingUntil) out.aura = 3;
  else if (v >= MAX) out.aura = 4;
  return out;
}

export const hooks: ChampionHooks = {
  visuals: tobenVisuals,
  onTick: tobenTick,
  passive: {
    torben_rage: {
      onSpawn(sim, eid) {
        rage(sim, eid);
      },
      onAutoHit(sim, eid) {
        const r = rage(sim, eid);
        r.v = Math.min(MAX, r.v + PER_AUTO);
        r.combat = sim.tick;
      },
      onAbilityHit(sim, eid) {
        const r = rage(sim, eid);
        if (r.abilityTick === sim.tick) return;
        r.abilityTick = sim.tick;
        r.v = Math.min(MAX, r.v + PER_ABILITY);
        r.combat = sim.tick;
      },
      onDamageTaken(sim, eid, _src, info) {
        const { Hp } = sim.c;
        const r = rage(sim, eid);
        r.v = Math.min(MAX, r.v + (info.amount / Hp.max[eid]!) * 100);
        r.combat = sim.tick;
        if (undying(sim, r) && Hp.cur[eid]! < 1) Hp.cur[eid] = 1;
      },
      onComputeStats(sim, eid) {
        const { Stats } = sim.c;
        const v = rage(sim, eid).v;
        Stats.ad[eid] = Stats.ad[eid]! + v * AD_PER_POINT;
        if (v >= MAX) Stats.ms[eid] = Stats.ms[eid]! * FULL_MS_MULT;
      },
    },
  },
  effects: {
    torben_w_cry(sim, ctx) {
      const r = rage(sim, ctx.caster);
      r.v = Math.min(MAX, r.v + 15);
      r.combat = sim.tick;
    },
    torben_r_undying(sim, ctx) {
      const r = rage(sim, ctx.caster);
      r.undyingUntil = sim.tick + sec(rv(ctx.ability.duration ?? UNDYING_SEC, ctx.rank));
      r.undyingRank = ctx.rank;
      r.v = MAX;
      r.combat = sim.tick;
    },
  },
};
