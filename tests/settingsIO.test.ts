// C7 / FEATURE-GAP 3.13: settings export/import round trip and validation.
import { describe, expect, it } from 'vitest';
import { exportSettings, parseSettingsFile } from '../src/game/settingsIO';
import { DEFAULT_SETTINGS, type Settings } from '../src/settings';
import { ACTIONS, DEFAULT_BINDS } from '../src/input/keybinds';

describe('settings export / import', () => {
  it('round trip keeps every setting and keybind', () => {
    const s: Settings = { ...DEFAULT_SETTINGS, lang: 'en', minimapScale: 120, minimapLeft: true, runePresets: { mira: 'custom' } };
    const binds = { ...DEFAULT_BINDS, q: 'KeyZ' };
    const r = parseSettingsFile(exportSettings(s, binds), DEFAULT_SETTINGS, ACTIONS);
    expect(r.settings).toEqual(s);
    expect(r.keybinds).toEqual(binds);
    expect(r.skipped).toEqual([]);
  });

  it('drops unknown keys, wrong types and bad enum values; clamps slider values', () => {
    const text = JSON.stringify({
      version: 1,
      settings: { lang: 'fr', volume: 7, uiScale: 'big', bogus: 1, edgeScroll: false, runePresets: [1] },
      keybinds: { q: 'KeyX', nope: 'KeyY', w: 5 },
    });
    const r = parseSettingsFile(text, DEFAULT_SETTINGS, ACTIONS);
    expect(r.settings).toEqual({ volume: 1, edgeScroll: false });
    expect(r.keybinds).toEqual({ q: 'KeyX' });
    expect(r.skipped.sort()).toEqual(['bogus', 'keybind:nope', 'keybind:w', 'lang', 'runePresets', 'uiScale']);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseSettingsFile('{nope', DEFAULT_SETTINGS, ACTIONS)).toThrow();
  });
});
