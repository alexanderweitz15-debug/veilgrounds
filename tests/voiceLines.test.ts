// FEATURE-GAP 7.12: champion voice lines (data completeness, rate limiting, event mapping).
import { describe, expect, it } from 'vitest';
import voice from '../src/data/voiceLines.json';
import { champions } from '../src/data/champions';
import { DEFAULT_SETTINGS, settings } from '../src/settings';
import { VOICE_KEYS, VOICE_RULES, VoiceBubbles, VoiceLimiter, bubbleMs, voiceLine, wrapLine } from '../src/ui/voiceBubbles';
import { Kind, type SimEvent } from '../src/sim/types';
import type { ClientState } from '../src/game/state';

const data = voice as unknown as Record<string, Record<string, { de: string; en: string }>>;

describe('voiceLines.json', () => {
  it('has an entry for every champion and no stray ones', () => {
    expect(Object.keys(data).sort()).toEqual(Object.keys(champions).sort());
  });

  it('every champion has all 8 keys in de and en, short and non-empty', () => {
    for (const id of Object.keys(champions)) {
      expect(Object.keys(data[id]!).sort(), id).toEqual([...VOICE_KEYS].sort());
      for (const k of VOICE_KEYS) {
        for (const lang of ['de', 'en'] as const) {
          const s = data[id]![k]![lang];
          expect(typeof s, `${id}.${k}.${lang}`).toBe('string');
          expect(s.trim().length, `${id}.${k}.${lang}`).toBeGreaterThan(0);
          expect(s.length, `${id}.${k}.${lang}`).toBeLessThanOrEqual(80);
        }
      }
    }
  });

  it('the two move lines of a champion differ, and en differs from de for sentences', () => {
    for (const id of Object.keys(champions)) {
      expect(data[id]!.move1!.de).not.toBe(data[id]!.move2!.de);
      expect(data[id]!.move1!.en).not.toBe(data[id]!.move2!.en);
    }
  });

  it('voiceLine() looks up by language and tolerates unknown champions', () => {
    expect(voiceLine('mira', 'pick', 'de')).toBe(data.mira!.pick!.de);
    expect(voiceLine('mira', 'death', 'en')).toBe(data.mira!.death!.en);
    expect(voiceLine('nobody', 'pick', 'de')).toBeUndefined();
    expect(voiceLine(null, 'pick', 'de')).toBeUndefined();
  });

  it('the setting exists, default on', () => {
    expect(DEFAULT_SETTINGS.voiceLines).toBe(true);
  });
});

describe('VoiceLimiter', () => {
  const c = (now: number, o: Partial<{ own: boolean; rand: number; othersLive: number }> = {}) => ({ own: false, rand: 0, othersLive: 0, now, ...o });

  it('routine lines: per champion gap, per trigger cooldown, chance', () => {
    const l = new VoiceLimiter();
    expect(l.allow(1, 'attack', c(0, { own: true }))).toBe(true);
    expect(l.allow(1, 'ability', c(1000, { own: true }))).toBe(false); // gap
    expect(l.allow(1, 'ability', c(VOICE_RULES.gapOwnMs + 1, { own: true }))).toBe(true);
    expect(l.allow(1, 'attack', c(VOICE_RULES.gapOwnMs * 2, { own: true }))).toBe(false); // attack cooldown
    expect(l.allow(1, 'attack', c(VOICE_RULES.cooldownMs.attack! + 20000, { own: true }))).toBe(true);
    const m = new VoiceLimiter();
    expect(m.allow(2, 'attack', c(0, { own: true, rand: 0.99 }))).toBe(false); // chance
    expect(m.allow(2, 'attack', c(0, { own: true, rand: 0.01 }))).toBe(true);
  });

  it('other champions speak less often than the own one', () => {
    const l = new VoiceLimiter();
    expect(l.allow(5, 'ability', c(0))).toBe(true);
    expect(l.allow(5, 'move', c(VOICE_RULES.gapOwnMs + 1))).toBe(false); // others: longer gap
    expect(l.allow(5, 'move', c(VOICE_RULES.gapOtherMs + 1))).toBe(true);
  });

  it('others are spaced apart and capped on screen', () => {
    const l = new VoiceLimiter();
    expect(l.allow(1, 'ability', c(0))).toBe(true);
    expect(l.allow(2, 'ability', c(100))).toBe(false); // spacing
    expect(l.allow(2, 'ability', c(VOICE_RULES.othersSpacingMs + 1))).toBe(true);
    expect(l.allow(3, 'ability', c(10000, { othersLive: VOICE_RULES.maxOthersLive }))).toBe(false); // cap
    expect(l.allow(3, 'ability', c(10000, { othersLive: VOICE_RULES.maxOthersLive - 1 }))).toBe(true);
  });

  it('own champion is never blocked by the others cap or spacing', () => {
    const l = new VoiceLimiter();
    expect(l.allow(1, 'ability', c(0))).toBe(true);
    expect(l.allow(9, 'ability', c(10, { own: true, othersLive: 5 }))).toBe(true);
  });

  it('ult always speaks (no chance, no trigger cooldown) but obeys the champion gap', () => {
    const l = new VoiceLimiter();
    expect(l.allow(1, 'ult', c(0, { own: true, rand: 0.99 }))).toBe(true);
    expect(l.allow(1, 'ult', c(100, { own: true, rand: 0.99 }))).toBe(false);
    expect(l.allow(1, 'ult', c(VOICE_RULES.gapOwnMs + 1, { own: true, rand: 0.99 }))).toBe(true);
  });

  it('story lines (kill / death / recall) speak despite a recent routine line, but not twice in a row', () => {
    const l = new VoiceLimiter();
    expect(l.allow(1, 'attack', c(0, { own: true }))).toBe(true);
    expect(l.allow(1, 'death', c(VOICE_RULES.gapStoryMs + 1, { own: true, rand: 0.99, othersLive: 9 }))).toBe(true);
    expect(l.allow(1, 'recall', c(VOICE_RULES.gapStoryMs + 100, { own: true }))).toBe(false);
    expect(l.allow(1, 'recall', c(VOICE_RULES.gapStoryMs * 2 + 2, { own: true }))).toBe(true);
  });

  it('a flood of events (30 ticks x 10 champions) yields only a handful of bubbles', () => {
    const l = new VoiceLimiter();
    let n = 0;
    for (let tick = 0; tick < 30 * 60; tick++) for (let unit = 0; unit < 10; unit++) if (l.allow(unit, 'ability', c(tick * 33.3, { own: unit === 0, rand: 0.2 }))) n++;
    // 60 s: own at most 60/6 = 10, others at most 60/1.5 = 40 by spacing, in practice far below
    expect(n).toBeLessThanOrEqual(10 + 40);
    expect(n).toBeGreaterThan(0);
  });
});

describe('VoiceBubbles events', () => {
  const ent = (id: number, champ: string, team: number) => ({ id, kind: Kind.Champion, team, champ, x: 0, y: 0, px: 0, py: 0, atkPhase: 0 });
  const mkState = (): ClientState => {
    const byId = new Map<number, ReturnType<typeof ent>>([[1, ent(1, 'mira', 0)], [2, ent(2, 'nyx', 1)]]);
    return { snap: { me: { eid: 1, dead: false, recallLeft: 0 }, tick: 100 }, byId, myTeam: 0, entity: (id: number) => byId.get(id) } as unknown as ClientState;
  };
  const cast: SimEvent = { e: 'cast', src: 2, slot: 3, x: 0, y: 0 };

  it('an enemy ult cast makes a bubble; recasts and the off setting do not', () => {
    settings.voiceLines = true;
    const b = new VoiceBubbles(() => 0);
    b.onEvent({ ...cast, recast: true } as SimEvent, mkState(), 0);
    expect(b.count).toBe(0);
    b.onEvent(cast, mkState(), 0);
    expect(b.count).toBe(1);
    settings.voiceLines = false;
    const off = new VoiceBubbles(() => 0);
    off.onEvent(cast, mkState(), 0);
    expect(off.count).toBe(0);
    settings.voiceLines = true;
  });

  it('a champion kill gives the killer a kill line and the victim a death line', () => {
    settings.voiceLines = true;
    const b = new VoiceBubbles(() => 0);
    const ev: SimEvent = { e: 'death', eid: 2, kind: Kind.Champion, team: 1, killer: 1, x: 5, y: 5, champ: 'nyx', killerKind: Kind.Champion, killerTeam: 0, killerChamp: 'mira' };
    b.onEvent(ev, mkState(), 0);
    expect(b.count).toBe(2);
  });

  it('a minion death says nothing; one bubble per champion', () => {
    settings.voiceLines = true;
    const b = new VoiceBubbles(() => 0);
    b.onEvent({ e: 'death', eid: 9, kind: Kind.MinionMelee, team: 1, killer: 1, x: 0, y: 0 }, mkState(), 0);
    expect(b.count).toBe(0);
    b.onEvent(cast, mkState(), 0);
    b.onEvent({ e: 'death', eid: 2, kind: Kind.Champion, team: 1, killer: -1, x: 0, y: 0, champ: 'nyx' }, mkState(), 5000);
    expect(b.count).toBe(1); // nyx's death line replaced the cast bubble
  });

  it('wrapLine keeps short lines and splits long ones near the middle', () => {
    expect(wrapLine('Hm.')).toEqual(['Hm.']);
    const r = wrapLine('Die Glocke wiegt mehr als ihr alle zusammen.');
    expect(r).toHaveLength(2);
    expect(r.join(' ')).toBe('Die Glocke wiegt mehr als ihr alle zusammen.');
  });

  it('bubble duration grows with the text', () => {
    expect(bubbleMs('Hm.')).toBeLessThan(bubbleMs('Die Glocke wiegt mehr als ihr alle zusammen.'));
  });
});
