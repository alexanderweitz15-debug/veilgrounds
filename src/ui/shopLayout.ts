// Pure part of the shop panel (src/ui/shop.ts), kept DOM-free so it is testable headless.
import type { PlayerHud } from '../sim/snapshot';

/**
 * What the shop layout depends on. Gold is deliberately not part of it: gold ticks up every half second, and a full
 * rebuild resets the scroll position and swallows clicks; affordability is refreshed in place instead.
 */
export function shopLayoutKey(me: Pick<PlayerHud, 'champ' | 'items' | 'inFountain' | 'dead'>, selected: string | null, lang: string): string {
  return [me.champ, me.items.join(','), me.inFountain || me.dead, selected, lang].join('|');
}
