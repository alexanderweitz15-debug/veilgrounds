// Elemental Leviathans on the client (swarm drakes-ui): buff text, announcer banners, epic-timer element, icon glyphs,
// bot value ordering and respawn timers.
import { describe, expect, it } from 'vitest';
import { ELDER_ELEM, ELEMENTS } from '../src/sim/drakes';
import type { SnapDrake } from '../src/sim/snapshot';
import { DRAKE_GLYPH, chipElem, chipLine, drakeBanners, drakeBuffTip, drakeBuffs, drakeKillBanner, drakeSummary, elemColor, elemFx, newDrakeSeen, statText } from '../src/ui/drakes';
import { leviathanGold } from '../src/ai/utility/value';
import { objectiveFirstS, objectiveRespawnS } from '../src/ai/objectiveTimers';
import { CAMPS } from '../src/sim/systems/jungle';
import { ELDER } from '../src/sim/drakes';

const G = 0; // glut
const F = 1; // flut
const FE = 2; // fels
const drake = (p: Partial<SnapDrake> = {}): SnapDrake => ({ kills: [[], []], soul: [-1, -1], soulType: -1, cur: G, next: -1, elder: false, elderLeft: [0, 0], ...p });
const icons = Object.values(import.meta.glob<string>('../src/ui/icons.ts', { query: '?raw', import: 'default', eager: true }))[0] ?? '';

describe('drake text', () => {
  it('sums the stack bonus and formats percent stats', () => {
    expect(statText({ adPct: 3, apPct: 3 }, 2)).toBe(`+6 % ${statText({ adPct: 1 }).split(' % ')[1]}, +6 % ${statText({ apPct: 1 }).split(' % ')[1]}`);
    expect(statText({ hp: 40 })).toMatch(/^\+40 \S/);
  });
  it('buff entries: one per element with count, soul last, tooltip with soul progress', () => {
    const b = drakeBuffs([G, FE, G], -1);
    expect(b.map((x) => x.key)).toEqual(['drake:glut:2', 'drake:fels:1']);
    expect(b[0]!.label).toMatch(/2x/);
    expect(drakeBuffTip(b[0]!)).toContain('+6 %');
    expect(drakeBuffTip(b[0]!)).toContain('3 / 4');
    const s = drakeBuffs([G, G, G, G], G);
    expect(s.at(-1)!.soul).toBe(true);
    expect(s.at(-1)!.stats).toContain('+10 %');
    expect(drakeSummary([], -1)).toContain('0 / 4');
  });
  it('every element has colour, particle kind and an icon glyph that icons.ts draws', () => {
    for (let e = 0; e <= ELEMENTS.length; e++) {
      expect(elemColor(e)).toMatch(/^#[0-9a-f]{6}$/);
      expect(elemFx(e)).toBeTruthy();
    }
    for (const el of [...ELEMENTS.map((x) => x.id), 'elder']) expect(new RegExp(`^  ${DRAKE_GLYPH[el]}: \\(g, c\\) =>`, 'm').test(icons), el).toBe(true);
  });
});

describe('epic chip element', () => {
  it('shows the current element while up and the announced next one while on cooldown', () => {
    const d = drake({ cur: G, next: F });
    expect(chipElem(d, true)).toBe(G);
    expect(chipElem(d, false)).toBe(F);
    expect(chipElem(undefined, true)).toBe(-1);
    expect(chipLine(drake({ next: -1 }), false)).toBe('');
    expect(chipLine(d, false)).toContain('Flut');
  });
});

describe('announcer banners', () => {
  it('announces the next element after the first kill, the soul element before the third spawn', () => {
    const seen = newDrakeSeen();
    expect(drakeBanners(seen, drake({ cur: G }), 0)).toEqual([]);
    const b1 = drakeBanners(seen, drake({ cur: G, next: F }), 0);
    expect(b1).toHaveLength(1);
    expect(b1[0]!.title).toContain('Flut');
    expect(drakeBanners(seen, drake({ cur: G, next: F }), 0)).toEqual([]);
    const b2 = drakeBanners(seen, drake({ cur: F, next: FE, soulType: FE }), 0);
    expect(b2[0]!.sub).not.toBe('');
  });
  it('announces a claimed soul once, own and enemy differently, and the Uralt-Leviathan spawn', () => {
    const seen = newDrakeSeen();
    drakeBanners(seen, drake({ cur: G, next: F }), 0);
    const own = drakeBanners(seen, drake({ cur: G, next: ELDER_ELEM, soul: [G, -1] }), 0);
    const enemy = drakeBanners(newDrakeSeen(), drake({ cur: G, next: ELDER_ELEM, soul: [G, -1] }), 1);
    expect(own).toHaveLength(1);
    expect(own[0]!.tone).toBe('epic');
    expect(enemy.find((x) => x.tone === 'bad')).toBeDefined();
    expect(drakeBanners(seen, drake({ cur: G, next: ELDER_ELEM, soul: [G, -1] }), 0)).toEqual([]);
    const spawn = drakeBanners(seen, drake({ cur: ELDER_ELEM, next: ELDER_ELEM, soul: [G, -1], elder: true }), 0);
    expect(spawn).toHaveLength(1);
    expect(spawn[0]!.title).toContain('Uralt');
  });
  it('kill banner carries the element; the elder has its own text', () => {
    expect(drakeKillBanner(drake({ cur: F }), true).sub).toContain('Flut');
    const e = drakeKillBanner(drake({ cur: ELDER_ELEM, elder: true }), false);
    expect(e.title).toContain('Uralt');
    expect(e.sub).toContain(String(ELDER.buffS));
  });
});

describe('bot value ordering', () => {
  it('soul point and denial worth more than a plain Leviathan, the elder worth most', () => {
    const plain = leviathanGold(drake({ cur: G }), 0);
    const soulPoint = leviathanGold(drake({ cur: G, kills: [[G, F, FE], []] }), 0);
    const deny = leviathanGold(drake({ cur: G, kills: [[], [G, F, FE]] }), 0);
    const elder = leviathanGold(drake({ cur: ELDER_ELEM, elder: true, soul: [G, -1] }), 1);
    expect(soulPoint).toBeGreaterThan(deny);
    expect(deny).toBeGreaterThan(plain);
    expect(elder).toBeGreaterThan(soulPoint);
    expect(leviathanGold(undefined, 0)).toBeGreaterThan(0);
  });
  it('elements differ in value (the announced next element counts while the pit is empty)', () => {
    const glut = leviathanGold(drake({ cur: FE, next: G }), 0);
    const wind = leviathanGold(drake({ cur: FE, next: 3 }), 0);
    expect(glut).toBeGreaterThan(wind);
  });
});

describe('bot objective timers', () => {
  it('Leviathan respawn follows the sim: normal camp time, Uralt-Leviathan time once the soul is claimed', () => {
    expect(objectiveRespawnS('leviathan', false)).toBe(CAMPS.leviathan.respawn);
    expect(objectiveRespawnS('leviathan', true)).toBe(ELDER.respawnS);
    expect(objectiveRespawnS('schleierwaechter', true)).toBe(CAMPS.schleierwaechter.respawn);
    expect(objectiveFirstS('leviathan')).toBe(CAMPS.leviathan.first);
  });
});
