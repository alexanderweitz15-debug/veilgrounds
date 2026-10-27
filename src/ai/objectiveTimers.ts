// (Re)spawn timing of the epic objectives as the bots believe it: from the camp table, the Leviathan pit respawns slower
// (Uralt-Leviathan) once a soul was claimed (src/data/drakes.json), so a hard-coded 300 s is wrong after that.
import { CAMPS } from '../sim/systems/jungle';
import { ELDER } from '../sim/drakes';

type Timing = { first: number; respawn: number };
const camp = (name: string): Timing | undefined => (CAMPS as Record<string, Timing>)[name];

/** Seconds until the objective respawns after a kill (`elder`: the pit holds the Uralt-Leviathan). */
export const objectiveRespawnS = (name: string, elder: boolean): number => (name === 'leviathan' && elder ? ELDER.respawnS : (camp(name)?.respawn ?? 360));
/** Seconds until the objective spawns the first time. */
export const objectiveFirstS = (name: string): number => camp(name)?.first ?? 1e9;
