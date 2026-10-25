import { describe, expect, it } from 'vitest';
import { botGameConfig } from '../src/ai/runner';
import { runBotGame } from '../src/ai/harness';
import { playGame, type GameSpec } from '../tools/benchmark/play';

// The benchmark observer is read-only: a game with the observer attached must end in exactly the same sim state as a
// plain run (stateHash), and the same spec must give the same numbers twice. Short games keep the test cheap; the
// observer code paths (commands, events, projectiles, per-champion state) are all exercised from the first minutes on.

const spec = (over: Partial<GameSpec>): GameSpec => ({ pair: 'iron:gold', x: 'iron', ref: 'gold', seed: 3, flip: true, brain: 'new', minutes: 2.5, set: 'L', variance: false, ...over });

function plainHash(s: GameSpec): string {
  const config = botGameConfig(s.seed, s.x);
  if (s.x !== s.ref) for (const p of config.players) if (p.team === (s.flip ? 0 : 1)) p.bot!.rank = s.ref;
  if (s.brain === 'new') config.botUtility = true;
  return runBotGame(config, Math.round(s.minutes * 60 * 30), undefined, { noVariance: !s.variance, reflex: s.brain === 'new' }).hash;
}

describe('benchmark determinism', () => {
  it('new brain: same spec gives identical numbers; the observer does not change the stateHash', () => {
    const s = spec({});
    const a = playGame(s);
    const b = playGame(s);
    expect(JSON.stringify(b.teams)).toBe(JSON.stringify(a.teams));
    expect(b.hash).toBe(a.hash);
    expect(plainHash(s)).toBe(a.hash);
    // something was actually measured
    expect(a.teams[0].ratio.idleAll?.[1]).toBeGreaterThan(0);
    expect(a.teams[0].ratio.util?.[1] ?? 0).toBeGreaterThanOrEqual(0);
  }, 900_000);

  it('old brain: the observer does not change the stateHash', () => {
    const s = spec({ brain: 'old', x: 'gold', pair: 'gold:gold', flip: false, seed: 5, minutes: 1.5 });
    expect(plainHash(s)).toBe(playGame(s).hash);
  }, 600_000);

  it('a different seed gives a different game', () => {
    const a = playGame(spec({ minutes: 1 }));
    const b = playGame(spec({ minutes: 1, seed: 4 }));
    expect(b.hash).not.toBe(a.hash);
  }, 600_000);
});
