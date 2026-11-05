// Game-mode rule knobs (ARAM, URF, custom games): SimConfig.rules; every field optional, absent = classic.
import type { Sim } from './sim';
import presets from '../data/gameModes.json';

export interface GameRules {
  startGold?: number;
  startLevel?: number;
  /** Recall command ignored (fountain and death are the only ways home). */
  noRecall?: boolean;
  /** No jungle camps / epic monsters. */
  noJungle?: boolean;
  /** Only the mid lane spawns minions (bots: all lane mid). */
  midOnly?: boolean;
  /** Ability haste for everybody. */
  haste?: number;
  manaCostMult?: number;
  manaRegenPct?: number;
  respawnMult?: number;
  /** Wave interval factor (<1 = faster waves). */
  waveMult?: number;
  passiveGoldMult?: number;
}

export type VariantId = 'aram' | 'urf';
export const VARIANTS: VariantId[] = ['aram', 'urf'];
export const variantRules = (id: VariantId): GameRules => ({ ...(presets as Record<VariantId, GameRules>)[id] });

export const rulesOf = (sim: Sim): GameRules => sim.config.rules ?? {};
