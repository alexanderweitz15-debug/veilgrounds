// Gerwin Totenglocke hooks: skeletons are real pets (spawnPet: HP, can be killed, tag gerwin_skeleton). Q raises one, W
// detonates the one nearest the cursor, E sends them at a target, R raises three reinforced ones. Crypt Servants gives
// armor/MR per living skeleton. No Math.random/sin/cos; pets keep the state.

import type { Sim } from '../sim';
import { sec } from '../types';
import { dealDamage } from '../damage';
import { addBuff } from '../buffs';
import { dist2 } from '../vec';
import { enemiesInRadius, rv, setCooldown } from '../systems/abilities';
import { petsOf, removePet, setPetBehaviour, spawnPet } from '../summons';
import type { ChampionHooks, ChampionVisuals, EffectCtx } from './hooks';
import { byLevel } from './dagny';

const TAG = 'gerwin_skeleton';
const MAX = 4;
const LIFE = sec(20);
const RES_PER = 4;
const BURST = [70, 110, 150, 190, 230];

export const skeletonCount = (sim: Sim, eid: number): number => petsOf(sim, eid, TAG).length;

function raise(sim: Sim, eid: number, x: number, y: number, hpMult: number, ticks: number): void {
  const { Stats } = sim.c;
  const mine = petsOf(sim, eid, TAG);
  while (mine.length >= MAX) removePet(sim, mine.shift()!); // oldest falls apart
  spawnPet(sim, {
    owner: eid, tag: TAG, x, y, ticks, behaviour: 'follow', radius: 45,
    hp: (byLevel(sim, eid, 90, 300) + 0.4 * Stats.ap[eid]!) * hpMult, ad: byLevel(sim, eid, 22, 60) + 0.25 * Stats.ap[eid]!,
    as: 0.9, range: 125, ms: 360, armor: 20, mr: 20, vision: 400,
  });
}

function gerwinVisuals(sim: Sim, eid: number): ChampionVisuals {
  const n = skeletonCount(sim, eid);
  return { passive: { stacks: n, max: MAX, ready: n >= MAX } };
}

export const hooks: ChampionHooks = {
  visuals: gerwinVisuals,
  passive: {
    gerwin_crypt: {
      onComputeStats(sim, eid) {
        const n = skeletonCount(sim, eid);
        if (!n) return;
        sim.c.Stats.armor[eid] = sim.c.Stats.armor[eid]! + RES_PER * n;
        sim.c.Stats.mr[eid] = sim.c.Stats.mr[eid]! + RES_PER * n;
      },
    },
  },
  effects: {
    gerwin_q_raise(sim, ctx: EffectCtx) {
      if (ctx.phase === 'cast') raise(sim, ctx.caster, ctx.x, ctx.y, 1, LIFE);
    },
    gerwin_r_host(sim, ctx: EffectCtx) {
      if (ctx.phase !== 'cast') return;
      for (let i = 0; i < 3; i++) raise(sim, ctx.caster, ctx.x + (i - 1) * 90, ctx.y + (i === 1 ? 70 : 0), 1.5, sec(12));
    },
    gerwin_w_burst(sim, ctx: EffectCtx) {
      if (ctx.phase !== 'cast') return;
      const { Pos } = sim.c;
      let best = -1;
      let bd = Infinity;
      for (const p of petsOf(sim, ctx.caster, TAG)) {
        const d = dist2(Pos.x[p]!, Pos.y[p]!, ctx.cursorX, ctx.cursorY);
        if (d < bd) (bd = d), (best = p);
      }
      if (best < 0) return void setCooldown(sim, ctx.caster, ctx.slot, 0); // ponytail: no skeleton, no cost to the cooldown (mana is spent)
      const x = Pos.x[best]!;
      const y = Pos.y[best]!;
      removePet(sim, best);
      const dmg = rv(BURST, ctx.rank) + 0.6 * sim.c.Stats.ap[ctx.caster]!;
      for (const e of enemiesInRadius(sim, ctx.caster, x, y, ctx.ability.radius ?? 260)) {
        dealDamage(sim, ctx.caster, e, dmg, 'magic');
        addBuff(sim, e, { kind: 'slow', id: 'gerwin_burst', src: ctx.caster, pct: 30, ticks: sec(1.5) });
      }
    },
    gerwin_e_command(sim, ctx: EffectCtx) {
      if (ctx.phase !== 'cast') return;
      const { Pos } = sim.c;
      let focus = -1;
      let bd = Infinity;
      for (const e of enemiesInRadius(sim, ctx.caster, ctx.cursorX, ctx.cursorY, 600)) {
        const d = dist2(Pos.x[e]!, Pos.y[e]!, ctx.cursorX, ctx.cursorY);
        if (d < bd) (bd = d), (focus = e);
      }
      for (const p of petsOf(sim, ctx.caster, TAG)) {
        if (focus >= 0) setPetBehaviour(sim, p, 'follow', { focus });
        addBuff(sim, p, { kind: 'stat', stat: 'ms', id: 'gerwin_command', src: ctx.caster, pct: 25, ticks: sec(2) });
      }
    },
  },
};
