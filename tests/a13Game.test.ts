// A13: the micro layer in running games - deterministic, logged, fog-clean, and absent from the default brain.

import { describe, expect, it } from 'vitest';
import { runBotGame } from '../src/ai/harness';
import { botGameConfig } from '../src/ai/runner';
import { dodgeStats } from '../src/ai/combat/dodge';
import type { PlayerSetup, SimConfig } from '../src/sim/types';

const MIN = 1800;

const bot = (slot: number, team: 0 | 1, champion: string): PlayerSetup => ({
  slot,
  team,
  champion,
  role: 'mid',
  summoners: ['sprung', 'heilen'],
  isHuman: false,
  bot: { rank: 'diamond', variance: 'stable' },
});

const arena = (utility: boolean): SimConfig => ({
  seed: 5,
  mode: 'arena',
  players: [bot(0, 0, 'mira'), bot(1, 0, 'ilvane'), bot(2, 0, 'tobin'), bot(5, 1, 'lysa'), bot(6, 1, 'kiran'), bot(7, 1, 'aurel')],
  minionsEnabled: false,
  trainer: { level: 11, rounds: 2, roundSec: 40 },
  ...(utility ? { botUtility: true } : {}),
});

describe('combat micro in games', () => {
  it('a beta-brain game is deterministic (same seed, same hash) with the micro layer on', () => {
    const run = () => {
      const config = botGameConfig(5, 'gold');
      config.botUtility = true;
      return runBotGame(config, 2 * MIN, undefined, { reflex: true }).hash;
    };
    expect(run()).toBe(run());
  }, 300_000);

  it('arena fight: the beta brain dodges (logged, no coordinates in the log), the default brain never runs the micro layer', () => {
    const beta = runBotGame(arena(true), 70 * 30, undefined, { reflex: true });
    const noticed = beta.bots.bots.reduce((a, b) => a + dodgeStats(b.mem).threats, 0);
    expect(noticed).toBeGreaterThan(0);
    const logs = beta.bots.log.entries().filter((e) => e.node === 'dodge');
    expect(logs.length).toBeGreaterThan(0);
    for (const e of logs) for (const k of Object.keys(e.inputs)) expect(k).not.toMatch(/(X|Y)$/);
    expect(beta.stats.reduce((a, s) => a + s.damageToChampions, 0)).toBeGreaterThan(1000);
    const plain = runBotGame(arena(false), 70 * 30);
    expect(plain.bots.bots.reduce((a, b) => a + dodgeStats(b.mem).threats, 0)).toBe(0);
    expect(plain.bots.log.entries().filter((e) => e.node === 'dodge' && e.chosen === 'sidestep').length).toBe(0);
  }, 300_000);
});
