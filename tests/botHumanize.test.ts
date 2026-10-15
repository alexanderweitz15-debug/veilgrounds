// Humanisation is visible in the decision log (spec-bots §1/§4.2/§9): tilt after deaths, chat lines, rolled
// personalities; tilt changes the bot's effective parameters.
import { describe, expect, it } from 'vitest';
import { runBotGame } from '../src/ai/harness';
import { botGameConfig } from '../src/ai/runner';
import { MAX_TILT, withTilt } from '../src/ai/params';
import { paramsFor } from './botScenario';

describe('humanisation in a bot game', () => {
  it('deaths raise tilt (logged), chat is logged, personalities differ', () => {
    const g = runBotGame(botGameConfig(5, 'iron'), 14 * 1800);
    const log = g.bots.log.entries();
    const died = g.stats.filter((s) => s.deaths > 0);
    expect(died.length).toBeGreaterThan(0);
    // the tilt is counted on respawn: a bot still dead at the end has not been counted yet
    const respawned = died.filter((s) => g.sim.c.Unit.alive[g.sim.slots[s.slot]!] === 1);
    for (const s of respawned) expect(log.some((e) => e.bot === s.slot && e.node === 'tilt' && e.reason === 'died'), `${s.champion} tilt`).toBe(true);
    expect(log.some((e) => e.node === 'chat')).toBe(true);
    const styles = new Set(g.bots.bots.map((b) => JSON.stringify(b.ctx.params.playstyle)));
    expect(styles.size).toBeGreaterThan(5);
  }, 300_000);

  it('tilt worsens execution and adds aggression, capped at MAX_TILT', () => {
    const p = paramsFor('gold');
    const t = withTilt(p, MAX_TILT + 5);
    expect(t.behavior.reactionMedianMs).toBeGreaterThan(p.behavior.reactionMedianMs);
    expect(t.behavior.lastHitJitterMs).toBeCloseTo(p.behavior.lastHitJitterMs * (1 + p.behavior.tiltPerformanceDropPct / 100), 6);
    expect(t.playstyle.aggression).toBe(p.playstyle.aggression + MAX_TILT);
    expect(withTilt(p, 0)).toBe(p);
  });
});
