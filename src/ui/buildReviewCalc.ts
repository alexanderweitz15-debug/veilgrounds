// DOM-free part of the post-game build review (tested).
import { BUILDS } from '../ai/bot/builds';

/** Standard core items (and boots) not in `owned`, in buy order. */
export function missingCore(champion: string, owned: readonly (string | null)[]): string[] {
  const b = BUILDS[champion]?.standard;
  if (!b) return [];
  return [b.boots, ...b.core].filter((id) => !owned.includes(id));
}
