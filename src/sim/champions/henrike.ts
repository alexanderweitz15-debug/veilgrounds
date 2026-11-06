// Henrike Federwerk hooks (clockwork marksman). Passive Mainspring (autos wind the spring: attack speed, full tension overwinds
// the next ability), W clockwork turret (a hook-kept deployable that shoots her target). Behaviour list:
// docs/champion-hooks.md; tunables: henrike.values.json. All state lives in sim.state.
import type { Sim } from '../sim';
import { isStructure, sec } from '../types';
import { dealDamage } from '../damage';
import { petsOf, removePet, spawnPet } from '../summons';
import { canTarget } from '../systems/attack';
import { cooldownLeft, enemiesInRadius, reduceCooldown, rv } from '../systems/abilities';
import type { ChampionHooks, ChampionVisuals, VisualObject } from './hooks';
import { hookState, isChampLike, peekState } from './util';
import V from '../../data/champions/henrike.values.json';

interface Spring {
  stacks: number;
  lastWind: number;
  /** Overwound until this tick (the next ability's damage is boosted). */
  overUntil: number;
}
interface Turret {
  x: number;
  y: number;
  start: number;
  until: number;
  next: number;
  rank: number;
  /** The turret as a real unit (HP, can be attacked); it dies with its pet. */
  pet: number;
  /** Damage multiplier fixed at deploy time (overwound deploy). */
  boost: number;
  /** Last shot (visual). */
  shot: { x: number; y: number; tick: number } | null;
}

const SPRING = 'henrikeSpring';
const TURRET = 'henrikeTurret';
const TAG = 'henrike_turret';

const springOf = (sim: Sim, eid: number): Spring => {
  const m = hookState<Spring>(sim, SPRING);
  let s = m.get(eid);
  if (!s) m.set(eid, (s = { stacks: 0, lastWind: -1e9, overUntil: -1 }));
  return s;
};

/** Current spring tension 0..max (decays to 0 after the decay time without an attack). Read-only. */
export function henrikeTension(sim: Sim, eid: number): number {
  const s = peekState<Spring>(sim, SPRING)?.get(eid);
  return s && sim.tick - s.lastWind <= sec(V.spring.decaySec) ? s.stacks : 0;
}

/** Is the next ability overwound (full tension)? */
export const henrikeFull = (sim: Sim, eid: number): boolean => henrikeTension(sim, eid) >= V.spring.max;

/** The ability window after an overwound cast is still open. */
export const henrikeOverwound = (sim: Sim, eid: number): boolean => (peekState<Spring>(sim, SPRING)?.get(eid)?.overUntil ?? -1) >= sim.tick;

/** Live turret of Henrike, or null. */
export function henrikeTurret(sim: Sim, eid: number): Turret | null {
  const t = peekState<Turret>(sim, TURRET)?.get(eid);
  if (!t || t.until <= sim.tick || !petsOf(sim, eid, TAG).includes(t.pet)) return null;
  t.x = sim.c.Pos.x[t.pet]!;
  t.y = sim.c.Pos.y[t.pet]!;
  return t;
}

/** Her attack target if the turret reaches it, else the nearest enemy champion in seek range. */
function turretTarget(sim: Sim, eid: number, t: Turret): number {
  const { Atk, Unit, Pos } = sim.c;
  const inRange = (e: number, r: number): boolean => (Pos.x[e]! - t.x) ** 2 + (Pos.y[e]! - t.y) ** 2 <= (r + Unit.radius[e]!) ** 2;
  const ot = Atk.target[eid]!;
  if (ot >= 0 && Atk.targetSerial[eid] === Unit.serial[ot] && Unit.team[ot] !== Unit.team[eid] && !isStructure(Unit.kind[ot]!) && canTarget(sim, eid, ot) && inRange(ot, V.turret.range)) return ot;
  let best = -1;
  let bd = Infinity;
  for (const e of enemiesInRadius(sim, eid, t.x, t.y, V.turret.targetSeek)) {
    if (!isChampLike(sim, e) || !canTarget(sim, eid, e)) continue;
    const d = (Pos.x[e]! - t.x) ** 2 + (Pos.y[e]! - t.y) ** 2;
    if (d < bd) (bd = d), (best = e);
  }
  return best;
}

function henrikeVisuals(sim: Sim, eid: number): ChampionVisuals {
  const v: ChampionVisuals = {};
  const n = henrikeTension(sim, eid);
  v.passive = { stacks: n, max: V.spring.max, ready: n >= V.spring.max };
  if (n >= V.spring.max) v.aura = 4;
  const t = henrikeTurret(sim, eid);
  if (t) {
    const objs: VisualObject[] = [{ key: `${eid}:turret`, tag: 'henrike_w_turret', x: t.x, y: t.y, r: 60, shape: 'disc', left: t.until - sim.tick, total: t.until - t.start, n: t.boost > 1 ? 1 : 0 }];
    if (t.shot && sim.tick - t.shot.tick <= V.turret.shotTicks) objs.push({ key: `${eid}:shot`, tag: 'henrike_w_shot', x: t.x, y: t.y, x2: t.shot.x, y2: t.shot.y, r: 12, shape: 'line', left: V.turret.shotTicks - (sim.tick - t.shot.tick), total: V.turret.shotTicks });
    v.objects = objs;
  }
  return v;
}

export const hooks: ChampionHooks = {
  visuals: henrikeVisuals,
  passive: {
    henrike_mainspring: {
      // Every auto hit winds the spring by one.
      onAutoHit(sim, eid) {
        const s = springOf(sim, eid);
        const cur = henrikeTension(sim, eid);
        s.stacks = Math.min(V.spring.max, cur + 1);
        s.lastWind = sim.tick;
      },
      // +3 % attack speed per wind. Stats are rebuilt every tick before this runs: no compounding.
      onComputeStats(sim, eid) {
        const n = henrikeTension(sim, eid);
        if (n) sim.c.Stats.as[eid] = sim.c.Stats.as[eid]! * (1 + V.spring.asPerStack * n);
      },
      // Full tension: this cast is overwound (damage window, cooldown refund); the spring unwinds.
      onCast(sim, eid, slot) {
        if (!henrikeFull(sim, eid)) return;
        const s = springOf(sim, eid);
        s.stacks = 0;
        s.overUntil = sim.tick + sec(V.spring.overSec);
        reduceCooldown(sim, eid, slot, Math.round(cooldownLeft(sim, eid, slot) * V.spring.cdRefund));
      },
      modifyDamage(sim, eid, _t, amount, _type, isAuto) {
        return !isAuto && henrikeOverwound(sim, eid) ? amount * V.spring.overDmg : amount;
      },
    },
  },
  effects: {
    // W: deploy the turret (one at a time); a deploy at full tension is an overwound turret.
    henrike_w_turret(sim, ctx) {
      if (ctx.phase !== 'cast') return;
      const m = hookState<Turret>(sim, TURRET);
      for (const old of petsOf(sim, ctx.caster, TAG)) removePet(sim, old);
      const pet = spawnPet(sim, { owner: ctx.caster, tag: TAG, x: ctx.x, y: ctx.y, ticks: sec(V.turret.sec), hp: V.turret.hp[ctx.rank - 1], armor: V.turret.armor, mr: V.turret.armor, radius: 40, vision: 400 });
      m.set(ctx.caster, {
        pet,
        x: ctx.x, y: ctx.y, start: sim.tick, until: sim.tick + sec(V.turret.sec), next: sim.tick + V.turret.everyTicks, rank: ctx.rank,
        boost: henrikeFull(sim, ctx.caster) ? V.spring.overDmg : 1, shot: null,
      });
    },
  },
  onTick(sim, eid) {
    const t = henrikeTurret(sim, eid);
    if (!t || !sim.c.Unit.alive[eid] || sim.tick < t.next) return;
    t.next = sim.tick + V.turret.everyTicks;
    const target = turretTarget(sim, eid, t);
    if (target < 0) return;
    const dmg = (rv(V.turret.dmgBase, t.rank) + V.turret.dmgAd * sim.c.Stats.ad[eid]!) * t.boost;
    t.shot = { x: sim.c.Pos.x[target]!, y: sim.c.Pos.y[target]!, tick: sim.tick };
    dealDamage(sim, eid, target, dmg, 'phys', { isAuto: true });
  },
};
