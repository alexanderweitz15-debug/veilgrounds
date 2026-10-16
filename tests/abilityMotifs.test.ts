// D1/D4: every champion of the original roster has four different ability motifs (icons, missile colours), each
// drawable by the icon painter; every champion shows a passive badge state in the HUD.
import '../src/sim/sim';
import { describe, expect, it } from 'vitest';
import { step } from '../src/sim/sim';
import { buildSnapshot } from '../src/sim/snapshot';
import { MOTIF_GLYPHS, abilityTheme } from '../src/render/abilityTheme';
import motifData from '../src/render/abilityMotifs.json';
import type { PlayerSetup } from '../src/sim/types';
import { CX, CY, makeSim, place } from './combat-helpers';

const ROSTER = Object.keys((motifData as { champions: Record<string, unknown> }).champions);

describe('ability motifs', () => {
  it('covers the 26 original champions with four distinct, drawable motifs each', () => {
    expect(ROSTER.length).toBe(26);
    for (const id of ROSTER) {
      const motifs = [0, 1, 2, 3].map((s) => abilityTheme(id, s)?.motif);
      expect([id, new Set(motifs).size]).toEqual([id, 4]);
      for (const m of motifs) expect([id, MOTIF_GLYPHS.includes(m!)]).toEqual([id, true]);
    }
  });
});

describe('passive badge', () => {
  // TODO(D): Wren passive HUD state missing (D1 unfinished, docs/agents/d.md); skipped on the user's request (16 Oct) to unblock the deploy.
  it.skip('every champion of the roster sends a passive HUD state', () => {
    for (const id of ROSTER) {
      const p: PlayerSetup = { slot: 0, team: 0, champion: id, role: 'mid', summoners: ['sprung', 'heilen'], isHuman: true };
      const sim = makeSim({ players: [p] });
      place(sim, sim.slots[0]!, CX, CY);
      step(sim);
      expect([id, buildSnapshot(sim, 0, 0).me?.passive !== undefined]).toEqual([id, true]);
    }
  });
});
