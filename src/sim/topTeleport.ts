// B4 (AGENTS-PLAN §4): Teleport for the top laner. The champion assigned to top in the lobby (PlayerSetup.role)
// counts the gold it earns from lane-minion kills; at summoners.json teleport.topUnlockGold (1500) Teleport is added
// as a third summoner spell (slot 2, HUD key F2 / default T: agent C), with the normal Teleport cooldown (360 -> 240 s
// from 10:00). Event 'tpUnlocked' (team-only) for the announcement. A top laner that already took Teleport gets
// nothing extra. Bot use of the slot: brain team.

import type { Sim } from './sim';
import { Kind } from './types';
import { summonerDef } from './summoners';
import { addSummonerSlot, champAbil } from './systems/abilities';

interface TopTpState {
  /** Lane-minion gold per champion slot (top laners only). */
  gold: Map<number, number>;
  /** Slots that unlocked (or already had) Teleport. */
  done: Set<number>;
}

export const TOP_TP_GOLD = summonerDef('teleport')?.topUnlockGold ?? 1500;

function st(sim: Sim): TopTpState {
  let s = sim.state.topTp as TopTpState | undefined;
  if (!s) sim.state.topTp = s = { gold: new Map(), done: new Set() };
  return s;
}

const isTop = (sim: Sim, eid: number): boolean => sim.config.players.find((p) => p.slot === sim.c.Unit.slot[eid])?.role === 'top';

/** Lane-minion gold of a champion so far (HUD progress, tests). Read-only. */
export function topTpGold(sim: Sim, eid: number): number {
  return (sim.state.topTp as TopTpState | undefined)?.gold.get(sim.c.Unit.slot[eid]!) ?? 0;
}

/** economy.minionDeath: a champion earned `gold` from a lane-minion kill. */
export function noteLaneMinionGold(sim: Sim, eid: number, gold: number): void {
  if (sim.c.Unit.kind[eid] !== Kind.Champion || !isTop(sim, eid)) return;
  const s = st(sim);
  const slot = sim.c.Unit.slot[eid]!;
  if (s.done.has(slot)) return;
  const g = (s.gold.get(slot) ?? 0) + gold;
  s.gold.set(slot, g);
  if (g < TOP_TP_GOLD) return;
  s.done.add(slot);
  if (champAbil(sim, eid).sums.includes('teleport')) return; // took Teleport already
  const sumSlot = addSummonerSlot(sim, eid, 'teleport');
  sim.events.push({ e: 'tpUnlocked', eid, team: sim.c.Unit.team[eid]!, slot: sumSlot });
}
