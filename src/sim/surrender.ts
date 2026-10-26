// Surrender vote (S1, FEATURE-GAP 2.10), classic games only. A human of a team starts a vote with /ff (command `ff`)
// from `minStartS` on; every champion of the team votes (command `ffVote`: the human through the UI, bots through
// src/ai/bot/social.ts); the vote ends when everybody has voted or after `voteS`. LoL rule: before `unanimousUntilS`
// (measured at the start) ALL voters must agree, afterwards ceil(voters * needShare) (4 of 5). A passed vote ends the
// match like a fallen Nexus (winner = the other team, event gameOver). Numbers: src/data/surrender.json.
// State lives in sim.state.ff and only exists after the first vote command, so games without a vote are unchanged
// (state hashes, replays).
import type { Sim } from './sim';
import type { System } from './systems';
import type { SimEvent } from './types';
import data from '../data/surrender.json';

export const SURRENDER = data;

interface Vote {
  team: number;
  starter: number;
  until: number;
  need: number;
  voters: number[];
  yes: number[];
  no: number[];
}

interface FfState {
  /** Active vote per team (index = team). */
  vote: (Vote | null)[];
  /** Tick the last vote of the team ended (cooldown after a failed vote). */
  lastEnd: number[];
}

const ff = (sim: Sim): FfState => (sim.state.ff ??= { vote: [null, null], lastEnd: [-1e9, -1e9] }) as FfState;

/** Votes needed out of `voters` for a vote started at game time `startS` (pure, tested). */
export function votesNeeded(voters: number, startS: number): number {
  if (voters <= 1) return voters;
  return startS < SURRENDER.unanimousUntilS ? voters : Math.ceil(voters * SURRENDER.needShare);
}

const ev = (v: Vote, phase: 'start' | 'vote' | 'pass' | 'fail', slot: number): SimEvent => ({ e: 'ff', team: v.team, phase, slot, yes: [...v.yes], no: [...v.no], voters: [...v.voters], need: v.need, until: v.until });

function deny(sim: Sim, team: number, slot: number, reason: 'early' | 'active' | 'cooldown' | 'mode'): void {
  const v = ff(sim).vote[team];
  sim.events.push({ e: 'ff', team, phase: 'denied', slot, yes: v ? [...v.yes] : [], no: v ? [...v.no] : [], voters: v ? [...v.voters] : [], need: v?.need ?? 0, until: v?.until ?? 0, reason });
}

/** Start a vote for the team of champion `eid` (humans only; the starter votes yes). */
export function startVote(sim: Sim, eid: number): void {
  const { Unit } = sim.c;
  const slot = Unit.slot[eid]!;
  const team = Unit.team[eid]!;
  if (team !== 0 && team !== 1) return;
  if (!sim.config.players.some((p) => p.slot === slot && p.isHuman)) return;
  const st = ff(sim);
  if (sim.config.mode !== 'classic') return deny(sim, team, slot, 'mode');
  if (sim.state.winner !== undefined) return;
  if (st.vote[team]) return deny(sim, team, slot, 'active');
  if (sim.tick / 30 < SURRENDER.minStartS) return deny(sim, team, slot, 'early');
  if (sim.tick - st.lastEnd[team]! < SURRENDER.cooldownS * 30) return deny(sim, team, slot, 'cooldown');
  const voters = sim.config.players.filter((p) => p.team === team).map((p) => p.slot);
  const v: Vote = { team, starter: slot, until: sim.tick + SURRENDER.voteS * 30, need: votesNeeded(voters.length, sim.tick / 30), voters, yes: [slot], no: [] };
  st.vote[team] = v;
  sim.events.push(ev(v, 'start', slot));
  resolveIfDone(sim, v);
}

/** Cast the vote of champion `eid` in its team's active vote (first vote counts). */
export function castVote(sim: Sim, eid: number, yes: boolean): void {
  const { Unit } = sim.c;
  const slot = Unit.slot[eid]!;
  const v = ff(sim).vote[Unit.team[eid]!];
  if (!v || !v.voters.includes(slot) || v.yes.includes(slot) || v.no.includes(slot)) return;
  (yes ? v.yes : v.no).push(slot);
  sim.events.push(ev(v, 'vote', slot));
  resolveIfDone(sim, v);
}

/** Decide the vote when everybody voted, or when the yes votes can no longer fall short / the time is up. */
function resolveIfDone(sim: Sim, v: Vote): void {
  const open = v.voters.length - v.yes.length - v.no.length;
  const timeUp = sim.tick >= v.until;
  if (open > 0 && !timeUp && v.yes.length < v.need && v.yes.length + open >= v.need) return;
  const st = ff(sim);
  const passed = v.yes.length >= v.need;
  st.vote[v.team] = null;
  st.lastEnd[v.team] = sim.tick;
  sim.events.push(ev(v, passed ? 'pass' : 'fail', v.starter));
  if (passed && sim.state.winner === undefined) {
    const winner = v.team === 0 ? 1 : 0;
    sim.state.winner = winner;
    sim.events.push({ e: 'gameOver', winner });
  }
}

export const surrenderSystem: System = {
  name: 'surrender',
  update(sim) {
    const st = sim.state.ff as FfState | undefined;
    if (!st) return;
    for (const v of st.vote) if (v) resolveIfDone(sim, v);
  },
};
