// Trainer system (Phase 5): runs the trainer selected by SimConfig.mode and the lasting sandbox cheats.
// Registered after the economy system (sees this tick's deaths, gold and damage events), before wards/vision
// (teleports are visible in the same tick's vision). No state is created for classic / lane / sandbox games,
// so their replays and state hashes are unchanged.

import type { Sim } from '../sim';
import type { System } from '../systems';
import { arenaHud, initArena, updateArena, type ArenaState } from './arena';
import { dodgeHud, initDodge, updateDodge, type DodgeState } from './dodge';
import { duelHud, initDuel, updateDuel, type DuelState } from './duel';
import { initKite, kiteHud, updateKite, type KiteState } from './kite';
import { initLastHit, lastHitHud, updateLastHit, type LastHitState } from './lastHit';
import { updateSandbox } from './sandbox';
import type { TrainerHud } from './common';

export type { TrainerHud, TrainerStat } from './common';

export interface TrainerState {
  lastHit?: LastHitState;
  dodge?: DodgeState;
  kite?: KiteState;
  duel?: DuelState;
  arena?: ArenaState;
}

export const trainerState = (sim: Sim): TrainerState | undefined => sim.state.trainer as TrainerState | undefined;

export const trainerSystem: System = {
  name: 'trainer',
  init(sim) {
    const st: TrainerState = {};
    switch (sim.config.mode) {
      case 'lastHit':
        st.lastHit = initLastHit(sim);
        break;
      case 'dodge':
        st.dodge = initDodge(sim);
        break;
      case 'kite':
        st.kite = initKite(sim);
        break;
      case 'laneDuel':
      case 'jungleDuel':
        st.duel = initDuel(sim);
        break;
      case 'arena':
        st.arena = initArena(sim);
        break;
      default:
        return;
    }
    sim.state.trainer = st;
  },
  update(sim) {
    updateSandbox(sim);
    const st = trainerState(sim);
    if (!st) return;
    if (st.lastHit) updateLastHit(sim, st.lastHit);
    if (st.dodge) updateDodge(sim, st.dodge);
    if (st.kite) updateKite(sim, st.kite);
    if (st.duel) updateDuel(sim, st.duel);
    if (st.arena) updateArena(sim, st.arena);
  },
};

/** HUD view of the running trainer (Snapshot.trainer), null outside trainers. */
export function trainerHud(sim: Sim): TrainerHud | null {
  const st = trainerState(sim);
  if (!st) return null;
  if (st.lastHit) return lastHitHud(sim, st.lastHit);
  if (st.dodge) return dodgeHud(sim, st.dodge);
  if (st.kite) return kiteHud(sim, st.kite);
  if (st.duel) return duelHud(sim, st.duel);
  if (st.arena) return arenaHud(sim, st.arena);
  return null;
}
