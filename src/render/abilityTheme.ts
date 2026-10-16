// Ability "theme": which motif (fire, lightning, hook …) and element hue an ability has, from keyword rules on its
// English name/description. Shared by the ability icons (src/ui/icons.ts) and the missile colours (src/render/fx.ts).
// Pure data, no DOM/canvas.
import { championData } from '../sim/champions';
import motifData from './abilityMotifs.json';

/** Keyword rules on the ability's English name + description: [pattern, motif, element hue]. First match wins. */
export const MOTIF_RULES: [RegExp, string, number][] = [
  [/fire|ember|ash|flame|burn|ignite/, 'flame', 22],
  [/lightning|thunder|spark|storm|electr|bolt/, 'bolt', 52],
  [/water|jet|flood|current|spring|surge|sea|wave|steam|mist/, 'wave', 200],
  [/ice|frost|freeze|snow/, 'snow', 195],
  [/hook|anchor|harpoon|reel|haul|chain/, 'hook', 30],
  [/thread|\bweb\b|\bnets?\b|yarn|\bknot|\bwire|tripwire|\btrap/, 'web', 300],
  [/clock|rewind|standstill|wheel|\btime\b|\btick/, 'gear', 42],
  [/blade|\bcut\b|slash|execution|sevenfold|dagger/, 'dagger', 5],
  [/shield|\bwall\b|hide|guard|aegis/, 'shield', 210],
  [/slam|strike|\bram\b|\bfell\b|axe|smash/, 'axe', 18],
  [/\bbell|\btoll|\bpeal|\bring\b/, 'bell', 45],
  [/claw|pounce|fang|bear|jaw|hunt|pack|nose|stalk/, 'claw', 14],
  [/shadow|shroud|night|veil|dark|hollow|smoke|dusk/, 'moon', 270],
  [/light|lance|prism|sun|glare|lantern|verdict/, 'sun', 48],
  [/keg|powder|bomb|blast|burst/, 'bomb', 28],
  [/banner|monument|call|faith|march|duty/, 'banner', 10],
  [/whirl|whorl|spin/, 'spiral', 190],
  [/glass|dome|crystal/, 'glass', 185],
  [/root|grip|sap/, 'root', 110],
  [/arrow|shot|volley|bow|needle|spear/, 'arrow', 35],
];

/** Per-champion motif table (src/render/abilityMotifs.json): Q/W/E/R of one champion never share a motif. */
const MOTIF_OVERRIDES = (motifData as { champions: Record<string, [string, number][]> }).champions;
/** Motif keys the icon painter can draw. */
export const MOTIF_GLYPHS: readonly string[] = (motifData as { glyphs: string[] }).glyphs;

/** Motif key + element hue of ability `slot` of `champ`: the per-champion table first, then the name, then the description. */
export function abilityTheme(champ: string, slot: number): { motif: string; hue: number } | null {
  const ab = championData(champ)?.abilities[slot];
  if (!ab) return null;
  const o = MOTIF_OVERRIDES[champ]?.[slot];
  if (o) return { motif: o[0], hue: o[1] };
  const name = ab.name.en.toLowerCase();
  const text = `${name} ${ab.desc.en.toLowerCase()}`;
  for (const [re, motif, hue] of MOTIF_RULES) if (re.test(name)) return { motif, hue };
  for (const [re, motif, hue] of MOTIF_RULES) if (re.test(text)) return { motif, hue };
  return null;
}

/** Element hue (0..360) of an ability, null if no rule matches. */
export const abilityHue = (champ: string, slot: number): number | null => abilityTheme(champ, slot)?.hue ?? null;
