// Shop search index (G/B5) and small formatting helpers, DOM-free for tests.
import type { ItemData } from '../sim/items/schema';
import { t } from '../i18n';

/** True when the item matches the (lower-case) query by name (both languages), stat label, passive/active name or tag. */
export function itemMatches(it: ItemData, q: string, lang: string): boolean {
  if (!q) return true;
  const l = lang === 'en' ? 'en' : 'de';
  const parts: string[] = [it.name.de, it.name.en, ...it.tags];
  for (const k of Object.keys(it.stats)) parts.push(t(`stat.${k}`));
  if (it.passive) parts.push(it.passive.name[l]);
  if (it.active) parts.push(it.active.name[l]);
  const hay = parts.join(' ').toLowerCase();
  return q.split(/\s+/).every((w) => !w || hay.includes(w));
}

/** Seconds -> "m:ss" (shop: "noch ca. 1:20 bei deiner Gold-Rate"). */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
