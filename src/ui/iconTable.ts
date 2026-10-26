// Icon motif tables (G icon rework), canvas-free so tests can read them: one glyph + hue per item and per rune
// (src/data/itemIcons.json); src/ui/icons.ts draws them.
import data from '../data/itemIcons.json';

export interface ItemIconSpec {
  /** Key into icons.ts ITEM_GLYPHS. */
  glyph: string;
  /** Backdrop hue (category colour) and saturation. */
  hue: number;
  sat?: number;
  /** Passive/active badge motif (MOTIF / GLYPHS / ITEM_GLYPHS key) and its hue. */
  accent?: string;
  accentHue?: number;
}

export interface RuneIconSpec {
  glyph: string;
  /** Path hue (Präzision 48, Dominanz 355, Zauberei 215, Entschlossenheit 120, Inspiration 180). */
  hue: number;
}

export const ITEM_ICON_TABLE = data.items as Record<string, ItemIconSpec>;
export const RUNE_ICON_TABLE = Object.fromEntries(Object.entries(data.runes).filter(([k]) => !k.startsWith('_'))) as Record<string, RuneIconSpec>;
