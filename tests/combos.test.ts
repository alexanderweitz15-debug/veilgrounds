// Phase 2 acceptance (spec §13): every signature combo is executable in the combo trainer. For each champion and
// each of its 3 combos (data `combos[].sequence`), a level-18 champion with all abilities ranked runs the sequence
// headless against a practice dummy with player-like timing: every command waits for the previous step to finish
// (wind-up, dash, channel over), real cooldowns (no refresh between steps). Each step must actually execute:
// ability = its cast event (recasts included), AA = the auto's damage lands on the dummy, FLASH = the champion moved.
import { describe, expect, it } from 'vitest';
import { query } from 'bitecs';
import { createSim, step, type Sim } from '../src/sim/sim';
import { Kind, type Command, type SimEvent } from '../src/sim/types';
import { champAbil, isBusy } from '../src/sim/systems/abilities';
import { CHAMPION_DATA } from '../src/sim/champions';
import { CX, CY, place } from './combat-helpers';

const DUMMY_DIST = 250;
const SLOT: Record<string, 0 | 1 | 2 | 3> = { Q: 0, W: 1, E: 2, R: 3 };

interface Run {
  sim: Sim;
  me: number;
  ally: number;
  dummy: number;
}

function setup(champion: string): Run {
  const allyChamp = champion === 'brom' ? 'mira' : 'brom';
  const sim = createSim({
    seed: 11,
    mode: 'sandbox',
    minionsEnabled: false,
    players: [
      { slot: 0, team: 0, champion, role: 'mid', summoners: ['sprung', 'heilen'], isHuman: true },
      { slot: 1, team: 0, champion: allyChamp, role: 'support', summoners: ['sprung', 'heilen'], isHuman: true },
    ],
    dummies: [{ x: CX + DUMMY_DIST, y: CY, team: 1 }],
  });
  const me = sim.slots[0]!;
  const ally = sim.slots[1]!;
  const dummy = [...query(sim.world, [sim.c.Unit])].find((e) => sim.c.Unit.kind[e] === Kind.Dummy)!;
  place(sim, me, CX, CY);
  place(sim, ally, CX - 150, CY + 150);
  sim.c.Champ.level[me] = 18;
  step(sim);
  champAbil(sim, me).ranks = [5, 5, 5, 3];
  step(sim);
  sim.c.Hp.cur[me] = sim.c.Hp.max[me]!;
  sim.c.Mana.cur[me] = sim.c.Mana.max[me]!;
  return { sim, me, ally, dummy };
}

/** Step with optional inputs; returns this tick's events (copied). */
function tick(sim: Sim, cmd?: Command): SimEvent[] {
  step(sim, cmd ? [{ slot: 0, cmd }] : []);
  return [...sim.events];
}

/** Wait until wind-up, dash and channel are over (max 12 s). */
function settle(r: Run): void {
  for (let i = 0; i < 360 && isBusy(r.sim, r.me); i++) step(r.sim);
}

/**
 * Fake cast (Sev Q "Q (Fake) -> Q"): a token repeated on an ability with flag 'recast' and a wind-up is pressed again
 * during the wind-up (cancel); the repeated token then has to cast for real.
 */
function fakeStep(r: Run, slot: 0 | 1 | 2 | 3): string | null {
  const { sim, me, dummy } = r;
  const { Pos } = sim.c;
  const c: Command = { t: 'cast', slot, x: Pos.x[dummy]!, y: Pos.y[dummy]!, target: dummy };
  if (!tick(sim, c).some((e) => e.e === 'cast' && e.src === me && e.slot === slot)) return 'fake: no cast';
  tick(sim);
  if (!tick(sim, c).some((e) => e.e === 'cast' && e.src === me && e.slot === slot && e.recast)) return 'fake: no recast';
  return champAbil(sim, me).cast ? 'fake: wind-up not cancelled' : null;
}

function abilityStep(r: Run, slot: 0 | 1 | 2 | 3): string | null {
  const { sim, me, ally, dummy } = r;
  const ab = CHAMPION_DATA[sim.championIds[sim.c.Unit.champ[me]!]!]!.abilities[slot];
  const allyCast = ab.flags?.includes('ally_target');
  const t = allyCast ? ally : dummy;
  const { Pos } = sim.c;
  // like a player mashing the key: up to 3.5 s (short hook cooldowns, e.g. Renn's 1.5 s blade-pickup E reset)
  for (let i = 0; i < 105; i++) {
    const cmd: Command | undefined = i % 6 === 0 ? { t: 'cast', slot, x: Pos.x[t]!, y: Pos.y[t]!, target: t } : undefined;
    if (tick(sim, cmd).some((e) => e.e === 'cast' && e.src === me && e.slot === slot)) {
      settle(r);
      return null;
    }
  }
  const a = champAbil(sim, me);
  return `no cast (cd ${Math.max(0, a.cdUntil[slot]! - sim.tick)} ticks, mana ${Math.round(sim.c.Mana.cur[me]!)})`;
}

function autoStep(r: Run): string | null {
  const { sim, me, dummy } = r;
  let attacked = false;
  for (let i = 0; i < 120; i++) {
    const evs = tick(sim, i % 15 === 0 ? { t: 'attack', target: dummy } : undefined);
    if (evs.some((e) => e.e === 'attack' && e.src === me && e.dst === dummy)) attacked = true;
    if (attacked && evs.some((e) => e.e === 'damage' && e.src === me && e.dst === dummy)) return null;
  }
  return attacked ? 'auto fired but never landed' : 'no auto';
}

function flashStep(r: Run): string | null {
  const { sim, me, dummy } = r;
  const { Pos, Face } = sim.c;
  const x0 = Pos.x[me]!;
  const y0 = Pos.y[me]!;
  // flash toward (and past) the dummy; along the facing if standing on it
  let dx = Pos.x[dummy]! - x0;
  let dy = Pos.y[dummy]! - y0;
  const d = Math.hypot(dx, dy);
  if (d < 50) [dx, dy] = [Face.x[me]!, Face.y[me]!];
  else [dx, dy] = [dx / d, dy / d];
  tick(sim, { t: 'spell', slot: 0, x: x0 + dx * 400, y: y0 + dy * 400 });
  return Math.hypot(Pos.x[me]! - x0, Pos.y[me]! - y0) > 100 ? null : 'flash did not move';
}

/** Runs one combo; returns the failing step description or null. */
export function runCombo(champion: string, seq: string[]): string | null {
  const r = setup(champion);
  for (let i = 0; i < seq.length; i++) {
    const tok = seq[i]!;
    const ab = SLOT[tok] !== undefined ? CHAMPION_DATA[champion]!.abilities[SLOT[tok]!] : undefined;
    const fake = !!ab && seq[i + 1] === tok && ab.castTime > 0 && !!ab.flags?.includes('recast') && ab.type === 'skillshot_line';
    const err = tok === 'AA' ? autoStep(r) : tok === 'FLASH' ? flashStep(r) : fake ? fakeStep(r, SLOT[tok]!) : SLOT[tok] !== undefined ? abilityStep(r, SLOT[tok]!) : `unknown token ${tok}`;
    if (err) return `step ${i + 1} (${tok}): ${err}`;
  }
  return null;
}

describe('combo trainer acceptance: every signature combo executes', () => {
  for (const id of Object.keys(CHAMPION_DATA).sort()) {
    const data = CHAMPION_DATA[id]!;
    it(`${id}: 3 combos`, () => {
      expect(data.combos).toHaveLength(3);
      const fails = data.combos.map((c) => ({ combo: `${c.name.en} [${c.sequence.join(' ')}]`, err: runCombo(id, c.sequence) })).filter((f) => f.err);
      expect(fails).toEqual([]);
    });
  }
});
