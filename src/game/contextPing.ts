// What a ping means at a place: objective pits and camps carry their respawn timer, a champion or lane carries the
// "missing" name. Used by Alt+click in the world, Alt+click on the minimap and the ping wheel. Pure given its data.
import type { Pt } from '../sim/map';
import { Kind, type PingKind } from '../sim/types';
import { t } from '../i18n';
import { champName } from '../ui/names';
import type { CampTimers } from './campTimers';
import { laneName, laneNear, missingPingText, objectivePingText, type LaneKey } from './pingText';
import type { Epic } from './objectives';

export interface PingReq {
  kind: PingKind;
  x: number;
  y: number;
  target?: number;
  label?: string;
}

/** The slice of a hovered unit the ping logic reads. */
export interface PingHover {
  id: number;
  kind: number;
  team: number;
  x: number;
  y: number;
  radius: number;
  variant?: string;
  champ?: string | null;
}

export interface PingCtx {
  epics: { kind: Epic; left: number | null }[];
  camps: CampTimers;
  tick: number;
  pits: { leviathan: Pt; kesselbrut: Pt };
  lanes: Record<LaneKey, readonly Pt[]>;
  myTeam: number;
}

const PIT_R = 700;
const VARIANT_EPIC: Record<string, Epic> = { leviathan: 'leviathan', kesselbrut: 'kesselbrut', schleierwaechter: 'schleier' };

/** Objective ping with its timer, when (x, y) is at an epic pit (also from a monster standing in it) or a camp with a running timer. */
export function objectiveAt(c: PingCtx, x: number, y: number, hover?: PingHover | null): PingReq | null {
  const epic = hover?.kind === Kind.Monster && hover.variant ? VARIANT_EPIC[hover.variant] : undefined;
  if (epic) return { kind: 'objective', x: hover!.x, y: hover!.y, target: hover!.id, label: objectivePingText(t(`epic.${epic}`), null) };
  const near = (p: Pt): boolean => (p.x - x) ** 2 + (p.y - y) ** 2 < PIT_R ** 2;
  const left = (k: Epic): number | null | undefined => c.epics.find((e) => e.kind === k)?.left;
  if (near(c.pits.leviathan)) {
    const l = left('leviathan');
    return { kind: 'objective', x: c.pits.leviathan.x, y: c.pits.leviathan.y, label: objectivePingText(t('epic.leviathan'), l ?? null) };
  }
  if (near(c.pits.kesselbrut)) {
    // the pit holds the Kesselbrut until its last wave, then the Schleierwaechter
    const k: Epic = left('kesselbrut') !== undefined ? 'kesselbrut' : 'schleier';
    return { kind: 'objective', x: c.pits.kesselbrut.x, y: c.pits.kesselbrut.y, label: objectivePingText(t(`epic.${k}`), left(k) ?? null) };
  }
  const camp = hover?.kind === Kind.Monster ? c.camps.campAt(hover.x, hover.y) : c.camps.campAt(x, y);
  if (camp) {
    const l = c.camps.left(camp, c.tick);
    const name = t(`unit.${camp.id}`);
    if (l !== null) return { kind: 'alert', x: camp.x, y: camp.y, label: objectivePingText(name, l) };
    if (hover?.kind === Kind.Monster) return { kind: 'alert', x: hover.x, y: hover.y, target: hover.id, label: objectivePingText(name, null) };
  }
  return null;
}

/** Missing ping: on an enemy champion ("Wren vermisst"), else on the lane under (x, y) ("Mid vermisst"). */
export function missingAt(c: PingCtx, x: number, y: number, hover?: PingHover | null): PingReq {
  if (hover?.kind === Kind.Champion && hover.team !== c.myTeam && hover.team <= 1) return { kind: 'missing', x: hover.x, y: hover.y, target: hover.id, label: missingPingText(champName(hover.champ ?? null)) };
  const lane = laneNear(x, y, c.lanes);
  return { kind: 'missing', x, y, ...(lane ? { label: missingPingText(laneName(lane)) } : {}) };
}
