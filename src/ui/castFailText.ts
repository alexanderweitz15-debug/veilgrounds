// Cast-fail message over the ability bar (FEATURE-GAP 1.15): reason text, prefixed with the ability / item / summoner
// name, plus the missing number where the snapshot has it (cooldown seconds left, mana owned / needed).
import type { CastFailReason } from '../sim/types';

export interface CastFailHud {
  /** abilities[0..3] Q W E R, [4..6] summoner spells (PlayerHud.abilities). */
  abilities: { cdLeft: number; cost: number }[];
  itemCds?: { left: number }[];
}

type Tr = (key: string, params?: Record<string, string | number>) => string;

/** `label` = name of the ability / item / summoner spell that failed ('' = none). */
export function castFailText(ev: { reason: CastFailReason; slot: number; summoner?: true; item?: true }, hud: CastFailHud, mana: number, label: string, tr: Tr): string {
  const ab = hud.abilities[ev.summoner ? 4 + ev.slot : ev.slot];
  let msg = tr(ev.item && ev.reason !== 'busy' ? `castFail.item.${ev.reason}` : `castFail.${ev.reason}`);
  if (ev.reason === 'cooldown') {
    const left = ev.item ? hud.itemCds?.[ev.slot]?.left : ab?.cdLeft;
    if (left && left > 0) msg += ` (${left >= 1 ? Math.ceil(left) : left.toFixed(1)} s)`;
  } else if (ev.reason === 'mana' && !ev.item && ab && ab.cost > 0) msg += ` (${Math.floor(mana)} / ${Math.ceil(ab.cost)})`;
  return label ? `${label}: ${msg}` : msg;
}
