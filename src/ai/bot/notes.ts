// Tilda's notes for bots: walk over a nearby own-team note when no enemy champion is close and the bot is not fighting.
// The notes are snapshot objects (tag tilda_note, own team only). holdUntil keeps the lane leaf from overriding the walk.
import type { BotAction, BotMemory, BotStatic } from './types';
import { dst } from './geo';
import type { View } from './perception';

const NOTE_REACH = 750;
const SAFE_DIST = 1000;
const HOLD_TICKS = 20;

export function noteStep(v: View, ctx: BotStatic, mem: BotMemory): BotAction | null {
  if (ctx.champ.id !== 'tilda' || v.me.dead || mem.mode === 'fight' || v.me.recallLeft > 0) return null;
  if (v.enemies.some((e) => dst(e, v.self) < SAFE_DIST) || v.enemyTowers.some((t) => dst(t, v.self) < 1000)) return null;
  let best: { x: number; y: number } | null = null;
  let bd = NOTE_REACH;
  for (const o of v.snap.objects) {
    if (o.tag !== 'tilda_note') continue;
    const d = dst(v.self, o);
    if (d < bd) (bd = d), (best = o);
  }
  if (!best) return null;
  mem.holdUntil = v.tick + HOLD_TICKS;
  return { cmd: { t: 'move', x: best.x, y: best.y } };
}
