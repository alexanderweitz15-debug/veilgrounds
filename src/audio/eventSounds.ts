// Maps sim events (already fog-filtered by the snapshot) to sounds.
import type { SimEvent } from '../sim/types';
import type { SnapEntity } from '../sim/snapshot';
import { Kind, isMinion } from '../sim/types';
import type { ClientState } from '../game/state';
import { championData } from '../sim/champions';
import { play, playCast } from './sfx';

/** Auto attack leaving the wind-up (projectile launch / melee strike): champions full, minions soft. */
export function soundForFire(e: SnapEntity): void {
  if (e.kind === Kind.Champion) play(e.radius >= 60 ? 'autoHeavy' : 'auto', e.x, e.y);
  else if (isMinion(e.kind)) play('minionAuto', e.x, e.y);
}

export function soundForEvent(ev: SimEvent, state: ClientState): void {
  const me = state.me();
  const at = (eid: number): [number, number] | [] => {
    const e = state.byId.get(eid);
    return e ? [e.x, e.y] : [];
  };
  switch (ev.e) {
    case 'cast': {
      const e = state.byId.get(ev.src);
      if (!e?.champ) return;
      const a = championData(e.champ).abilities[ev.slot];
      if (a) playCast(a.id, a.type, e.x, e.y, ev.slot === 3);
      return;
    }
    case 'attack': {
      // only towers here (no wind-up); champions and minions sound when the shot leaves (soundForFire)
      const e = state.byId.get(ev.src);
      if (e && (e.kind === Kind.Tower || e.kind === Kind.Nexus)) play('tower', e.x, e.y);
      return;
    }
    case 'damage': {
      // impact of an auto attack on you or by you (LoL: hit sound at the target)
      if (!ev.auto || !me || (ev.src !== me.id && ev.dst !== me.id)) return;
      play('hit', ...(at(ev.dst) as [number, number]));
      return;
    }
    case 'death':
      if (me && ev.killer === me.id && isMinion(ev.kind)) play('lastHit');
      else if (ev.kind === Kind.Champion) play('champDeath', ev.x, ev.y);
      else play('death', ev.x, ev.y);
      return;
    case 'gold':
      if (me && ev.eid === me.id && ev.amount >= 100) play('gold');
      return;
    case 'level':
      if (me && ev.eid === me.id) play('levelUp');
      return;
    case 'plate':
      play('plate', ...(at(ev.tower) as [number, number]));
      return;
    case 'ping':
      play('ping'); // team pings are always audible
      return;
    case 'wave':
      if (me && ev.team === me.team && ev.lane === 1) play('wave'); // once per wave (mid lane event)
      return;
    default:
      return;
  }
}
