// Manual summoner-spell timers for enemies (LoL: click the enemy's spell in the Tab scoreboard when you saw it cast).
// The client does not know enemy cooldowns (fog-safe); the player starts the timer, it counts down the spell's base
// cooldown at that game time. Clicking a running timer clears it (misclick / spell seen again).
import { summonerDef, TELEPORT_LATE_TICK } from '../sim/summoners';

/** Base cooldown in seconds of a summoner spell at game time `time` (seconds); 0 for unknown ids. */
export function baseSummonerCd(id: string, time: number): number {
  const def = summonerDef(id);
  if (!def) return 0;
  return def.cooldownLate !== undefined && time * 30 >= TELEPORT_LATE_TICK ? def.cooldownLate : def.cooldown;
}

export class SummonerTimers {
  private readonly until = new Map<string, { at: number; total: number }>();

  /** Start (or clear, when running) the timer of `slot`'s spell `index`; returns true if a timer is now running. */
  toggle(slot: number, index: number, id: string, time: number): boolean {
    const k = `${slot}:${index}`;
    const cur = this.until.get(k);
    if (cur && cur.at > time) {
      this.until.delete(k);
      return false;
    }
    const total = baseSummonerCd(id, time);
    if (total <= 0) return false;
    this.until.set(k, { at: time + total, total });
    return true;
  }

  /** Seconds left and total of a running timer, else null (expired timers report null). */
  left(slot: number, index: number, time: number): { left: number; total: number } | null {
    const cur = this.until.get(`${slot}:${index}`);
    if (!cur || cur.at <= time) return null;
    return { left: cur.at - time, total: cur.total };
  }
}
