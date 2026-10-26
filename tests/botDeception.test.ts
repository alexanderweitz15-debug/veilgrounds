// Deception: the lower the rank, the more often a bot takes the Sev W clone (Kind.Pet with look 'sev') for Sev
// (src/ai/humanize/deception.ts, values.json "deception"). Seeded, perception only (fog-filtered snapshot).
import { describe, expect, it } from 'vitest';
import { Kind } from '../src/sim/types';
import { Rng } from '../src/sim/rng';
import { newMemory } from '../src/ai/bot/types';
import { perceive } from '../src/ai/bot/perception';
import { arena } from '../src/ai/bot/brain';
import type { Rank } from '../src/ai/profiles/schema';
import { PLAYERS, ScriptedBot, botStatic, champEnt, hud, paramsFor, snapshot } from './botScenario';

const SEV_SLOT = 7;
const players = PLAYERS.map((p) => (p.slot === SEV_SLOT ? { ...p, champion: 'sev' } : p));
const DECOY_ID = 3000;

/** Share of seeds in which the bot (blue mid) counts the clone as an enemy champion, and in which it loses the real Sev. */
function fooledShare(rank: Rank, withReal = true, seeds = 80): { fooled: number; lostReal: number } {
  let fooled = 0;
  let lostReal = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const ctx = { ...botStatic(2, paramsFor(rank, {}, 2)), players };
    const mem = newMemory();
    const rng = new Rng(seed);
    const real = champEnt(SEV_SLOT, 7800, 7800, { champ: 'sev' });
    const decoy = { ...champEnt(SEV_SLOT, 7500, 7500, { champ: null, kind: Kind.Pet, look: 'sev', id: DECOY_ID, serial: DECOY_ID, slot: -1 }) };
    const ents = [champEnt(2, 7000, 7000), decoy, ...(withReal ? [real] : [])];
    const v = perceive(snapshot({ tick: 3000, team: 0, entities: ents, me: hud(2) }), ctx, mem, rng)!;
    const all = [...v.enemies, ...v.unnoticed];
    if (all.some((e) => e.id === DECOY_ID && e.kind === Kind.Champion && e.champ === 'sev' && e.slot === SEV_SLOT)) fooled++;
    // the real Sev drops out of "noticed" for a fooled bot (it keeps looking at the clone)
    if (withReal && all.some((e) => e.id === DECOY_ID) && !v.enemies.some((e) => e.id === real.id)) lostReal++;
  }
  return { fooled: fooled / seeds, lostReal: lostReal / seeds };
}

describe('Sev W clone deception by rank', () => {
  it('Iron is fooled far more often than Challenger, in between it falls monotonically', () => {
    const r = (['iron', 'silver', 'gold', 'diamond', 'challenger'] as Rank[]).map((k) => fooledShare(k, false).fooled);
    expect(r[0]).toBeGreaterThan(0.75);
    expect(r[4]).toBeLessThan(0.1);
    for (let i = 1; i < r.length; i++) expect(r[i]!).toBeLessThanOrEqual(r[i - 1]! + 0.05);
  });

  it('a fooled bot loses the real Sev for a while; a Challenger keeps seeing him', () => {
    expect(fooledShare('iron').lostReal).toBeGreaterThan(0.5);
    const c = fooledShare('challenger');
    expect(c.lostReal).toBeLessThan(0.1);
  });

  it('Iron attacks the clone (real Sev in view, further away) notably more often than Challenger', () => {
    const hits = (rank: Rank): number => {
      let n = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const bot = new ScriptedBot(2, paramsFor(rank, {}, 2), seed);
        Object.assign(bot.ctx, { players, mode: 'arena' });
        const decoy = champEnt(SEV_SLOT, 7200, 7000, { champ: null, kind: Kind.Pet, look: 'sev', id: DECOY_ID, serial: DECOY_ID, slot: -1 });
        const real = champEnt(SEV_SLOT, 7900, 7000, { champ: 'sev' });
        const nc = bot.node(snapshot({ tick: 3000, team: 0, entities: [champEnt(2, 7000, 7000), decoy, real], me: hud(2) }));
        arena(nc);
        if (nc.out.some((a) => a.cmd.t === 'attack' && a.cmd.target === DECOY_ID)) n++;
      }
      return n;
    };
    const iron = hits('iron');
    const chall = hits('challenger');
    expect(iron).toBeGreaterThan(30);
    expect(iron).toBeGreaterThan(chall * 3);
  });

  it('own-team clones and clones without a look are ignored; the spot time ends the illusion', () => {
    const ctx = { ...botStatic(2, paramsFor('iron', {}, 2)), players };
    const mem = newMemory();
    const rng = new Rng(1);
    const decoy = champEnt(SEV_SLOT, 7500, 7500, { champ: null, kind: Kind.Pet, look: 'sev', id: DECOY_ID, serial: DECOY_ID, slot: -1 });
    const own = { ...decoy, id: DECOY_ID + 1, serial: DECOY_ID + 1, team: 0 };
    const keg = { ...decoy, id: DECOY_ID + 2, serial: DECOY_ID + 2, look: undefined };
    const v = perceive(snapshot({ tick: 3000, team: 0, entities: [champEnt(2, 7000, 7000), own, keg], me: hud(2) }), ctx, mem, rng)!;
    expect([...v.enemies, ...v.unnoticed, ...v.allies].some((e) => e.id === own.id || e.id === keg.id)).toBe(false);
    // Iron spots a clone that outlives decoySpotMs (3 s); same decoy, much later: no longer taken for Sev
    let seed = 1;
    for (; seed < 50; seed++) {
      const m = newMemory();
      const first = perceive(snapshot({ tick: 3000, team: 0, entities: [champEnt(2, 7000, 7000), decoy], me: hud(2) }), ctx, m, new Rng(seed))!;
      if (![...first.enemies, ...first.unnoticed].some((e) => e.id === DECOY_ID)) continue;
      const later = perceive(snapshot({ tick: 3000 + 4 * 30, team: 0, entities: [champEnt(2, 7000, 7000), decoy], me: hud(2) }), ctx, m, new Rng(seed))!;
      expect([...later.enemies, ...later.unnoticed].some((e) => e.id === DECOY_ID)).toBe(false);
      break;
    }
    expect(seed).toBeLessThan(50);
  });
});
