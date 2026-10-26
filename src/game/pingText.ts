// Context ping texts (LoL: Alt+click on an objective, a camp, an enemy summoner spell / item, an own ability) and the
// helpers behind the missing-ping label. Pure apart from `t()`, so the formatting is unit-tested.
import { t } from '../i18n';
import type { Pt } from '../sim/map';
import { PING_LABEL_MAX } from '../sim/pingRules';

/** m:ss for a countdown in seconds (rounded up, never negative). */
export function clock(seconds: number): string {
  const v = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
}

/** Hard cap so a long translated name never gets cut mid-number by the sim's label limit. */
function fit(s: string): string {
  return s.length <= PING_LABEL_MAX ? s : `${s.slice(0, PING_LABEL_MAX - 1).trimEnd()}…`;
}

/** Objective / camp: "Flussleviathan in 1:23" or, when it is alive (left null or 0), "Flussleviathan ist da!". */
export function objectivePingText(name: string, left: number | null): string {
  return fit(left === null || left <= 0 ? t('pingctx.up', { name }) : t('pingctx.in', { name, time: clock(left) }));
}

/** Enemy summoner spell or item cooldown: "Blitz nicht bereit (2:10)", or "Blitz bereit" with no running timer. */
export function cooldownPingText(name: string, left: number | null): string {
  return fit(left !== null && left > 0 ? t('pingctx.notReady', { name, time: clock(left) }) : t('pingctx.ready', { name }));
}

/** Own ability: "Q bereit in 4 s", "Q bereit", "R nicht gelernt". Cooldowns over a minute read as m:ss. */
export function abilityPingText(key: string, left: number, learned = true): string {
  if (!learned) return fit(t('pingctx.abilityUnlearned', { key }));
  if (left <= 0) return fit(t('pingctx.abilityReady', { key }));
  return fit(left >= 60 ? t('pingctx.abilityInTime', { key, time: clock(left) }) : t('pingctx.abilityIn', { key, s: Math.ceil(left) }));
}

/** Enemy item seen in the target frame: "Wren hat Sturmklinge". */
export function itemPingText(who: string, item: string): string {
  return fit(t('pingctx.hasItem', { who, item }));
}

/** Missing ping: "Wren vermisst" on a champion, "Mid vermisst" on a lane. */
export function missingPingText(who: string): string {
  return fit(t('pingctx.missing', { who }));
}

export type LaneKey = 'top' | 'mid' | 'bot';

/** Lane closest to a point (own side's waypoints), or null when the point is nowhere near a lane (jungle, base). */
export function laneNear(x: number, y: number, lanes: Record<LaneKey, readonly Pt[]>, maxDist = 1600): LaneKey | null {
  let best: LaneKey | null = null;
  let bestD = maxDist * maxDist;
  for (const k of ['top', 'mid', 'bot'] as const) {
    const pts = lanes[k];
    for (let i = 0; i + 1 < pts.length; i++) {
      const d = segDist2(x, y, pts[i]!, pts[i + 1]!);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
  }
  return best;
}

function segDist2(px: number, py: number, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const k = l2 > 0 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2)) : 0;
  return (px - a.x - k * dx) ** 2 + (py - a.y - k * dy) ** 2;
}

/** "Mid" / "Top" / "Bot" display name. */
export const laneName = (k: LaneKey): string => t(`pingctx.lane.${k}`);
