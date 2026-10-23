// D1/D4: every champion of the original roster has four different ability motifs (icons, missile colours), each
// drawable by the icon painter; every champion shows a passive badge state in the HUD.
import '../src/sim/sim';
import { describe, expect, it } from 'vitest';
import { step } from '../src/sim/sim';
import { buildSnapshot } from '../src/sim/snapshot';
import { MOTIF_GLYPHS, PARTICLE_KIND_IDS, abilityParticles, abilityTheme, motifParticle, tagParticles } from '../src/render/abilityTheme';
import { champions } from '../src/data/champions';
import motifData from '../src/render/abilityMotifs.json';
import type { PlayerSetup } from '../src/sim/types';
import { CX, CY, makeSim, place } from './combat-helpers';

const ROSTER = Object.keys((motifData as { champions: Record<string, unknown> }).champions);

describe('ability motifs', () => {
  it('covers the 26 original champions with four distinct, drawable motifs each', () => {
    expect(ROSTER.length).toBe(Object.keys(champions).length);
    for (const id of ROSTER) {
      const motifs = [0, 1, 2, 3].map((s) => abilityTheme(id, s)?.motif);
      expect([id, new Set(motifs).size]).toEqual([id, 4]);
      for (const m of motifs) expect([id, MOTIF_GLYPHS.includes(m!)]).toEqual([id, true]);
    }
  });
});

describe('ability particles (D1b)', () => {
  it('every drawable motif maps to a defined particle kind; each champion uses at least two kinds', () => {
    for (const m of MOTIF_GLYPHS) expect([m, PARTICLE_KIND_IDS.includes(motifParticle(m))]).toEqual([m, true]);
    for (const id of ROSTER) {
      const kinds = new Set([0, 1, 2, 3].map((s) => abilityParticles(id, s)!.kind));
      expect([id, kinds.size >= 2]).toEqual([id, true]);
    }
    expect(tagParticles('oleth_r_wall')).toEqual(abilityParticles('oleth', 3));
    expect(tagParticles('renn_blade')?.kind).toBe('mote');
  });

  it('particles spawn, move and expire headless', async () => {
    const { Particles } = await import('../src/render/particles');
    const p = new Particles();
    p.emit('ember', 100, 100, 50, 22, 10, 0);
    p.emit('shard', 100, 100, 50, 35, 5, 0, { dx: 1, dy: 0 });
    expect(p.live).toBe(15);
    p.update(100, 0.1);
    expect(p.live).toBe(15);
    p.update(5000, 0.1);
    expect(p.live).toBe(0);
  });
});

describe('passive badge', () => {
  it('every champion of the roster sends a passive HUD state', () => {
    for (const id of ROSTER) {
      const p: PlayerSetup = { slot: 0, team: 0, champion: id, role: 'mid', summoners: ['sprung', 'heilen'], isHuman: true };
      const sim = makeSim({ players: [p] });
      place(sim, sim.slots[0]!, CX, CY);
      step(sim);
      expect([id, buildSnapshot(sim, 0, 0).me?.passive !== undefined]).toEqual([id, true]);
    }
  });
});
