// Player mistake patterns (S2, FEATURE-GAP 6.3). The bots log named errors (src/ai/errors.ts, "injectedError: <id> (dur
// <s> s)" + "detected:<id>"); this module finds comparable patterns in the PLAYER's own play with the same vocabulary
// (shared ids where the bot error exists: overcommit_after_kill, fight_in_enemy_wave) and the same shape (id, start,
// duration, what it cost). It only READS the sim (never sim.rng, never creates state), so it can run live in the sim
// worker (results travel in Replay.player) and again over a replay re-simulation with identical results.
import { query } from 'bitecs';
import type { Sim } from '../sim/sim';
import { Kind, isMinion, type TickInput } from '../sim/types';
import { ccLevel } from '../sim/buffs';

export const PATTERN_IDS = ['tower_chase', 'overcommit_after_kill', 'recall_wave_at_tower', 'idle_minions_in_range', 'missed_lasthit_in_range', 'fight_in_enemy_wave'] as const;
export type PatternId = (typeof PATTERN_IDS)[number];

/** Detection thresholds (ticks at 30 Hz unless named S). */
export const RULES = {
  /** Idle with an enemy minion in reach longer than this (BRAIN-REWORK idle metric, 1.5 s). */
  idleTicks: 45,
  /** No idle detection before 1:45 (first waves have not met, waiting at the tower is fine). */
  idleFrom: 105 * 30,
  /** Reach padding on top of attack range + radius for "in range" (harness: +200 idle, +250 last hits). */
  idlePad: 200,
  lastHitPad: 250,
  /** Tower shots on the player count as one streak until this many ticks pass without a hit. */
  towerGap: 90,
  /** The player attacked an enemy champion this recently when the streak started = "chased into the tower". */
  chaseWindow: 60,
  /** overcommit_after_kill: own champion kill within this many ticks before the tower streak, HP below this at its start. */
  overcommitKill: 8 * 30,
  overcommitHp: 0.4,
  /** recall_wave_at_tower: enemy minions within waveR of the own front tower, at least waveMin; tower within towerNear of the player. */
  waveMin: 3,
  waveR: 1000,
  towerNear: 2500,
  /** Missed last hits are grouped into bursts (gap), reported from missMin per burst. */
  missGap: 20 * 30,
  missMin: 3,
  /** fight_in_enemy_wave: hit by this many different enemy minions while attacking a champion within waveWindow ticks. */
  fightMinions: 2,
  fightWindow: 90,
  fightCooldown: 300,
} as const;

export interface PatternEvent {
  id: PatternId;
  /** Tick the mistake started. */
  tick: number;
  /** How long the player stayed in it, seconds (0 for single moments). */
  durS: number;
  /** Per-pattern facts for the sentence: dmgPct (% of max HP lost), n (count), kills, died (0/1), tower (lane name). */
  vars: Record<string, number | string>;
}

const r1 = (v: number): number => Math.round(v * 10) / 10;

interface Streak {
  from: number;
  last: number;
  dmg: number;
  hp0: number;
  chase: boolean;
  afterKill: boolean;
  died: boolean;
}

export class PatternDetector {
  readonly events: PatternEvent[] = [];
  private attackedChampAt = -1e9;
  private killedAt = -1e9;
  private streak: Streak | null = null;
  private idleFrom = -1;
  private recalling = false;
  private miss: { from: number; last: number; n: number } | null = null;
  private lastFight = -1e9;
  private readonly minionHits = new Map<number, number>();

  constructor(readonly slot: number) {}

  /** Call once after every step (sim.tick already advanced); `inputs` = the inputs of the step just made (unused for now, kept for rules that need commands). */
  observe(sim: Sim, _inputs?: readonly TickInput[]): void {
    const me = sim.slots[this.slot];
    if (me === undefined || me < 0) return;
    const { Unit, Pos, Atk, Move, Champ, Stats } = sim.c;
    // the events of the step just made carry tick - 1
    const T = sim.tick - 1;
    const myTeam = Unit.team[me]!;
    const alive = Unit.alive[me] === 1;
    for (const ev of sim.events) {
      if (ev.e === 'attack' && ev.src === me && ev.dst >= 0 && Unit.kind[ev.dst] === Kind.Champion && Unit.team[ev.dst] !== myTeam) this.attackedChampAt = T;
      else if (ev.e === 'death') {
        if (ev.kind === Kind.Champion && ev.killer === me && ev.team !== myTeam) this.killedAt = T;
        else if (ev.kind === Kind.Champion && ev.eid === me && this.streak) this.streak.died = true;
        else if (isMinion(ev.kind) && ev.team !== myTeam && ev.killer !== me) this.onMinionDeath(sim, me, ev, T);
      } else if (ev.e === 'damage' && ev.dst === me) {
        const k = Unit.kind[ev.src];
        if (k === Kind.Tower && Unit.team[ev.src] !== myTeam) this.onTowerHit(sim, me, ev.amount, T);
        else if (k !== undefined && isMinion(k) && Unit.team[ev.src] !== myTeam) this.onMinionHit(ev.src, ev.amount, T);
      }
    }
    // tower streak ended?
    if (this.streak && T - this.streak.last > RULES.towerGap) this.closeStreak(sim, me);
    if (this.miss && T - this.miss.last > RULES.missGap) this.closeMiss();
    // recall start with a wave at the own tower
    const rec = alive && Champ.recallAt[me]! > sim.tick;
    if (rec && !this.recalling) this.onRecallStart(sim, me, T);
    this.recalling = rec;
    // idle with enemy minions in reach: sampled at 6 Hz
    if (T % 5 !== 0) return;
    if (!alive || rec || T < RULES.idleFrom || Atk.phase[me] !== 0 || Move.mode[me] !== 0 || Atk.target[me]! >= 0 || ccLevel(sim, me) >= 3) return this.closeIdle(T);
    const reach = Stats.range[me]! + Unit.radius[me]! + RULES.idlePad;
    let near = false;
    for (const u of query(sim.world, [Pos])) {
      const k = Unit.kind[u]!;
      if (!(isMinion(k) && Unit.team[u] !== myTeam && Unit.alive[u])) continue;
      const rr = reach + Unit.radius[u]!;
      if ((Pos.x[u]! - Pos.x[me]!) ** 2 + (Pos.y[u]! - Pos.y[me]!) ** 2 <= rr * rr) {
        near = true;
        break;
      }
    }
    if (!near) return this.closeIdle(T);
    if (this.idleFrom < 0) this.idleFrom = T;
  }

  private closeIdle(T: number): void {
    if (this.idleFrom >= 0 && T - this.idleFrom >= RULES.idleTicks) this.events.push({ id: 'idle_minions_in_range', tick: this.idleFrom, durS: r1((T - this.idleFrom) / 30), vars: {} });
    this.idleFrom = -1;
  }

  private onMinionDeath(sim: Sim, me: number, ev: { x: number; y: number; killerKind?: number }, T: number): void {
    const { Unit, Pos, Atk, Champ, Stats } = sim.c;
    if (Unit.alive[me] !== 1 || Champ.recallAt[me]! > sim.tick) return;
    if (ev.killerKind === Kind.Champion) return; // a teammate's CS is not the player's miss
    const t = Atk.target[me]!;
    if (t >= 0 && Unit.kind[t] === Kind.Champion) return; // trading, not farming
    const reach = Stats.range[me]! + Unit.radius[me]! + RULES.lastHitPad;
    if ((Pos.x[me]! - ev.x) ** 2 + (Pos.y[me]! - ev.y) ** 2 > reach * reach) return;
    if (this.miss && T - this.miss.last <= RULES.missGap) {
      this.miss.n++;
      this.miss.last = T;
    } else {
      this.closeMiss();
      this.miss = { from: T, last: T, n: 1 };
    }
  }

  private closeMiss(): void {
    const m = this.miss;
    this.miss = null;
    if (m && m.n >= RULES.missMin) this.events.push({ id: 'missed_lasthit_in_range', tick: m.from, durS: r1((m.last - m.from) / 30), vars: { n: m.n } });
  }

  private onTowerHit(sim: Sim, me: number, amount: number, T: number): void {
    const { Hp } = sim.c;
    if (!this.streak) {
      const chase = T - this.attackedChampAt <= RULES.chaseWindow;
      const max = Hp.max[me]! || 1;
      // hp at the start of the streak: current + the hit just taken
      const hp0 = (Hp.cur[me]! + amount) / max;
      this.streak = { from: T, last: T, dmg: 0, hp0, chase, afterKill: T - this.killedAt <= RULES.overcommitKill && hp0 < RULES.overcommitHp, died: false };
    }
    const s = this.streak;
    s.dmg += amount;
    s.last = T;
    // a chase can start late in the streak: the player attacks a champion under the tower after the first shot
    if (!s.chase && T - this.attackedChampAt <= RULES.chaseWindow) s.chase = true;
  }

  private closeStreak(sim: Sim, me: number): void {
    const s = this.streak;
    this.streak = null;
    if (!s || !(s.chase || s.afterKill)) return;
    const max = sim.c.Hp.max[me] || 1;
    this.events.push({
      id: s.afterKill ? 'overcommit_after_kill' : 'tower_chase',
      tick: s.from,
      durS: r1((s.last - s.from) / 30),
      vars: { dmgPct: Math.round((s.dmg / max) * 100), died: s.died ? 1 : 0, hpPct: Math.round(s.hp0 * 100) },
    });
  }

  private onMinionHit(src: number, amount: number, T: number): void {
    if (T - this.attackedChampAt > RULES.fightWindow) return;
    this.minionHits.set(src, T);
    let n = 0;
    for (const [m, at] of this.minionHits) {
      if (T - at > RULES.fightWindow) this.minionHits.delete(m);
      else n++;
    }
    if (n >= RULES.fightMinions && T - this.lastFight > RULES.fightCooldown) {
      this.lastFight = T;
      this.events.push({ id: 'fight_in_enemy_wave', tick: T, durS: 0, vars: { n, dmg: Math.round(amount) } });
    }
  }

  private onRecallStart(sim: Sim, me: number, T: number): void {
    const { Unit, Pos } = sim.c;
    const myTeam = Unit.team[me]!;
    let front = -1;
    let best = RULES.towerNear * RULES.towerNear;
    const units = [...query(sim.world, [Pos])];
    for (const u of units) {
      if (Unit.kind[u] !== Kind.Tower || Unit.team[u] !== myTeam || !Unit.alive[u]) continue;
      const d = (Pos.x[u]! - Pos.x[me]!) ** 2 + (Pos.y[u]! - Pos.y[me]!) ** 2;
      if (d < best) {
        best = d;
        front = u;
      }
    }
    if (front < 0) return;
    let n = 0;
    for (const u of units) {
      if (isMinion(Unit.kind[u]!) && Unit.team[u] !== myTeam && Unit.alive[u] && (Pos.x[u]! - Pos.x[front]!) ** 2 + (Pos.y[u]! - Pos.y[front]!) ** 2 < RULES.waveR * RULES.waveR) n++;
    }
    if (n >= RULES.waveMin) this.events.push({ id: 'recall_wave_at_tower', tick: T, durS: 0, vars: { n } });
  }

  /** Close open patterns at the end of the game (call once; events sorted by tick). */
  finish(sim: Sim): PatternEvent[] {
    const me = sim.slots[this.slot];
    const T = sim.tick - 1;
    this.closeIdle(T);
    this.closeMiss();
    if (this.streak && me !== undefined && me >= 0) this.closeStreak(sim, me);
    return [...this.events].sort((a, b) => a.tick - b.tick);
  }
}
