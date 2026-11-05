// Dorrak's burrow for bots: dive when walking a long way (ganks, rotations) with no enemy champion near. The fight code
// never casts Burrow (combat.ts castSlot skips it: he cannot attack underground); E / Q / R surface him on arrival.
import type { BotAction, BotMemory, BotStatic } from './types';
import { ready } from './combat';
import { dst } from './geo';
import type { View } from './perception';

const MIN_TRIP = 1800;
const SAFE_DIST = 1200;
const RECENT_TICKS = 90;

export function burrowStep(v: View, ctx: BotStatic, mem: BotMemory): BotAction | null {
  if (ctx.champ.id !== 'dorrak' || v.me.dead || !v.self.moving || !mem.lastMove || v.tick - mem.lastMove.tick > RECENT_TICKS) return null;
  if (!ready(v, ctx, 1) || dst(v.self, mem.lastMove) < MIN_TRIP) return null;
  if (v.enemies.some((e) => dst(e, v.self) < SAFE_DIST)) return null;
  return { cmd: { t: 'cast', slot: 1, x: v.self.x, y: v.self.y } };
}
