// Accessibility: colour-blind palettes keep ally vs enemy (and the other paired relation colours) distinguishable.
// Colours are run through a colour-vision-deficiency simulation (Machado 2009, severity 1.0, linear RGB), then
// compared with CIE76 delta-E in Lab. Also: ping colour mapping, settings range, text scale.
import { describe, expect, it } from 'vitest';
import { REL_PALETTES, pingColors, type RelPalette } from '../src/render/palette';
import { DEFAULT_SETTINGS } from '../src/settings';
import { parseSettingsFile } from '../src/game/settingsIO';
import { ACTIONS } from '../src/input/keybinds';

type Vec = [number, number, number];
type Mat = [Vec, Vec, Vec];
const SIM: Record<'normal' | 'deuteranopia' | 'protanopia' | 'tritanopia', Mat | null> = {
  normal: null,
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};

const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rgb = (hex: string): Vec => [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255)) as Vec;

function lab(c: Vec): Vec {
  const [r, g, b] = c;
  const xyz = [0.4124 * r + 0.3576 * g + 0.1805 * b, 0.2126 * r + 0.7152 * g + 0.0722 * b, 0.0193 * r + 0.1192 * g + 0.9505 * b];
  const w = [0.95047, 1, 1.08883];
  const f = xyz.map((v, i) => { const t = v / w[i]!; return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; });
  return [116 * f[1]! - 16, 500 * (f[0]! - f[1]!), 200 * (f[1]! - f[2]!)];
}

/** Perceived delta-E (CIE76) of two sRGB hex colours as seen with the given vision type. */
export function deltaE(a: string, b: string, vision: keyof typeof SIM): number {
  const m = SIM[vision];
  const see = (h: string): Vec => {
    const c = rgb(h);
    return m ? (m.map((row) => Math.min(1, Math.max(0, row[0] * c[0] + row[1] * c[1] + row[2] * c[2]))) as Vec) : c;
  };
  const x = lab(see(a));
  const y = lab(see(b));
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

const MIN_DE = 30;
const PAIRS: [keyof RelPalette, keyof RelPalette][] = [
  ['ally', 'enemy'], ['ownShot', 'enemyShot'], ['allyText', 'enemyText'], ['moveClick', 'attackClick'], ['ownHoming', 'enemyHoming'],
  ['allySeal', 'enemySeal'], ['me', 'ally'], ['me', 'enemy'], ['meBar', 'ally'], ['meBar', 'enemy'],
];

describe('colour-blind palettes', () => {
  it('delta-E helper: identical 0, black vs white large', () => {
    expect(deltaE('#336699', '#336699', 'normal')).toBe(0);
    expect(deltaE('#000000', '#ffffff', 'deuteranopia')).toBeGreaterThan(90);
  });

  it('the plain red/green pair is NOT distinguishable for deuteranopia (the simulation bites)', () => {
    expect(deltaE('#d03030', '#30a030', 'deuteranopia')).toBeLessThan(deltaE('#d03030', '#30a030', 'normal'));
  });

  for (const mode of ['normal', 'deuteranopia', 'protanopia', 'tritanopia'] as const) {
    it(`${mode}: ally vs enemy (bars, rings, shots, text, clicks, minimap seals) stay >= ${MIN_DE} delta-E as seen with that vision`, () => {
      const p = REL_PALETTES[mode];
      const low = PAIRS.map(([a, b]) => [`${a}/${b}`, Math.round(deltaE(p[a], p[b], mode))] as const).filter(([, d]) => d < MIN_DE);
      expect(low).toEqual([]);
    });
  }

  it('every palette defines every relation colour as #rrggbb', () => {
    const keys = Object.keys(REL_PALETTES.normal);
    for (const p of Object.values(REL_PALETTES)) {
      expect(Object.keys(p).sort()).toEqual(keys.sort());
      for (const v of Object.values(p)) expect(v).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('ping colours: normal keeps the base, other modes follow the palette; danger vs onMyWay stay distinguishable', () => {
    expect(pingColors('normal')).toEqual({});
    for (const mode of ['deuteranopia', 'protanopia', 'tritanopia'] as const) {
      const c = pingColors(mode);
      expect(c.danger).toBe(REL_PALETTES[mode].enemy);
      expect(c.onMyWay).toBe(REL_PALETTES[mode].ally);
      expect(deltaE(c.danger!, c.onMyWay!, mode)).toBeGreaterThanOrEqual(MIN_DE);
    }
  });
});

describe('text scale setting', () => {
  it('default 100, import clamps to 90..150', () => {
    expect(DEFAULT_SETTINGS.textScale).toBe(100);
    const r = parseSettingsFile(JSON.stringify({ version: 1, settings: { textScale: 400 }, keybinds: {} }), DEFAULT_SETTINGS, ACTIONS);
    expect(r.settings.textScale).toBe(150);
    const r2 = parseSettingsFile(JSON.stringify({ version: 1, settings: { textScale: 10 }, keybinds: {} }), DEFAULT_SETTINGS, ACTIONS);
    expect(r2.settings.textScale).toBe(90);
  });
});
