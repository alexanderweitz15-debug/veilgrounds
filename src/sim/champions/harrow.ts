// Old Harrow hooks. Contract: ./hooks.ts, behaviour list: docs/champion-hooks.md.
import { query } from 'bitecs';
import type { Sim } from '../sim';
import { Kind, isMinion, isStructure, sec, type LaneId } from '../types';
import { dealDamage } from '../damage';
import { addBuff, hasBuff } from '../buffs';
import { dist2 } from '../vec';
import { effectAmount, enemiesInRadius } from '../systems/abilities';
import { reward } from '../systems/economy';
import { laneDir, laneGeo, lanePoint, laneProgress, setLanePath, spawnMinion } from '../systems/minions';
import { towerState } from '../systems/towers';
import { petsOf, trackLifetime } from '../summons';
import type { ChampionHooks, ChampionVisuals, UnitMark } from './hooks';
import { hookState, peekState } from './util';

interface HarrowState {
  /** Enemy minions near Harrow last tick: eid -> serial. */
  near: Map<number, number>;
  killed: number;
  waves: number;
  marchUntil: number;
}

const state = (sim: Sim, eid: number): HarrowState => {
  const m = hookState<HarrowState>(sim, 'harrow');
  let s = m.get(eid);
  if (!s) m.set(eid, (s = { near: new Map(), killed: 0, waves: 0, marchUntil: -1 }));
  return s;
};

const PRESENCE = 1200;
const SIEGE = 'harrow_siege';

/** Nearest living, attackable enemy tower to (x, y), or -1. */
function nearestEnemyTower(sim: Sim, team: number, x: number, y: number): number {
  const { Unit, Pos } = sim.c;
  let best = -1;
  let bestD = Infinity;
  for (const r of towerState(sim).list) {
    const e = r.eid;
    if (r.team === team || Unit.kind[e] !== Kind.Tower || Unit.serial[e] !== r.serial || !Unit.alive[e]) continue;
    const d = dist2(Pos.x[e]!, Pos.y[e]!, x, y);
    if (d < bestD) (bestD = d), (best = e);
  }
  return best;
}

/**
 * Wave bonus: enemy minions seen near Harrow that died count as killed; once none are left near him a wave is
 * cleared; every 4th cleared wave grants 40 gold.
 * ponytail: "killed by his team" is assumed for enemy minions dying near Harrow (no wave ids on minions).
 */
function trackWaves(sim: Sim, eid: number, s: HarrowState): void {
  const { Unit, Pos } = sim.c;
  const now = new Map<number, number>();
  for (const e of query(sim.world, [Unit])) {
    if (Unit.alive[e] && isMinion(Unit.kind[e]!) && Unit.team[e] !== Unit.team[eid] && dist2(Pos.x[e]!, Pos.y[e]!, Pos.x[eid]!, Pos.y[eid]!) <= PRESENCE * PRESENCE)
      now.set(e, Unit.serial[e]!);
  }
  for (const [e, serial] of s.near) if (!now.has(e) && (Unit.serial[e] !== serial || !Unit.alive[e])) s.killed++;
  s.near = now;
  if (now.size === 0 && s.killed > 0) {
    s.killed = 0;
    s.waves++;
    if (s.waves % 4 === 0) reward(sim, eid, 40);
  }
}

/** Read-only view of the summon lifetimes (src/sim/summons.ts keeps them private). */
type PetLifetimes = { pets: Map<number, { serial: number; until: number; tag: string; owner: number }> } | undefined;

/**
 * Snapshot (read-only): cleared waves towards the next 40 gold (badge 0-3 of 4), E march aura + link to the enemy
 * tower that gives the speed (bright while the bonus is active), remaining lifetime on each R siege minion.
 */
function harrowVisuals(sim: Sim, eid: number): ChampionVisuals {
  const { Unit, Pos } = sim.c;
  const s = peekState<HarrowState>(sim, 'harrow')?.get(eid);
  const waves = (s?.waves ?? 0) % 4;
  const v: ChampionVisuals = { passive: { stacks: waves, max: 4, ready: waves === 3 } };
  if (s && sim.tick < s.marchUntil && Unit.alive[eid]) {
    v.aura = 2;
    const t = sim.state.towers ? nearestEnemyTower(sim, Unit.team[eid]!, Pos.x[eid]!, Pos.y[eid]!) : -1;
    if (t >= 0) v.hints = [{ slot: 2, x: Pos.x[t]!, y: Pos.y[t]!, r: Unit.radius[t]! + 60, ok: hasBuff(sim, eid, 'stat', 'harrow_e'), link: true }];
  }
  const pets = (sim.state.summons as PetLifetimes)?.pets;
  if (pets) {
    const marks: UnitMark[] = [];
    for (const [m, r] of pets) if (r.owner === eid && r.tag === SIEGE && Unit.alive[m] && Unit.serial[m] === r.serial && r.until > sim.tick) marks.push({ target: m, id: 'harrow_r_siege', left: r.until - sim.tick });
    if (marks.length) v.marks = marks;
  }
  return v;
}

export const hooks: ChampionHooks = {
  visuals: harrowVisuals,
  passive: {
    // +25 % damage to structures.
    harrow_besieger: {
      modifyDamage(sim, _eid, target, amount) {
        return isStructure(sim.c.Unit.kind[target]!) ? amount * 1.25 : amount;
      },
    },
  },
  onTick(sim, eid) {
    const { Unit, Pos, Move, Face, Atk } = sim.c;
    const s = state(sim, eid);
    if (Unit.alive[eid]) trackWaves(sim, eid, s);
    else s.near.clear();
    // E: +40 % MS while moving within 60 degrees of the direction to the nearest enemy tower
    if (sim.tick < s.marchUntil && Unit.alive[eid] && Move.mode[eid] !== 0) {
      const t = nearestEnemyTower(sim, Unit.team[eid]!, Pos.x[eid]!, Pos.y[eid]!);
      if (t >= 0) {
        const dx = Pos.x[t]! - Pos.x[eid]!;
        const dy = Pos.y[t]! - Pos.y[eid]!;
        const dot = dx * Face.x[eid]! + dy * Face.y[eid]!;
        if (dot > 0 && dot * dot >= 0.25 * (dx * dx + dy * dy)) addBuff(sim, eid, { kind: 'stat', stat: 'ms', id: 'harrow_e', src: eid, pct: 40, ticks: 2 });
      }
    }
    // R minions: towers first (a tower within 800 is attacked before anything else)
    for (const m of petsOf(sim, eid, SIEGE)) {
      const t = nearestEnemyTower(sim, Unit.team[m]!, Pos.x[m]!, Pos.y[m]!);
      if (t < 0 || Unit.untargetable[t] || dist2(Pos.x[t]!, Pos.y[t]!, Pos.x[m]!, Pos.y[m]!) > 800 * 800) continue;
      if (Atk.target[m] !== t) (Atk.target[m] = t), (Atk.targetSerial[m] = Unit.serial[t]!);
      Move.mode[m] = 2;
    }
  },
  effects: {
    // Q on a minion or monster: enemy minions within 200 of it also take the Q damage.
    harrow_q_minion_splash(sim, ctx) {
      const t = ctx.hits[0];
      if (ctx.phase !== 'cast' || t === undefined) return;
      const { Unit, Pos } = sim.c;
      if (!isMinion(Unit.kind[t]!) && Unit.kind[t] !== Kind.Monster) return;
      for (const e of enemiesInRadius(sim, ctx.caster, Pos.x[t]!, Pos.y[t]!, 200)) {
        if (e === t || !isMinion(Unit.kind[e]!)) continue;
        const d = effectAmount(sim, ctx, e);
        dealDamage(sim, ctx.caster, e, d.amount, d.type);
      }
    },
    // ponytail: arming and the stun on the empowered auto are generic (engine next-auto handling).
    harrow_w_next_auto() {},
    harrow_e_march(sim, ctx) {
      if (ctx.phase === 'cast') state(sim, ctx.caster).marchUntil = sim.tick + sec(4);
    },
    // Three allied siege minions on the nearest lane, slightly toward Harrow's base, for 12 s.
    harrow_r_siege_minions(sim, ctx) {
      if (ctx.phase !== 'cast') return;
      const { Pos, Unit } = sim.c;
      const e = ctx.caster;
      const team = Unit.team[e]!;
      let lane: LaneId = 0;
      let bestD = Infinity;
      let prog = 0;
      for (const l of [0, 1, 2] as LaneId[]) {
        const g = laneGeo(sim, team, l);
        const d = laneProgress(g, Pos.x[e]!, Pos.y[e]!);
        const p = lanePoint(g, d);
        const dd = dist2(p.x, p.y, Pos.x[e]!, Pos.y[e]!);
        if (dd < bestD) (bestD = dd), (lane = l), (prog = d);
      }
      const g = laneGeo(sim, team, lane);
      const at = Math.max(0, prog - 150);
      const p = lanePoint(g, at);
      const dir = laneDir(g, at);
      for (const off of [-100, 0, 100]) {
        const m = spawnMinion(sim, Kind.MinionSiege, team, lane, p.x - dir.y * off, p.y + dir.x * off);
        setLanePath(sim, m);
        trackLifetime(sim, m, e, SIEGE, sec(12));
      }
    },
  },
};
