// System order is part of determinism. Change only deliberately.

import type { Sim } from '../sim';
import { inputSystem } from './input';
import { statsSystem } from './stats';
import { wavesSystem } from './waves';
import { towersSystem } from './towers';
import { championsSystem } from './champions';
import { minionsSystem } from './minions';
import { attackSystem } from './attack';
import { abilitiesSystem } from './abilities';
import { projectilesSystem } from './projectiles';
import { movementSystem } from './movement';
import { economySystem } from './economy';
import { jungleSystem } from './jungle';
import { computeVision } from '../vision';
import { summonersSystem } from '../summoners';
import { wardsSystem } from '../wards';

export interface System {
  name: string;
  /** Called once from createSim, in list order. */
  init?(sim: Sim): void;
  update(sim: Sim): void;
}

// Built lazily: system modules import sim.ts, so an eager array hits TDZ when a test imports a system first.
let cache: System[] | null = null;
export const systems = (): System[] =>
  (cache ??= [
  towersSystem, // init spawns structures; update picks tower targets
  championsSystem, // init spawns champions + dummies; update: respawn bookkeeping hooks
  inputSystem, // player-equivalent commands -> intents
  statsSystem, // buffs + level -> final stats
  wavesSystem, // minion spawning
  jungleSystem, // camps, monster aggro/leash, jungle buffs, objectives (Agent H)
  minionsSystem, // minion aggro + lane following intents
  abilitiesSystem, // cast timers, ability effects
  summonersSystem, // Teleport channel (Agent J)
  attackSystem, // auto-attack state machine for every unit with a target
  projectilesSystem,
  movementSystem,
  economySystem, // passive gold, regen, recall, respawn, fountain
  wardsSystem, // ward expiry/kills, seal + sweep reveal/disable, trinket charges: right before vision (Agent J)
  { name: 'vision', update: computeVision },
]);
