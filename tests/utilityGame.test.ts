// Utility model in full games (flag set per bot, tests/utilityHarness.ts): test 7 (no idle without a logged reason)
// and determinism with the flag on. docs/BRAIN-REWORK.md §10.
import { beforeAll, describe, expect, it } from 'vitest';
import { botGameConfig } from '../src/ai/runner';
import { stateHash } from '../src/sim/sim';
import { measureIdle, type IdleStretch } from './utilityIdle';
import { runUtilityGame } from './utilityHarness';

const GAME_TICKS = 5 * 1800;

describe('test 7: no idle without a logged reason (Gold, 5 min, utility on)', () => {
  let stretches: IdleStretch[] = [];
  let share = 0;
  beforeAll(() => {
    const r = measureIdle(botGameConfig(1, 'gold'), GAME_TICKS);
    stretches = r.stretches;
    share = r.idleTicks / Math.max(1, r.aliveTicks);
  }, 300_000);

  it('every idle stretch > 45 ticks with a target in reach is governed by a logged intent decision with all candidate scores (or a logged attention window, §9)', () => {
    for (const s of stretches) {
      if (s.attention) continue; // distracted: the attention model logged the window ("alles im Log")
      expect(s.entry, `slot ${s.slot} tick ${s.from}`).not.toBeNull();
      expect(Object.keys(s.entry!.scores ?? {}).length + (s.entry!.injectedError ? 1 : 0), `slot ${s.slot} tick ${s.from}`).toBeGreaterThan(0);
    }
    expect(share).toBeLessThan(0.15);
  });

  // Strict form of test 7: the governing decision is 'none' (all candidates <= 0). Fails today because the farm /
  // push intents run the classic laning leaf, which stands still with minions in reach (holdTimer, BRAIN-IST §9.1);
  // A1's attack scheduler (Phase 1) removes that. When this starts passing, turn it into a plain `it`.
  it.fails('strict: every such idle stretch has all candidate scores <= 0 (needs A1 scheduler)', () => {
    expect(stretches.length).toBeGreaterThan(0);
    for (const s of stretches) {
      expect(s.entry?.chosen).toBe('none');
      for (const v of Object.values(s.entry?.scores ?? {})) expect(v).toBeLessThanOrEqual(0);
    }
  });
});

describe('determinism with the utility flag on', () => {
  it('same seed -> same state hash', () => {
    const a = runUtilityGame(botGameConfig(3, 'gold'), 2 * 1800);
    const b = runUtilityGame(botGameConfig(3, 'gold'), 2 * 1800);
    expect(stateHash(a.sim)).toBe(stateHash(b.sim));
  }, 300_000);
});
