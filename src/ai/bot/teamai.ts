// Team AI (main spec §7/§8, docs/spec-bots.md §8): one per team, fed by its bots' fog-filtered snapshots (team
// vision, scoreboard, announced epic-monster deaths, pings). Desires are re-evaluated at the profile's macro
// interval (x macroIntervalMult) and assigned to bot slots:
//   push_lane, defend_lane, take_objective, contest_objective, set_vision, group_mid, split_push, recall_window
//   (+ rank-typical non-conversion after a won skirmish: chase / idle / force_baron).
// Objective start: safety = 0.5 x prio x vision x numbers x smite vs. a rank threshold (tree.json params) shifted by
// the objective-risk axis. Conversion after a won skirmish (>= 2 enemies dead within 12 s, fewer own deaths):
// profile objectiveConversionPct; otherwise Iron chases, Bronze/Silver recall, Gold/Platinum idle 8 s,
// Emerald+ force baron without vision.

import { Rng } from '../../sim/rng';
import { BARON_HP_PER_MIN, CAMPS, MONSTER_HP_PER_LEVEL, SCHLEIER_BUFF_TICKS } from '../../sim/systems/jungle';
import { Kind, type PlayerSetup } from '../../sim/types';
import type { LaneName, MapData, Pt } from '../../sim/map';
import type { RankProfile } from '../profiles/schema';
import type { BotParams, DecisionLog } from '../contract';
import type { NodeCtx } from '../bt/types';
import { dst } from './geo';
import treeData from '../../data/bots/tree.json';
import { utilityOn } from '../utility/flag';
import { VALUES, rankCurve } from '../utility/values';

/** Log names of the conversion targets (§7.4 convert: tower | dragon | baron | kesselbrut). */
const CONVERT_NAME: Record<string, string> = { leviathan: 'dragon', schleierwaechter: 'baron', kesselbrut: 'kesselbrut' };

export type DesireKind =
  | 'push_lane'
  | 'defend_lane'
  | 'take_objective'
  | 'contest_objective'
  | 'set_vision'
  | 'group_mid'
  | 'split_push'
  | 'recall_window'
  | 'chase'
  | 'idle';
export type ObjectiveId = 'leviathan' | 'schleierwaechter' | 'kesselbrut';
/** Camp data of an objective, if the sim spawns it (Kesselbrut is in the map data but not spawned yet). */
const campOf = (o: ObjectiveId): { first: number; respawn: number; monsters: { hp: number }[] } | undefined => (CAMPS as Record<string, { first: number; respawn: number; monsters: { hp: number }[] }>)[o];
export const OBJECTIVES: ObjectiveId[] = (['leviathan', 'schleierwaechter', 'kesselbrut'] as ObjectiveId[]).filter((o) => !!campOf(o));
/** Kesselbrut (herald) leaves its pit to the Schleierwaechter at 20:00: not started after 19:45. */
const HERALD_UNTIL_S = 19 * 60 + 45;
/** Objective feasibility: the assigned group must kill the monster within this many seconds (rough DPS model). */
const KILL_WITHIN_S: Record<ObjectiveId, number> = { leviathan: 25, kesselbrut: 30, schleierwaechter: 35 };
/** No new start on the same objective for this long after a start (a failed take is not retried at once). */
const OBJECTIVE_RETRY_S = 180;
/** The group / siege decision is re-rolled at most this often (a desire lasts 90 s, then laners go back). */
const GROUP_ROLL_S = 180;

export interface Desire {
  kind: DesireKind;
  score: number;
  x: number;
  y: number;
  lane?: LaneName;
  obj?: ObjectiveId;
  slots: number[];
  reason: string;
  from: number;
  until: number;
}

interface Member {
  slot: number;
  role: PlayerSetup['role'];
  champion: string;
  profile: RankProfile;
  params: BotParams;
}

type Thresholds = Record<string, { dragon: number; baron: number; prepS: number }>;
const THRESH = treeData.params.objectiveThresholds as Thresholds;
const SKILLS: [string, number][] = [['iron', 5], ['bronze', 15], ['silver', 30], ['gold', 45], ['platinum', 58], ['emerald', 68], ['diamond', 80], ['master', 88], ['grandmaster', 94], ['challenger', 100]];

/** Objective thresholds at a continuous skill (linear between the two nearest rank anchors). */
export function objectiveThresholds(skill: number): { dragon: number; baron: number; prepS: number } {
  let lo = SKILLS[0]!;
  let hi = SKILLS[SKILLS.length - 1]!;
  for (let i = 0; i + 1 < SKILLS.length; i++) if (skill >= SKILLS[i]![1] && skill <= SKILLS[i + 1]![1]) (lo = SKILLS[i]!), (hi = SKILLS[i + 1]!);
  const t = hi[1] === lo[1] ? 0 : Math.max(0, Math.min(1, (skill - lo[1]) / (hi[1] - lo[1])));
  const a = THRESH[lo[0]]!;
  const b = THRESH[hi[0]]!;
  return { dragon: a.dragon + (b.dragon - a.dragon) * t, baron: a.baron + (b.baron - a.baron) * t, prepS: a.prepS + (b.prepS - a.prepS) * t };
}

const LANES: LaneName[] = ['top', 'mid', 'bot'];

export class TeamAI {
  desires: Desire[] = [];
  readonly members: Member[] = [];
  /** Tick from which each objective is believed alive. */
  readonly aliveFrom: Record<ObjectiveId, number> = {
    leviathan: CAMPS.leviathan.first * 30,
    schleierwaechter: CAMPS.schleierwaechter.first * 30,
    kesselbrut: (campOf('kesselbrut')?.first ?? 1e9) * 30,
  };
  private nextEval = 0;
  private lastTick = -1;
  private readonly deaths = new Map<number, number>();
  readonly enemyDeaths: number[] = [];
  readonly ownDeaths: number[] = [];
  private conversionAt = -1e9;
  /** Player pings: objective (obj + until), group (until). */
  objectivePing: { obj: ObjectiveId; until: number } | null = null;
  groupPingUntil = 0;
  private readonly rng: Rng;
  private groupRoll: boolean | null = null;
  private groupRollAt = -1e9;
  private sideFarmers = new Set<number>();
  /** Enemy towers/inhibitors seen destroyed (structure deaths are public events): position keys. */
  private readonly enemyStructuresDown = new Set<string>();
  /** Tick before which an objective is not started again (a try ran out without the kill). */
  private readonly retryAt: Record<ObjectiveId, number> = { leviathan: 0, schleierwaechter: 0, kesselbrut: 0 };
  /** Own Schleierwaechter buff (own team took it, announced kill): until this tick. */
  private baronUntil = -1;
  /** Press-the-advantage episode: rolled once per episode (null = no advantage right now). */
  private pressRoll: boolean | null = null;

  constructor(
    readonly team: number,
    private readonly map: MapData,
    private readonly players: readonly PlayerSetup[],
    seed: number,
    private readonly log: DecisionLog,
  ) {
    this.rng = new Rng((seed ^ (0x7ea4 + team * 977)) >>> 0);
  }

  register(m: Member): void {
    this.members.push(m);
  }

  private meanSkill(): number {
    return this.members.reduce((s, m) => s + m.profile.skill, 0) / Math.max(1, this.members.length);
  }
  private mean(f: (m: Member) => number): number {
    return this.members.reduce((s, m) => s + f(m), 0) / Math.max(1, this.members.length);
  }

  desireFor(slot: number, tick: number): Desire | null {
    let best: Desire | null = null;
    for (const d of this.desires) if (d.until > tick && d.from <= tick && d.slots.includes(slot) && (!best || d.score > best.score)) best = d;
    return best;
  }

  objectiveAlive(o: ObjectiveId, tick: number): boolean {
    return tick >= this.aliveFrom[o];
  }

  objectivePos(o: ObjectiveId): Pt {
    return this.map.objectives[o];
  }

  private teamLog(tick: number, chosen: string, reason: string, inputs: Record<string, number | string | boolean>, scores?: Record<string, number>): void {
    const slot = this.members.find((m) => m.role === 'jungle')?.slot ?? this.members[0]?.slot ?? -1;
    this.log.push({ tick, bot: slot, node: 'teamAI', inputs, ...(scores ? { scores } : {}), chosen, reason });
  }

  /** Called from every bot decision of this team (housekeeping). Cheap; re-evaluates at the macro interval. */
  update(n: NodeCtx): void {
    const tick = n.snap.tick;
    // announced epic monster deaths (fog-safe event): respawn timers
    n.snap.events.forEach((ev, i) => {
      if (ev.e === 'death' && (ev.kind === Kind.Tower || ev.kind === Kind.Inhibitor) && ev.team !== this.team) this.enemyStructuresDown.add(`${Math.round(ev.x / 100)},${Math.round(ev.y / 100)}`);
      if (ev.e !== 'death' || ev.kind !== Kind.Monster) return;
      for (const o of OBJECTIVES) {
        if (dst(ev, this.map.objectives[o]) > 900 || !this.objectiveAlive(o, tick)) continue;
        const at = n.snap.eventTicks?.[i] ?? tick;
        this.aliveFrom[o] = at + (campOf(o)?.respawn ?? 360) * 30;
        this.desires = this.desires.filter((d) => d.obj !== o);
        const byTeam = ev.killer >= 0 && n.snap.entities.some((e) => e.id === ev.killer && e.team === this.team);
        if (o === 'schleierwaechter' && byTeam) {
          this.baronUntil = at + SCHLEIER_BUFF_TICKS;
          this.nextEval = Math.min(this.nextEval, tick); // take the buff to a lane at once
        }
        this.teamLog(tick, 'objective_down', `${o} killed`, { obj: o, byTeam });
      }
    });
    if (tick === this.lastTick) return;
    this.lastTick = tick;
    // scoreboard deaths (public)
    let enemyDied = false;
    for (const r of n.snap.players) {
      const prev = this.deaths.get(r.slot) ?? 0;
      if (r.deaths > prev) {
        for (let k = prev; k < r.deaths; k++) (r.team === this.team ? this.ownDeaths : this.enemyDeaths).push(tick);
        if (r.team !== this.team) enemyDied = true;
      }
      this.deaths.set(r.slot, r.deaths);
    }
    if (enemyDied && this.wonSkirmish(tick) && tick - this.conversionAt > 30 * 30) this.convert(n, tick);
    if (tick >= this.nextEval) {
      const interval = this.mean((m) => m.profile.behavior.macroIntervalS * m.params.knobs.macroIntervalMult);
      this.nextEval = tick + Math.max(30, Math.round(interval * 30));
      this.evaluate(n, tick);
    }
  }

  /** >= 2 enemy deaths in the last 12 s and fewer own deaths. */
  wonSkirmish(tick: number): boolean {
    const e = this.enemyDeaths.filter((t) => tick - t <= 12 * 30).length;
    const o = this.ownDeaths.filter((t) => tick - t <= 12 * 30).length;
    return e >= 2 && o < e;
  }

  /** Objective conversion decision after a won skirmish (spec §8, test 9). Public for tests. */
  convert(n: NodeCtx, tick: number): Desire {
    this.conversionAt = tick;
    const pct = this.mean((m) => m.profile.behavior.objectiveConversionPct);
    const skill = this.meanSkill();
    const alive = this.members.filter((m) => !n.snap.players.find((r) => r.slot === m.slot)?.dead).map((m) => m.slot);
    const until = tick + 45 * 30;
    let d: Desire;
    if (this.rng.chance(pct / 100)) {
      const time = tick / 30;
      const objs = OBJECTIVES.filter((o) => this.aliveFrom[o] - tick < 20 * 30 && (o !== 'schleierwaechter' || time >= 20 * 60) && (o !== 'kesselbrut' || time < HERALD_UNTIL_S));
      if (objs.length) {
        const o = objs.sort((a, b) => (a === 'schleierwaechter' ? -1 : 0) - (b === 'schleierwaechter' ? -1 : 0))[0]!;
        const p = this.map.objectives[o];
        d = { kind: 'take_objective', obj: o, score: 1, x: p.x, y: p.y, slots: alive, reason: 'won skirmish: convert', from: tick, until };
      } else {
        const lane = this.siegeLane(n);
        const p = this.siegeTarget(n, lane);
        d = { kind: 'push_lane', lane, score: 1, x: p.x, y: p.y, slots: alive, reason: 'won skirmish: convert to tower', from: tick, until };
      }
    } else {
      // rank-typical non-conversion
      const baron = this.objectiveAlive('schleierwaechter', tick);
      const kind: DesireKind = skill < 12 ? 'chase' : skill < 40 ? 'recall_window' : skill < 64 ? 'idle' : baron ? 'take_objective' : 'idle';
      const p = kind === 'take_objective' ? this.map.objectives.schleierwaechter : { x: 0, y: 0 };
      d = {
        kind,
        ...(kind === 'take_objective' ? { obj: 'schleierwaechter' as const } : {}),
        score: 1,
        x: p.x,
        y: p.y,
        slots: alive,
        reason: kind === 'take_objective' ? 'won skirmish: force baron without vision' : `won skirmish: no conversion (${kind})`,
        from: tick,
        until: kind === 'idle' ? tick + 8 * 30 : kind === 'chase' ? tick + 10 * 30 : until,
      };
    }
    this.desires = this.desires.filter((x) => !x.slots.some((s) => d.slots.includes(s)) || x.kind === 'split_push');
    this.desires.push(d);
    this.teamLog(tick, d.kind, d.reason, { obj: d.obj ?? '', alive: alive.length }, { conversionPct: pct });
    // §7.4: the conversion is its own logged decision (convert: tower | dragon | baron | kesselbrut | none(reason))
    if (utilityOn(n.ctx)) {
      const what = d.kind === 'push_lane' ? 'tower' : d.kind === 'take_objective' ? CONVERT_NAME[d.obj!] : `none(${d.kind})`;
      this.log.push({ tick, bot: n.ctx.slot, node: 'convert', inputs: { obj: d.obj ?? '', alive: alive.length, team: this.team }, scores: { conversionPct: pct }, chosen: what, reason: d.reason });
    }
    return d;
  }

  private structureDown(p: Pt): boolean {
    return this.enemyStructuresDown.has(`${Math.round(p.x / 100)},${Math.round(p.y / 100)}`);
  }

  /**
   * Next enemy structure of a lane's chain (structures are always visible): lane towers outer -> inhibitor tower,
   * inhibitor, then nexus towers and the nexus. `depth` 0..2 = lane towers, 3 = inhibitor, 4 = nexus tower, 5 = nexus.
   */
  nextStructure(n: NodeCtx, lane: LaneName): { p: Pt; depth: number } {
    const side = this.map.sides[this.team === 1 ? 0 : 1];
    const all = [...n.v.enemyTowers, ...n.v.enemyStructures];
    const standing = (p: Pt): boolean => all.some((e) => dst(e, p) < 200);
    const towers = side.towers[lane];
    for (let i = 0; i < towers.length; i++) if (standing(towers[i]!)) return { p: towers[i]!, depth: i };
    if (standing(side.inhibitors[lane])) return { p: side.inhibitors[lane], depth: 3 };
    const nt = side.nexusTowers.filter(standing).sort((a, b) => dst(a, towers[towers.length - 1]!) - dst(b, towers[towers.length - 1]!))[0];
    if (nt) return { p: nt, depth: 4 };
    return { p: side.nexus, depth: 5 };
  }

  /** Siege point of a lane: its next standing enemy structure (inhibitor / nexus once the lane towers are down). */
  siegeTarget(n: NodeCtx, lane: LaneName): Pt {
    return this.nextStructure(n, lane).p;
  }

  /** Lane to siege: the one pushed deepest (next structure furthest down the chain), mid on ties; none down yet ->
   *  the lane whose next structure is nearest to the team. */
  private siegeLane(n: NodeCtx): LaneName {
    const depth = (l: LaneName): number => this.nextStructure(n, l).depth;
    const best = LANES.slice().sort((a, b) => depth(b) - depth(a) || (a === 'mid' ? -1 : b === 'mid' ? 1 : 0))[0]!;
    return depth(best) > 0 ? best : this.weakestEnemyLane(n);
  }

  private weakestEnemyLane(n: NodeCtx): LaneName {
    let best: LaneName = 'mid';
    let bestD = Infinity;
    const c = this.centroid(n);
    for (const l of LANES) {
      const p = this.nextStructure(n, l).p;
      if (dst(p, c) < bestD) (bestD = dst(p, c)), (best = l);
    }
    return best;
  }

  private centroid(n: NodeCtx): Pt {
    const pts = [n.v.self, ...n.v.allies];
    return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
  }

  private aliveCounts(n: NodeCtx): { own: number; enemy: number } {
    let own = 0;
    let enemy = 0;
    for (const r of n.snap.players) if (!r.dead) r.team === this.team ? own++ : enemy++;
    return { own, enemy };
  }

  /** Objective safety (spec §8): 0.5 x prio x vision x numbers x smite, 0..1. */
  safety(n: NodeCtx, o: ObjectiveId): number {
    const { own, enemy } = this.aliveCounts(n);
    const p = this.map.objectives[o];
    const prio = 1 + 0.15 * Math.max(-2, Math.min(2, n.v.ownMinions.length > n.v.enemyMinions.length ? 1 : n.v.ownMinions.length < n.v.enemyMinions.length ? -1 : 0));
    const vision = n.snap.entities.some((e) => e.ward && e.team === this.team && dst(e, p) < 1500) ? 1.2 : 0.85;
    const numbers = 1 + 0.25 * (own - enemy);
    const ownJg = this.players.find((q) => q.team === this.team && q.role === 'jungle');
    const enJg = this.players.find((q) => q.team !== this.team && q.role === 'jungle');
    const jgDead = (s?: number): boolean => !!n.snap.players.find((r) => r.slot === s)?.dead;
    const smite = jgDead(ownJg?.slot) ? 0.8 : jgDead(enJg?.slot) ? 1.2 : 1;
    return Math.max(0, Math.min(1, 0.5 * prio * vision * numbers * smite));
  }

  private evaluate(n: NodeCtx, tick: number): void {
    const keep = this.desires.filter((d) => d.until > tick && (d.reason.startsWith('won skirmish') || d.kind === 'split_push' || d.kind === 'take_objective'));
    const out: Desire[] = [...keep];
    const busy = new Set(keep.flatMap((d) => d.slots));
    const time = tick / 30;
    const skill = this.meanSkill();
    const th = objectiveThresholds(skill);
    const riskShift = this.mean((m) => m.params.knobs.objectiveSafetyThreshold) - 0.55;
    const latency = this.members.find((m) => m.role === 'jungle')?.profile.behavior.objectiveLatencyS ?? this.members[0]?.profile.behavior.objectiveLatencyS ?? null;
    const alive = (s: number): boolean => !n.snap.players.find((r) => r.slot === s)?.dead;
    const free = this.members.filter((m) => alive(m.slot) && !busy.has(m.slot));
    const byDist = (p: Pt): Member[] =>
      [...free].sort((a, b) => {
        const pa = n.snap.entities.find((e) => e.kind === Kind.Champion && e.slot === a.slot);
        const pb = n.snap.entities.find((e) => e.kind === Kind.Champion && e.slot === b.slot);
        return (pa ? dst(pa, p) : 1e9) - (pb ? dst(pb, p) : 1e9);
      });
    // press the advantage (LoL closing): numbers up after a fight (>= 2 more alive with >= 3 up, or the enemy wiped),
    // or the Schleierwaechter buff with even numbers -> every free member pushes the deepest lane to its next
    // structure (inhibitor, nexus towers, nexus once open). Rolled once per advantage episode with the conversion
    // rate (Iron 58 % .. Challenger 98 %); re-checked every macro evaluation, so it ends when the advantage does.
    {
      const { own, enemy } = this.aliveCounts(n);
      const baron = this.baronUntil > tick;
      const adv = (own >= 3 && own - enemy >= 2) || (enemy === 0 && own >= 2) || (baron && own >= 3 && own >= enemy);
      if (!adv) this.pressRoll = null;
      else {
        this.pressRoll ??= this.rng.chance(0.5 + 0.5 * (this.mean((m) => m.profile.behavior.objectiveConversionPct) / 100));
        const g = free.filter((m) => !busy.has(m.slot));
        if (this.pressRoll && g.length) {
          const lane = this.siegeLane(n);
          const p = this.siegeTarget(n, lane);
          const why = baron && own - enemy < 2 ? 'schleierwaechter buff: siege' : `numbers ${own} vs ${enemy}: press`;
          out.push({ kind: 'push_lane', lane, score: 0.9, x: p.x, y: p.y, slots: g.map((m) => m.slot), reason: why, from: tick, until: tick + 40 * 30 });
          g.forEach((m) => busy.add(m.slot));
        }
      }
    }
    // objectives (Iron: no objective decisions)
    if (latency !== null) {
      for (const o of OBJECTIVES) {
        const p = this.map.objectives[o];
        const ping = this.objectivePing && this.objectivePing.obj === o && this.objectivePing.until > tick ? 0.3 : 0;
        const left = (this.aliveFrom[o] - tick) / 30;
        if (left > 0 && left <= Math.max(th.prepS, 0) && left <= 90) {
          // preparation: vision + group near the pit
          const sup = free.filter((m) => m.role === 'support' || m.role === 'jungle').map((m) => m.slot);
          if (sup.length) out.push({ kind: 'set_vision', obj: o, score: 0.5 + ping, x: p.x, y: p.y, slots: sup, reason: `${o} in ${Math.round(left)} s`, from: tick, until: tick + Math.round(left * 30) + 30 });
          continue;
        }
        if (left > 0 || (o === 'schleierwaechter' && time < 20 * 60) || (o === 'kesselbrut' && time >= HERALD_UNTIL_S)) continue;
        // §7.4 (utility flag): Kesselbrut is an objective from Gold on (rank curve), taken by jungler + top
        const grubs = o === 'kesselbrut' && utilityOn(n.ctx);
        if (grubs && rankCurve(VALUES.macro.kesselbrutRank, skill) < 0.5) continue;
        const s = this.safety(n, o) + ping;
        const thr = (o === 'schleierwaechter' ? th.baron : th.dragon) + riskShift;
        const jg0 = free.find((m) => m.role === 'jungle');
        // who goes: baron = the team; dragon = jungler + support + the nearest laner; Kesselbrut = jungler + support
        // (laners keep farming: an objective is not a reason to empty the lanes)
        const sup0 = free.find((m) => m.role === (grubs ? 'top' : 'support'));
        const core = [...(jg0 ? [jg0] : []), ...(sup0 ? [sup0] : [])];
        const extra = o === 'schleierwaechter' ? 5 : o === 'leviathan' ? 1 : 0;
        const laners = byDist(p).filter((m) => !core.includes(m)).slice(0, o === 'schleierwaechter' ? 5 : extra);
        const team = [...core, ...laners].slice(0, o === 'schleierwaechter' ? 5 : 3).map((m) => m.slot);
        // feasibility: rough team DPS (level-based) must kill the monster within KILL_WITHIN_S; monster HP as the sim
        // scales it (public game knowledge): Baron + BARON_HP_PER_MIN per minute after 20:00, others by the average
        // champion level (scoreboard)
        const dps = team.reduce((a, sl) => a + 0.55 * (40 + 12 * (n.snap.players.find((r) => r.slot === sl)?.level ?? 1)), 0);
        const avgLevel = n.snap.players.reduce((a, r) => a + r.level, 0) / Math.max(1, n.snap.players.length);
        const baseHp = campOf(o)?.monsters.reduce((a, m) => a + m.hp, 0) ?? 5000;
        const hp = o === 'schleierwaechter' ? baseHp + BARON_HP_PER_MIN * Math.max(0, Math.floor(time / 60 - 20)) : baseHp * (1 + MONSTER_HP_PER_LEVEL * Math.max(0, avgLevel - 1));
        const killS = hp / Math.max(1, dps);
        // grubs die one at a time and each gives a stack: a longer take is still worth it (values.json macro)
        const within = grubs ? VALUES.macro.kesselbrutKillWithinS : KILL_WITHIN_S[o];
        if (s >= thr && killS <= within && tick >= this.retryAt[o]) {
          this.retryAt[o] = tick + OBJECTIVE_RETRY_S * 30;
          out.push({ kind: 'take_objective', obj: o, score: s, x: p.x, y: p.y, slots: team, reason: `safety ${s.toFixed(2)} >= ${thr.toFixed(2)}`, from: tick + Math.round(latency * 30 * 0.3), until: tick + 45 * 30 });
          team.forEach((x) => busy.add(x));
        } else {
          // contest / steal: enemies at the pit, steal knob + Platinum+
          const foes = n.v.enemies.filter((e) => dst(e, p) < 1200).length;
          const jg = free.find((m) => m.role === 'jungle' && m.params.knobs.stealAttempts && m.profile.skill >= 58);
          if (foes >= 2 && jg) out.push({ kind: 'contest_objective', obj: o, score: 0.8, x: p.x, y: p.y, slots: [jg.slot], reason: 'enemies on objective: steal attempt', from: tick, until: tick + 20 * 30 });
        }
      }
    }
    // defend: >= 2 visible enemies at an own tower
    for (const t of n.v.ownTowers) {
      const foes = n.v.enemies.filter((e) => dst(e, t) < 1500).length;
      if (foes < 2) continue;
      const lane = LANES.find((l) => this.map.sides[this.team === 1 ? 1 : 0].towers[l].some((q) => dst(q, t) < 200));
      const def = byDist(t).filter((m) => !busy.has(m.slot)).slice(0, 2).map((m) => m.slot);
      if (def.length) out.push({ kind: 'defend_lane', ...(lane ? { lane } : {}), score: 0.7, x: t.x, y: t.y, slots: def, reason: `${foes} enemies at own tower`, from: tick, until: tick + 30 * 30 });
      def.forEach((x) => busy.add(x));
    }
    // §7.1 (utility flag): siege from 11:00 when a lane is won (its enemy laner >= 2 deaths behind or >= 1000 item
    // gold behind, public scoreboard): jungler + support rotate there with the lane's laner
    if (utilityOn(n.ctx) && time >= VALUES.macro.siegeFromS && time < 14 * 60 && rankCurve(VALUES.macro.siegeRank, skill) >= 0.5) {
      const row = (role: string, team: number) => {
        const q = this.players.find((x) => x.team === team && x.role === role);
        return q ? n.snap.players.find((r) => r.slot === q.slot) : undefined;
      };
      const enemyTeam = this.team === 1 ? 0 : 1;
      for (const [lane, role] of [['top', 'top'], ['mid', 'mid'], ['bot', 'adc']] as [LaneName, string][]) {
        const mine = row(role, this.team);
        const theirs = row(role, enemyTeam);
        if (!mine || !theirs) continue;
        const won = theirs.deaths - mine.deaths >= VALUES.macro.laneWonDeaths || mine.itemValue - theirs.itemValue >= VALUES.macro.laneWonGold;
        if (!won) continue;
        const g = free.filter((m) => !busy.has(m.slot) && (m.role === 'jungle' || m.role === 'support' || m.role === role)).map((m) => m.slot);
        if (g.length < 2) continue;
        const p = this.siegeTarget(n, lane);
        out.push({ kind: 'push_lane', lane, score: VALUES.macro.siegeScore, x: p.x, y: p.y, slots: g, reason: `lane ${lane} won: siege`, from: tick, until: tick + VALUES.macro.siegeS * 30 });
        g.forEach((x) => busy.add(x));
        break;
      }
    }
    // punish absence (Gold+): an enemy laner is dead -> its lane opponent shoves; the human ally died -> cover lane
    if (skill >= 45) {
      for (const r of n.snap.players) {
        if (r.team === this.team || !r.dead) continue;
        const role = this.players.find((q) => q.slot === r.slot)?.role;
        const lane: LaneName | null = role === 'top' ? 'top' : role === 'mid' ? 'mid' : role === 'adc' ? 'bot' : null;
        if (!lane) continue;
        const m = free.find((x) => !busy.has(x.slot) && (x.role === role || (lane === 'bot' && x.role === 'support')));
        if (!m) continue;
        const p = this.map.sides[this.team === 1 ? 0 : 1].towers[lane][0]!;
        out.push({ kind: 'push_lane', lane, score: 0.6, x: p.x, y: p.y, slots: [m.slot], reason: `enemy ${role} dead: punish`, from: tick, until: tick + 25 * 30 });
        busy.add(m.slot);
      }
    }
    for (const q of this.players) {
      if (q.team !== this.team || !q.isHuman || !n.snap.players.find((r) => r.slot === q.slot)?.dead) continue;
      const lane: LaneName | null = q.role === 'top' ? 'top' : q.role === 'mid' ? 'mid' : q.role === 'adc' ? 'bot' : null;
      if (!lane) continue;
      const tower = this.map.sides[this.team === 1 ? 1 : 0].towers[lane][0]!;
      const cover = byDist(tower).find((m) => !busy.has(m.slot) && m.role !== 'support');
      if (!cover) continue;
      out.push({ kind: 'defend_lane', lane, score: 0.55, x: tower.x, y: tower.y, slots: [cover.slot], reason: 'player dead: cover the lane', from: tick, until: tick + 20 * 30 });
      busy.add(cover.slot);
    }
    // split push (teamplay <= -3 or Old Harrow) after 14:00; group mid after the first tower (15:00+) or on a group ping
    for (const m of free) {
      if (busy.has(m.slot) || time < 14 * 60) continue;
      if (m.params.playstyle.teamplay <= -3 || m.champion === 'harrow') {
        if (this.groupPingUntil > tick && m.params.playstyle.teamplay > -2) continue; // split pushers stop on a group ping (team > -2)
        const lane: LaneName = m.role === 'top' ? 'top' : 'bot';
        const p = this.map.sides[this.team === 1 ? 0 : 1].towers[lane][0]!;
        out.push({ kind: 'split_push', lane, score: 0.5 * m.params.knobs.splitWeight, x: p.x, y: p.y, slots: [m.slot], reason: 'split push (team axis / champion)', from: tick, until: tick + 90 * 30 });
        busy.add(m.slot);
      }
    }
    // mid game: group and siege (spec §8 groupAfterFirstTowerPct). From 14:00 (LoL: plates fall, laning ends),
    // re-rolled every macro evaluation (a failed roll is a delay, not "never group"); a fallen outer tower (either
    // side) doubles the chance.
    const ownOuterDown = LANES.some((l) => !n.v.ownTowers.some((t) => dst(t, this.map.sides[this.team === 1 ? 1 : 0].towers[l][0]!) < 200));
    const enemyOuterDown = LANES.some((l) => this.structureDown(this.map.sides[this.team === 1 ? 0 : 1].towers[l][0]!));
    const groupP = (this.mean((m) => m.profile.behavior.groupAfterFirstTowerPct) / 100) * (ownOuterDown || enemyOuterDown ? 2 : 1);
    if (time >= 14 * 60 && tick - this.groupRollAt >= GROUP_ROLL_S * 30) {
      this.groupRollAt = tick;
      this.groupRoll = this.rng.chance(Math.min(1, groupP));
      // side laners keep farming their lane with the profile's sideLaneFarmAfter15Pct (rolled per group episode)
      this.sideFarmers = new Set(this.members.filter((m) => (m.role === 'top' || m.role === 'adc') && this.rng.chance(m.profile.behavior.sideLaneFarmAfter15Pct / 100)).map((m) => m.slot));
    }
    // a group lasts 90 s in the mid game; from 20:00 it holds until the next roll (sieges are not dropped half-way)
    const groupS = time >= 20 * 60 ? GROUP_ROLL_S : 90;
    if ((this.groupRoll && tick - this.groupRollAt < groupS * 30) || this.groupPingUntil > tick) {
      const g = free.filter((m) => !busy.has(m.slot) && (this.groupPingUntil > tick || !this.sideFarmers.has(m.slot))).map((m) => m.slot);
      const lane = this.groupPingUntil > tick ? 'mid' : this.siegeLane(n);
      const p = this.siegeTarget(n, lane);
      if (g.length) out.push({ kind: 'group_mid', lane, score: 0.5 * this.mean((m) => m.params.knobs.groupWeight) + (this.groupPingUntil > tick ? 0.3 : 0), x: p.x, y: p.y, slots: g, reason: this.groupPingUntil > tick ? 'group ping' : `group and siege ${lane}`, from: tick, until: this.groupPingUntil > tick ? tick + 90 * 30 : this.groupRollAt + groupS * 30 });
    }
    const changed = JSON.stringify(out.map((d) => [d.kind, d.obj, d.lane, d.slots])) !== JSON.stringify(this.desires.map((d) => [d.kind, d.obj, d.lane, d.slots]));
    this.desires = out;
    if (changed) this.teamLog(tick, out.map((d) => d.kind).join(',') || 'none', 'macro re-evaluation', { desires: out.length }, Object.fromEntries(out.map((d, i) => [`${i}:${d.kind}`, d.score])));
  }
}
