// Enemy play-style estimation (spec-bots §5.3): every bot from Platinum guesses the ten axes of every enemy (also
// the human) from observed behaviour. Feeds roam/gank scores; exposed for the post-game screen.
// ponytail: only the five observable axes (tradeLength, kiting, roam, vision, resourceUse) plus aggression from
// trade initiation; the others stay 0 (unknown). Observation is what the bot perceived, never sim state.

import type { BotParams, Playstyle } from '../contract';
import { atLeast } from './rankModel';

export interface EnemyStyleObs {
  /** Closed trades: durations in seconds. */
  trades: number[];
  /** Open trade (first and last damage tick between this enemy and the bot's team). */
  tradeFrom: number;
  tradeLast: number;
  /** Trades this enemy started (dealt the first damage). */
  initiated: number;
  /** Attack observations: autos fired while perceived, and how many were followed by movement before the next. */
  autos: number;
  orbwalks: number;
  lastAutoTick: number;
  movedSinceAuto: boolean;
  /** Times seen outside its own lane region (laners) during laning. */
  roams: number;
  wards: number;
  flashes: number;
  /** Flashes toward a champion of the bot's team (offensive). */
  flashOffensive: number;
  firstTick: number;
}

export const newStyleObs = (tick: number): EnemyStyleObs => ({
  trades: [],
  tradeFrom: -1,
  tradeLast: -1,
  initiated: 0,
  autos: 0,
  orbwalks: 0,
  lastAutoTick: -1,
  movedSinceAuto: false,
  roams: 0,
  wards: 0,
  flashes: 0,
  flashOffensive: 0,
  firstTick: tick,
});

/** A trade ends after 3 s without damage between the enemy and the bot's team. */
export const TRADE_GAP_TICKS = 90;

export function noteDamage(o: EnemyStyleObs, tick: number, enemyDealt: boolean): void {
  if (o.tradeFrom < 0 || tick - o.tradeLast > TRADE_GAP_TICKS) {
    if (o.tradeFrom >= 0) o.trades.push((o.tradeLast - o.tradeFrom) / 30);
    o.tradeFrom = tick;
    if (enemyDealt) o.initiated++;
  }
  o.tradeLast = tick;
}

const clamp5 = (v: number): number => Math.max(-5, Math.min(5, Math.round(v)));

/**
 * Estimated axes for one enemy, or null while the bot may not estimate yet (rank < Platinum, Challenger from
 * minute 4, Platinum from minute 10). Lower ranks round coarser (less accurate).
 */
export function estimateStyle(o: EnemyStyleObs | undefined, params: BotParams, tick: number): Partial<Playstyle> | null {
  if (!o || !atLeast(params, 'platinum')) return null;
  const fromMin = atLeast(params, 'challenger') ? 4 : atLeast(params, 'diamond') ? 7 : 10;
  if (tick < fromMin * 60 * 30) return null;
  const minutes = Math.max(1, (tick - o.firstTick) / 1800);
  const step = atLeast(params, 'diamond') ? 1 : 2; // Platinum: coarser
  const q = (v: number): number => clamp5(Math.round(v / step) * step);
  const out: Partial<Playstyle> = {};
  if (o.trades.length >= 2) {
    const mean = o.trades.reduce((a, b) => a + b, 0) / o.trades.length;
    out.tradeLength = q((mean - 4.5) * 2); // 2 s -> -5, 7 s -> +5
    out.aggression = q((o.initiated / o.trades.length - 0.5) * 10);
  }
  if (o.autos >= 6) out.kiting = q((0.5 - o.orbwalks / o.autos) * 10); // orbwalk ratio 1 -> -5 ("Profi")
  out.roam = q(o.roams / minutes * 10 - 2);
  out.vision = q(o.wards / minutes * 5 - 2);
  if (o.flashes > 0) out.resourceUse = q((o.flashOffensive / o.flashes - 0.5) * 10);
  return out;
}
