// Pure calculations of the live training widget (no DOM, no sim state): CS@10 projection, missed-CS detection,
// minion HP history and the last-hit kill window. Client snapshot data only. Constants: liveTraining.json.
import { PROFILES } from '../ai/profiles';
import { RANKS, type Rank } from '../ai/profiles/schema';
import { isMinion, type SimEvent } from '../sim/types';
import cfg from './liveTraining.json';

export const LT = cfg as typeof cfg & { defaultRank: Rank };

/** Widget visible? Setting 'on'/'off' wins, 'auto' follows the match mode (undefined mode = mock/sandbox). */
export function widgetVisible(setting: 'auto' | 'on' | 'off', mode: string | undefined): boolean {
  if (setting !== 'auto') return setting === 'on';
  return mode === undefined || LT.autoModes.includes(mode);
}

/** Next rank in the target cycle (Iron .. Challenger, wraps). */
export const nextRank = (r: Rank): Rank => RANKS[(RANKS.indexOf(r) + 1) % RANKS.length]!;

/** Per-minute / CS@10 targets of a rank (Table A, src/data/bots/profiles). */
export function rankGoal(rank: Rank): { csPerMin: number; csAt10: number; goldPerMin: number } {
  const t = PROFILES[Math.max(0, RANKS.indexOf(rank))]!.targets;
  return { csPerMin: t.csPerMin, csAt10: t.csAt10, goldPerMin: t.goldPerMin };
}

/**
 * CS at 10:00. After 10:00 the real value is passed in (`at10`). Before: the farming rate since the first wave arrived
 * is carried to 10:00; null while there is too little farming time to say anything.
 */
export function projectCs10(cs: number, time: number, at10: number | null = null): number | null {
  if (at10 !== null) return at10;
  if (time >= 600) return cs;
  const span = time - LT.farmStartSec;
  if (span < LT.minSpanSec) return null;
  return cs + (cs / span) * (600 - time);
}

/** Per-minute rate; null in the first minute (the average would jump around). */
export const perMin = (total: number, time: number): number | null => (time < 60 ? null : (total * 60) / time);

/** An enemy minion died within missRangeU of the own champion and the own champion did not land the kill. */
export function isMissedCs(ev: SimEvent, meEid: number, myTeam: number, mx: number, my: number): boolean {
  if (ev.e !== 'death' || !isMinion(ev.kind) || ev.team === myTeam || ev.killer === meEid) return false;
  const dx = ev.x - mx;
  const dy = ev.y - my;
  return dx * dx + dy * dy <= LT.missRangeU * LT.missRangeU;
}

export interface HpSample {
  t: number;
  hp: number;
}

/** Appends a sample (same time replaces the last one) and drops samples older than hpWindowSec. */
export function pushSample(buf: HpSample[], t: number, hp: number): void {
  const last = buf[buf.length - 1];
  if (last && last.t === t) last.hp = hp;
  else buf.push({ t, hp });
  while (buf.length > 1 && t - buf[0]!.t > LT.hpWindowSec) buf.shift();
}

/** HP the minion loses per second over the sampled window (0 when it is not losing HP or the window is too short). */
export function dropRate(buf: readonly HpSample[]): number {
  const a = buf[0];
  const b = buf[buf.length - 1];
  if (!a || !b || b.t - a.t < 0.1) return 0;
  return Math.max(0, (a.hp - b.hp) / (b.t - a.t));
}

/** Physical auto-attack damage against armor. */
export const autoDamage = (ad: number, armor: number): number => (ad * 100) / (100 + Math.max(0, armor));

/** Seconds from the attack command to the hit: wind-up, plus flight time for ranged attackers. */
export function hitDelay(range: number, dist: number): number {
  return LT.windupSec + (range >= LT.rangedFrom ? Math.max(0, dist) / LT.projectileSpeed : 0);
}

/**
 * Seconds from now during which an auto that lands then kills: it opens when HP has dropped to `dmg`, closes when the
 * minion is dead (`to`). Without incoming damage the window is open (0..Infinity) iff hp <= dmg.
 */
export function killWindow(hp: number, dmg: number, rate: number): { from: number; to: number } {
  if (rate <= 0) return hp <= dmg ? { from: 0, to: Infinity } : { from: Infinity, to: Infinity };
  return { from: Math.max(0, (hp - dmg) / rate), to: hp / rate };
}

/** kill = attack now, soon = window opens shortly, wait = later, late = the minion dies before the hit lands. */
export type MarkState = 'kill' | 'soon' | 'wait' | 'late';

export interface LastHitMark {
  state: MarkState;
  /** Bar fill 0..1: damage / predicted HP at the moment the hit lands. */
  frac: number;
}

export function lastHitMark(hp: number, dmg: number, rate: number, delay: number): LastHitMark {
  const w = killWindow(hp, dmg, rate);
  const predicted = Math.max(1, hp - rate * delay);
  const frac = Math.min(1, dmg / predicted);
  if (delay > w.to) return { state: 'late', frac: 1 };
  if (delay >= w.from) return { state: 'kill', frac: 1 };
  return { state: w.from - delay <= LT.soonSec ? 'soon' : 'wait', frac };
}
