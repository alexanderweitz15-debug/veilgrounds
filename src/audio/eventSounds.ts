// Maps sim events (already fog-filtered by the snapshot) to sounds.
import type { SimEvent } from '../sim/types';
import type { SnapEntity } from '../sim/snapshot';
import { Kind, isMinion } from '../sim/types';
import type { ClientState } from '../game/state';
import { championData } from '../sim/champions';
import { abilityForSlot } from '../data/champions';
import { play, playCast, playFizzle, Rel, type PlayOpts } from './sfx';

// Reused option objects (no allocation per event). Only champions carry a relation; minions and towers stay neutral.
const optsScratch: PlayOpts = { rel: Rel.Neutral, src: 0 };

function champOpts(e: SnapEntity, me: SnapEntity | undefined): PlayOpts {
  optsScratch.src = e.id;
  optsScratch.rel = !me ? Rel.Neutral : e.id === me.id ? Rel.Own : e.team === me.team ? Rel.Ally : Rel.Enemy;
  return optsScratch;
}

function srcOpts(e: SnapEntity): PlayOpts {
  optsScratch.src = e.id;
  optsScratch.rel = Rel.Neutral;
  return optsScratch;
}

/** Auto attack leaving the wind-up (projectile launch / melee strike): champions full, minions soft. */
export function soundForFire(e: SnapEntity, state?: ClientState): void {
  if (e.kind === Kind.Champion) play(e.radius >= 60 ? 'autoHeavy' : 'auto', e.x, e.y, champOpts(e, state?.me()));
  else if (isMinion(e.kind)) play('minionAuto', e.x, e.y, srcOpts(e));
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
      const a = abilityForSlot(e.champ, ev.slot, e.ult ?? -1) ?? championData(e.champ).abilities[ev.slot];
      // a recast of a fake-cancel ability (hook *_fake_cancel) is the cancel: fizzle, not a second cast cue
      if (a && ev.recast && a.effects.some((x) => x.kind === 'hook' && x.id.endsWith('_fake_cancel'))) playFizzle(e.x, e.y, champOpts(e, me));
      else if (a) playCast(a.id, a.type, e.x, e.y, ev.slot === 3, champOpts(e, me));
      return;
    }
    case 'attack': {
      // only towers here (no wind-up); champions and minions sound when the shot leaves (soundForFire)
      const e = state.byId.get(ev.src);
      if (e && (e.kind === Kind.Tower || e.kind === Kind.Nexus)) play('tower', e.x, e.y, srcOpts(e));
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
      else if (ev.kind === Kind.Champion) {
        optsScratch.src = ev.eid;
        optsScratch.rel = !me ? Rel.Neutral : ev.eid === me.id ? Rel.Own : ev.team === me.team ? Rel.Ally : Rel.Enemy;
        play('champDeath', ev.x, ev.y, optsScratch);
      }
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
