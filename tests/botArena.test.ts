// Teamfight arena trainer: bots engage the enemy team on their own (not only when the player attacks).
import { describe, expect, it } from 'vitest';
import { runBotGame } from '../src/ai/harness';
import type { PlayerSetup, SimConfig } from '../src/sim/types';

const bot = (slot: number, team: 0 | 1, champion: string): PlayerSetup => ({
  slot,
  team,
  champion,
  role: 'mid',
  summoners: ['sprung', 'heilen'],
  isHuman: false,
  bot: { rank: 'gold', variance: 'normal' },
});

describe('arena trainer: bots fight each other', () => {
  it('2v2 bots deal champion damage and score kills within 30 s', () => {
    const config: SimConfig = {
      seed: 5,
      mode: 'arena',
      players: [bot(0, 0, 'mira'), bot(1, 0, 'brom'), bot(5, 1, 'lysa'), bot(6, 1, 'harrow')],
      minionsEnabled: false,
      trainer: { level: 11, rounds: 3, roundSec: 45 },
    };
    const res = runBotGame(config, 30 * 30);
    const dmg = res.stats.reduce((a, s) => a + s.damageToChampions, 0);
    const deaths = res.stats.reduce((a, s) => a + s.deaths, 0);
    expect(dmg).toBeGreaterThan(1500);
    for (const team of [0, 1]) expect(res.stats.filter((s) => s.team === team).some((s) => s.damageToChampions > 0)).toBe(true);
    expect(deaths).toBeGreaterThan(0);
    expect(res.bots.log.entries().some((e) => e.node === 'arena')).toBe(true);
  }, 60_000);
});
