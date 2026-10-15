// Sandbox cheats with a lasting effect (Phase 5): permanent cooldown reset and god mode per champion.
// The state only exists once a cheat was used, so classic games and replays without cheats are unaffected.

import type { Sim } from '../sim';
import { refreshCooldowns } from '../systems/abilities';
import { CAMPS, CLOSED, jungleState } from '../systems/jungle';
import { sec } from '../types';

interface SandboxState {
  noCd: number[];
  god: number[];
}

function sbState(sim: Sim): SandboxState {
  let s = sim.state.sandbox as SandboxState | undefined;
  if (!s) sim.state.sandbox = s = { noCd: [], god: [] };
  return s;
}

function toggle(list: number[], eid: number): boolean {
  const i = list.indexOf(eid);
  if (i >= 0) list.splice(i, 1);
  else list.push(eid);
  return i < 0;
}

export function toggleNoCooldowns(sim: Sim, eid: number): void {
  toggle(sbState(sim).noCd, eid);
}

export function toggleGodMode(sim: Sim, eid: number): void {
  if (!toggle(sbState(sim).god, eid)) sim.c.Unit.invulnerable[eid] = 0;
}

/**
 * Camps without living monsters spawn on the next tick (epic objectives included). Kesselbrut and Schleierwaechter
 * share the pit like in a normal game: Kesselbrut until it leaves (19:45), the Schleierwaechter only after that, and
 * never while the other one is up. A closed camp (Kesselbrut after its last wave) stays closed.
 */
export function respawnCamps(sim: Sim): void {
  const camps = jungleState(sim).camps;
  const up = (id: string): boolean => camps.some((c) => c.id === id && c.spawnAt < 0);
  const kesselPhase = sim.tick < sec(CAMPS.kesselbrut.until ?? 0);
  for (const c of camps) {
    if (c.spawnAt < 0 || c.spawnAt === CLOSED) continue;
    if (c.id === 'kesselbrut' && (!kesselPhase || up('schleierwaechter'))) continue;
    if (c.id === 'schleierwaechter' && (kesselPhase || up('kesselbrut'))) continue;
    c.spawnAt = sim.tick + 1;
  }
}

export function sandboxFlags(sim: Sim, eid: number): { noCd: boolean; god: boolean } {
  const s = sim.state.sandbox as SandboxState | undefined;
  return { noCd: !!s?.noCd.includes(eid), god: !!s?.god.includes(eid) };
}

export function updateSandbox(sim: Sim): void {
  const s = sim.state.sandbox as SandboxState | undefined;
  if (!s) return;
  const { Unit, Hp, Mana } = sim.c;
  for (const e of s.noCd) {
    refreshCooldowns(sim, e);
    Mana.cur[e] = Mana.max[e]!;
  }
  for (const e of s.god) {
    if (!Unit.alive[e]) continue;
    Unit.invulnerable[e] = 1;
    Hp.cur[e] = Hp.max[e]!;
  }
}
