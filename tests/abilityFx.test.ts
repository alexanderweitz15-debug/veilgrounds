// Agent F: missile shape language (src/render/missileStyles.ts) and the per-tag ground-object drawer coverage
// (src/render/abilityFx.ts). Both are importable without a DOM (three.js types only).
import { describe, expect, it } from 'vitest';
import { missileShape, SHAPED_MOTIFS } from '../src/render/missileStyles';
import { ABILITY_FX_TAGS } from '../src/render/abilityFx';
import { abilityTheme, MOTIF_GLYPHS } from '../src/render/abilityTheme';
import { champions } from '../src/data/champions';

describe('missile shapes', () => {
  it('every ability missile motif of the roster has a shape of its own; the generic bolt is the fallback', () => {
    const seen = new Set<string>();
    for (const id of Object.keys(champions)) {
      champions[id]!.abilities.forEach((ab, slot) => {
        if (ab.type !== 'skillshot_line' && ab.type !== 'targeted' && ab.type !== 'skillshot_circle') return;
        const motif = abilityTheme(id, slot)?.motif;
        if (motif) seen.add(motif);
      });
    }
    const missing = [...seen].filter((m) => !SHAPED_MOTIFS.includes(m));
    expect(missing).toEqual([]);
    expect(missileShape(undefined, false)).toEqual(missileShape('nope', false));
  });

  it('shapes differ between families: an arrow is long and thin, a wave wide and flat, a keg tumbles, a blade spins', () => {
    const arrow = missileShape('arrow', false);
    const wave = missileShape('wave', false);
    const bomb = missileShape('bomb', false);
    const dagger = missileShape('dagger', false);
    expect(arrow.length).toBeGreaterThan(3.5);
    expect(arrow.thick).toBeLessThan(0.4);
    expect(wave.wide).toBeGreaterThan(2);
    expect(wave.thick).toBeLessThan(0.5);
    expect(bomb.tumble).toBeGreaterThan(0);
    expect(dagger.spin).toBeGreaterThan(0);
    // homing versions stay compact and fly high
    expect(missileShape('arrow', true).length).toBeLessThanOrEqual(2.2);
    expect(missileShape('arrow', true).height).toBeGreaterThanOrEqual(100);
    // all shaped motifs are motifs the icon painter knows
    for (const m of SHAPED_MOTIFS) expect([m, MOTIF_GLYPHS.includes(m) || m === 'spark']).toEqual([m, true]);
  });
});

describe('ability ground objects', () => {
  it('every hook object tag of the roster (except Sev, generic blades/traps and plain rings) has its own drawer', () => {
    const generic = new Set(['renn_blade', 'grimald_trap', 'isolde_anchor', 'tobin_q_range', 'ottilie_q_leap', 'corvin_keg']);
    const tags = new Set<string>();
    const fs = await_tags();
    for (const t of fs) if (!t.startsWith('sev_') && !generic.has(t)) tags.add(t);
    for (const t of tags) expect([t, ABILITY_FX_TAGS.includes(t)]).toEqual([t, true]);
  });
});

/** Hook object tags as written in src/sim/champions/*.ts (string scan, no sim import needed). */
function await_tags(): string[] {
  // kept in sync by hand with the `tag: '...'` literals of the champion hooks (grep "tag: '" src/sim/champions)
  return [
    'wren_r_storm', 'wren_e_smoke', 'tobin_q_tether', 'tobin_q_range', 'ottilie_w_scout', 'ottilie_q_leap', 'oleth_r_wall',
    'oda_p_spring', 'nyx_r_veil', 'lio_r_rain', 'kiran_p_thread', 'kiran_e_link', 'isolde_wire', 'isolde_dome', 'isolde_anchor',
    'hagen_r_peal', 'grimald_r_aura', 'dagny_e_wall', 'corvin_w_keg', 'corvin_keg', 'aurel_e_rewind', 'nyx_seed', 'renn_blade', 'grimald_trap',
  ];
}
