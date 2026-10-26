// FEATURE-GAP 3.1: keybind editor core - alternates, key resolution, modifiers, conflicts, presets, per-key cast modes.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ACTIONS, BIND_IDS, DEFAULT_BINDS, actionFor, altBinds, applyBinds, applyDefaults, applyLolPreset, binds, clearBind,
  exportBindMap, findConflicts, modifierConflict, resolveKey, sanitizeBinds, setBind, type ModConfig,
} from '../src/input/keybinds';
import { castModeFor, castTargetFor } from '../src/input/castMode';
import { exportSettings, parseSettingsFile } from '../src/game/settingsIO';
import { DEFAULT_SETTINGS } from '../src/settings';

const none = { ctrlKey: false, shiftKey: false, altKey: false };
const cfg: ModConfig = { selfCastMod: 'alt', levelUpMod: 'ctrlOrShift' };

beforeEach(() => {
  applyDefaults();
});

describe('binding resolution', () => {
  it('defaults resolve, unbound keys do not', () => {
    expect(actionFor('KeyQ')).toBe('q');
    expect(actionFor('Digit4')).toBe('trinket');
    expect(actionFor('KeyJ')).toBeNull();
    expect(actionFor('')).toBeNull();
  });

  it('alternate key resolves to the same action; primary stays', () => {
    expect(setBind('q', 'KeyJ', 1).ok).toBe(true);
    expect(binds.q).toBe('KeyQ');
    expect(altBinds.q).toBe('KeyJ');
    expect(actionFor('KeyJ')).toBe('q');
    expect(actionFor('KeyQ')).toBe('q');
  });

  it('clearing the primary promotes the alternate (HUD shows the primary)', () => {
    setBind('q', 'KeyJ', 1);
    clearBind('q', 0);
    expect(binds.q).toBe('KeyJ');
    expect(altBinds.q).toBe('');
  });

  it('alternate on an unbound action becomes the primary', () => {
    clearBind('d', 0);
    setBind('d', 'KeyK', 1);
    expect(binds.d).toBe('KeyK');
    expect(altBinds.d).toBe('');
  });
});

describe('conflicts', () => {
  it('rebinding a used key moves it and reports who lost it', () => {
    const r = setBind('q', 'KeyW');
    expect(r.ok).toBe(true);
    expect(r.displaced).toEqual([{ action: 'w', slot: 0 }]);
    expect(binds.q).toBe('KeyW');
    expect(binds.w).toBe('');
    expect(findConflicts()).toEqual([]);
  });

  it('losing the primary promotes that action\'s alternate', () => {
    setBind('w', 'KeyJ', 1);
    setBind('q', 'KeyW');
    expect(binds.w).toBe('KeyJ');
  });

  it('same action other slot is not a conflict, key just moves', () => {
    setBind('q', 'KeyJ', 1);
    const r = setBind('q', 'KeyJ', 0);
    expect(r.displaced).toEqual([]);
    expect(binds.q).toBe('KeyJ');
    expect(altBinds.q).toBe('');
  });

  it('modifier keys and hard-wired keys are refused', () => {
    expect(setBind('q', 'ShiftLeft')).toMatchObject({ ok: false, reason: 'modifier' });
    expect(setBind('q', 'Escape')).toMatchObject({ ok: false, reason: 'reserved' });
    expect(setBind('q', 'Pause')).toMatchObject({ ok: false, reason: 'reserved' });
    expect(binds.q).toBe('KeyQ');
  });

  it('findConflicts / sanitizeBinds catch duplicates from hand-edited data', () => {
    binds.w = 'KeyQ';
    altBinds.e = 'KeyQ';
    expect(findConflicts().map((c) => c.code)).toEqual(['KeyQ']);
    sanitizeBinds();
    expect(findConflicts()).toEqual([]);
    expect(binds.q).toBe('KeyQ'); // first holder wins
    expect(binds.w).toBe('');
  });

  it('modifier overlap', () => {
    expect(modifierConflict({ selfCastMod: 'alt', levelUpMod: 'ctrl' })).toBe(false);
    expect(modifierConflict({ selfCastMod: 'ctrl', levelUpMod: 'ctrl' })).toBe(true);
    expect(modifierConflict({ selfCastMod: 'shift', levelUpMod: 'ctrlOrShift' })).toBe(true);
    expect(modifierConflict({ selfCastMod: 'none', levelUpMod: 'alt' })).toBe(false);
  });
});

describe('modifiers', () => {
  it('plain key: no modifier meaning', () => {
    expect(resolveKey({ code: 'KeyQ', ...none }, cfg)).toEqual({ action: 'q', levelUp: false, selfCast: false });
    expect(resolveKey({ code: 'KeyJ', ...none }, cfg)).toBeNull();
  });

  it('Alt self-casts abilities, summoners and items, not the ward or non-cast actions', () => {
    const alt = { ...none, altKey: true };
    for (const code of ['KeyQ', 'KeyD', 'KeyT', 'Digit1']) expect(resolveKey({ code, ...alt }, cfg)?.selfCast).toBe(true);
    expect(resolveKey({ code: 'Digit4', ...alt }, cfg)?.selfCast).toBe(false);
    expect(resolveKey({ code: 'KeyB', ...alt }, cfg)?.selfCast).toBe(false);
  });

  it('level-up modifier only on Q/W/E/R; Ctrl or Shift by default', () => {
    for (const m of [{ ctrlKey: true }, { shiftKey: true }]) {
      const r = resolveKey({ code: 'KeyR', ...none, ...m }, cfg);
      expect(r).toEqual({ action: 'r', levelUp: true, selfCast: false });
    }
    expect(resolveKey({ code: 'KeyD', ...none, ctrlKey: true }, cfg)?.levelUp).toBe(false);
  });

  it('strict Ctrl ignores Shift; configurable self-cast key', () => {
    expect(resolveKey({ code: 'KeyQ', ...none, shiftKey: true }, { selfCastMod: 'alt', levelUpMod: 'ctrl' })?.levelUp).toBe(false);
    const c: ModConfig = { selfCastMod: 'shift', levelUpMod: 'ctrl' };
    expect(resolveKey({ code: 'KeyQ', ...none, shiftKey: true }, c)?.selfCast).toBe(true);
    expect(resolveKey({ code: 'KeyQ', ...none, altKey: true }, { ...c, selfCastMod: 'none' })?.selfCast).toBe(false);
  });

  it('level-up wins when both modifiers are the same key', () => {
    const r = resolveKey({ code: 'KeyW', ...none, altKey: true }, { selfCastMod: 'alt', levelUpMod: 'alt' });
    expect(r).toEqual({ action: 'w', levelUp: true, selfCast: false });
  });

  it('alternate key + modifier works the same as the primary', () => {
    setBind('e', 'KeyJ', 1);
    expect(resolveKey({ code: 'KeyJ', ...none, altKey: true }, cfg)).toEqual({ action: 'e', levelUp: false, selfCast: true });
  });
});

describe('cast modes per key', () => {
  it('abilities follow castIndicator, other keys default to quick, own mode wins', () => {
    const s = { castIndicator: true, castModes: { d: 'normal', item2: 'indicator' } as const };
    expect(castModeFor(s, 'q')).toBe('indicator');
    expect(castModeFor(s, 3)).toBe('indicator');
    expect(castModeFor(s, 'f')).toBe('quick');
    expect(castModeFor(s, 'd')).toBe('normal');
    expect(castModeFor(s, 'item2')).toBe('indicator');
    expect(castModeFor(s, 'trinket')).toBe('quick');
  });

  it('cast targets map to sim commands', () => {
    expect(castTargetFor('w')).toEqual({ t: 'cast', slot: 1 });
    expect(castTargetFor('tp')).toEqual({ t: 'spell', slot: 2 });
    expect(castTargetFor('item6')).toEqual({ t: 'item', slot: 5 });
    expect(castTargetFor('trinket')).toEqual({ t: 'ward' });
  });
});

describe('presets, reset, export', () => {
  it('reset restores keys, alternates, modifiers, cast modes', () => {
    setBind('q', 'KeyJ', 1);
    setBind('d', 'KeyX');
    const patch = applyDefaults();
    expect(binds).toEqual(DEFAULT_BINDS);
    expect(ACTIONS.every((a) => altBinds[a] === '')).toBe(true);
    expect(patch).toEqual({ selfCastMod: 'alt', levelUpMod: 'ctrlOrShift', castModes: {} });
  });

  it('LoL preset: LoL keys, strict Ctrl level-up, Alt self-cast', () => {
    setBind('q', 'KeyJ', 1);
    setBind('stop', 'KeyX');
    expect(applyLolPreset()).toEqual({ selfCastMod: 'alt', levelUpMod: 'ctrl' });
    expect(binds.stop).toBe('KeyS');
    expect(altBinds.q).toBe('');
    expect(binds.toggleCameraLock).toBe('KeyY');
    expect(binds.centerCamera).toBe('Space');
  });

  it('applyBinds + export map round trip with alternates through the settings file', () => {
    setBind('q', 'KeyJ', 1);
    const text = exportSettings(DEFAULT_SETTINGS, exportBindMap());
    applyDefaults();
    const r = parseSettingsFile(text, DEFAULT_SETTINGS, BIND_IDS as never);
    expect(r.skipped).toEqual([]);
    applyBinds(r.keybinds);
    expect(altBinds.q).toBe('KeyJ');
    expect(binds.q).toBe('KeyQ');
  });

  it('cast modes for items / summoners / ward survive import, bad keys are dropped', () => {
    const text = JSON.stringify({ version: 1, settings: { castModes: { item1: 'normal', trinket: 'indicator', d: 'quick', nope: 'quick' }, selfCastMod: 'ctrl', levelUpMod: 'bogus' }, keybinds: {} });
    const r = parseSettingsFile(text, DEFAULT_SETTINGS, ACTIONS);
    expect(r.settings.castModes).toEqual({ item1: 'normal', trinket: 'indicator', d: 'quick' });
    expect(r.settings.selfCastMod).toBe('ctrl');
    expect(r.skipped).toEqual(['levelUpMod']);
  });
});
