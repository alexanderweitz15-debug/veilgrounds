// Kaelen Rasch hooks. Contract: ./hooks.ts, behaviour list: docs/champion-hooks.md.
import type { Sim } from '../sim';
import { Kind, sec } from '../types';
import { dealDamage, lastCombatTick } from '../damage';
import { addBuff, buffs, hasBuff, removeBuffs } from '../buffs';
import { dist2 } from '../vec';
import { cooldownLeft, enemiesInRadius, reduceCooldown } from '../systems/abilities';
import { sees } from '../vision';
import { query } from 'bitecs';
import type { ChampionHooks, ChampionVisuals, HintMarker } from './hooks';
import { byLevel, hookState, peekState } from './util';

interface KaelenState {
  /** Follow-through armed until this tick. */
  follow: number;
  /** R kill: vanish as soon as out of combat, until this tick. */
  vanish: number;
}

const state = (sim: Sim, eid: number): KaelenState => {
  const m = hookState<KaelenState>(sim, 'kaelen');
  let s = m.get(eid);
  if (!s) m.set(eid, (s = { follow: -1, vanish: -1 }));
  return s;
};

const MARK = 'kaelen_mark';
const OUT_OF_COMBAT = sec(1);
const W_MARK_RANGE = 900;
/** W cursor snap radius onto a marked enemy (kaelen_w_dash_to_mark). */
const W_SNAP = 250;

/**
 * Snapshot (read-only): P follow-through armed = empowered auto + HUD timer; W = dash hints onto visible marked
 * enemies (dimmed beyond 900 / on cooldown); R = aura while the vanish is pending or the kaelen_r invisibility runs
 * (invisible buffs get no generic aura).
 */
function kaelenVisuals(sim: Sim, eid: number): ChampionVisuals {
  const { Unit, Pos } = sim.c;
  const s = peekState<KaelenState>(sim, 'kaelen')?.get(eid);
  const out: ChampionVisuals = {};
  const follow = s && s.follow >= sim.tick ? s.follow - sim.tick : 0;
  out.passive = follow > 0 ? { ready: true, cdLeft: follow, cdTotal: sec(2) } : { ready: false };
  if (follow > 0) out.empowered = 4;
  const invis = buffs(sim, eid).some((b) => b.id === 'kaelen_r' && b.kind === 'stat' && b.stat === 'invisible' && b.until > sim.tick);
  if ((s && s.vanish >= sim.tick) || invis) out.aura = 3;
  if (!Unit.alive[eid]) return out;
  const team = Unit.team[eid]!;
  const wReady = cooldownLeft(sim, eid, 1) === 0;
  const hints: HintMarker[] = [];
  for (const t of query(sim.world, [Unit])) {
    if (!Unit.alive[t] || Unit.team[t] === team || !hasBuff(sim, t, 'mark', MARK) || !sees(sim, team, t)) continue;
    const near = dist2(Pos.x[t]!, Pos.y[t]!, Pos.x[eid]!, Pos.y[eid]!) <= W_MARK_RANGE * W_MARK_RANGE;
    hints.push({ slot: 1, x: Pos.x[t]!, y: Pos.y[t]!, r: W_SNAP, ok: wReady && near, link: true });
  }
  if (hints.length) out.hints = hints;
  return out;
}

export const hooks: ChampionHooks = {
  visuals: kaelenVisuals,
  passive: {
    // After any own dash: next auto within 2 s deals bonus physical damage.
    kaelen_follow_through: {
      onDashEnd(sim, eid) {
        state(sim, eid).follow = sim.tick + sec(2);
      },
      onAutoHit(sim, eid, target) {
        const s = state(sim, eid);
        if (sim.tick > s.follow) return;
        s.follow = -1;
        dealDamage(sim, eid, target, byLevel(sim, eid, 30, 120) + 0.4 * sim.c.Stats.bonusAd[eid]!, 'phys');
      },
    },
  },
  onTick(sim, eid) {
    const s = state(sim, eid);
    if (s.vanish < 0) return;
    if (sim.tick > s.vanish || !sim.c.Unit.alive[eid]) return void (s.vanish = -1);
    if (sim.tick - lastCombatTick(sim, eid) >= OUT_OF_COMBAT) {
      s.vanish = -1;
      addBuff(sim, eid, { kind: 'stat', stat: 'invisible', id: 'kaelen_r', src: eid, ticks: sec(10) });
    }
  },
  effects: {
    // W toward a kaelen_mark target near the cursor dashes onto it (range 900) and consumes the mark.
    kaelen_w_dash_to_mark(sim, ctx) {
      if (ctx.phase !== 'dashStart' || !ctx.dash) return;
      const { Pos } = sim.c;
      const e = ctx.caster;
      let best = -1;
      let bestD = Infinity;
      for (const t of enemiesInRadius(sim, e, ctx.cursorX, ctx.cursorY, 250)) {
        if (!hasBuff(sim, t, 'mark', MARK) || dist2(Pos.x[t]!, Pos.y[t]!, Pos.x[e]!, Pos.y[e]!) > 900 * 900) continue;
        const d = dist2(Pos.x[t]!, Pos.y[t]!, ctx.cursorX, ctx.cursorY);
        if (d < bestD) (bestD = d), (best = t);
      }
      if (best < 0) return;
      removeBuffs(sim, best, (b) => b.kind === 'mark' && b.id === MARK);
      ctx.dash.target = best;
      ctx.dash.distance = 900;
    },
    // E hitting an enemy champion: W cooldown -2 s (once per cast).
    kaelen_e_w_refund(sim, ctx) {
      if (ctx.phase === 'cast' && ctx.hits.some((t) => sim.c.Unit.kind[t] === Kind.Champion)) reduceCooldown(sim, ctx.caster, 1, sec(2));
    },
    // R kill: invisible for 10 s once out of combat (window 5 s).
    kaelen_r_vanish(sim, ctx) {
      const t = ctx.hits[0];
      if (ctx.phase === 'cast' && t !== undefined && sim.c.Unit.kind[t] === Kind.Champion && !sim.c.Unit.alive[t]) state(sim, ctx.caster).vanish = sim.tick + sec(5);
    },
  },
};
