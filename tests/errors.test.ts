// Spec-bots §6 named error injections: rates per rank (data/bots/errors.json), interpolation, deterministic draws.
import { describe, expect, it } from 'vitest';
import { ERROR_IDS, errorChance, maybeInject } from '../src/ai/errors';
import type { ErrorId } from '../src/ai/contract';
import { profileOf } from '../src/ai/profiles';
import { RANKS, type Rank } from '../src/ai/profiles/schema';
import { Rng } from '../src/sim/rng';

/** Compile-time exhaustiveness against the contract's ErrorId union. */
const ALL: Record<ErrorId, true> = {
  trade_on_cooldown: true, fight_in_enemy_wave: true, ignore_minion_aggro: true, no_flash_tracking: true, chase_third_kill: true,
  flash_into_wall: true, overcommit_after_kill: true, flash_wrong_direction: true, roam_from_push: true, flash_in_dive: true,
  carry_too_far: true, late_recall: true, idle_after_shove: true,
};

const at = (id: ErrorId, r: Rank): number => errorChance(id, profileOf(r).skill);

describe('error injection rates', () => {
  it('every ErrorId has a rate table', () => {
    expect([...ERROR_IDS].sort()).toEqual(Object.keys(ALL).sort());
  });

  it('spec numbers per rank', () => {
    expect(at('flash_wrong_direction', 'iron')).toBe(0.15);
    expect(at('flash_wrong_direction', 'silver')).toBe(0);
    expect(at('roam_from_push', 'iron')).toBe(0.3);
    expect(at('roam_from_push', 'silver')).toBe(0.3);
    expect(at('roam_from_push', 'gold')).toBe(0);
    expect(at('flash_in_dive', 'gold')).toBe(0.4);
    expect(at('flash_in_dive', 'platinum')).toBe(0);
    expect(at('trade_on_cooldown', 'bronze')).toBe(0.7);
    expect(at('no_flash_tracking', 'emerald')).toBe(0.5);
    expect(at('no_flash_tracking', 'diamond')).toBe(0);
    expect(at('flash_into_wall', 'iron')).toBe(0.1);
    expect(at('flash_into_wall', 'bronze')).toBe(0.1);
    expect(at('flash_into_wall', 'silver')).toBe(0);
    expect(at('idle_after_shove', 'gold')).toBe(0.4);
    expect(at('carry_too_far', 'gold')).toBeGreaterThan(0);
    expect(at('carry_too_far', 'diamond')).toBe(0);
    expect(at('late_recall', 'iron')).toBeGreaterThan(0);
    for (const id of ERROR_IDS) expect(at(id, 'challenger'), id).toBe(0);
  });

  it('linear in skill between rank anchors', () => {
    // Gold 45 (0.4) -> Platinum 58 (0) for flash_in_dive
    expect(errorChance('flash_in_dive', 51.5)).toBeCloseTo(0.2, 6);
    expect(errorChance('flash_wrong_direction', 0)).toBe(0.15);
  });

  it('observed rates match the table by rank (+-3 points)', () => {
    const n = 3000;
    for (const id of ERROR_IDS)
      for (const r of RANKS) {
        const rng = new Rng(RANKS.indexOf(r) * 101 + id.length);
        const params = { skill: profileOf(r).skill };
        let hits = 0;
        for (let i = 0; i < n; i++) {
          const res = maybeInject(params, id, rng);
          if (res) {
            expect(res).toBe(id);
            hits++;
          }
        }
        expect(Math.abs(hits / n - at(id, r)), `${id} @ ${r}`).toBeLessThan(0.03);
      }
  });

  it('always draws exactly one number (stable Rng stream)', () => {
    const a = new Rng(9);
    const b = new Rng(9);
    maybeInject({ skill: 100 }, 'late_recall', a); // p = 0
    maybeInject({ skill: 5 }, 'late_recall', b); // p > 0
    expect(a.state()).toEqual(b.state());
  });
});
