// Per-bot perception (spec-bots §3): turns the team's fog-filtered snapshot into what THIS bot knows.
//  - near range 1400: team-visible enemies, each noticed after a sampled reaction delay
//  - outside: only at minimap glances (profile interval) + forced glances (own ping, ally ping from Silver,
//    kill feed, objective spawn from Gold, own recall always)
//  - audio cues: unseen enemy casts within 1800 (Snapshot.audio, blurred); used for prediction from Platinum
//  - EnemyTrack per enemy with clouds, known cooldowns (seen/heard casts, Flash from blink jumps), GankRisk,
//    ThreatMap, wave states, predictive dodge inputs, enemy style observations.
// Input: Snapshot + static lobby/map data + BotParams + the bot's own Rng. Never the Sim.

import type { BotParams } from '../contract';
import type { Rng } from '../../sim/rng';
import type { LaneName, Pt } from '../../sim/map';
import { Kind } from '../../sim/types';
import type { SnapEntity, Snapshot } from '../../sim/snapshot';
import type { AbilityData, ChampionData } from '../../sim/champions/schema';
import { CHAMPION_DATA } from '../../sim/champions';
import type { BotMemory, BotStatic } from '../bot/types';
import { sampleReactionMs } from '../profiles';
import { dst } from '../bot/geo';
import { atLeast, bySkill, cdTracking, junglerInputs } from './rankModel';
import { cloudOf, type Cloud, type CloudEnv } from './clouds';
import { gankRisk, junglerPrior, riskSource, type JunglerEstimate } from './gankRisk';
import { threatFn } from './threat';
import { lanePos, waveStates } from './waves';
import { newStyleObs, noteDamage } from './enemyStyle';
import { maybeInject, rollErrorUntil } from '../errors';
import { reactionPenaltyMs } from '../humanize/attention';
import type { AudioCue, BotPerception, IncomingCast, PerceptionState, PingMem, TrackMem } from './types';

export const NEAR_RANGE = 1400;
export const FLASH_CD_S = 300;
/** Blink detection margin beyond walking distance between two samples. */
const BLINK_MARGIN = 250;
/** Enemy walking speed estimate factor on base MS (boots/items). */
const MS_FACTOR = 1.15;

const CC_EFFECTS = new Set(['stun', 'root', 'airborne', 'pull', 'knockback', 'silence', 'stasis']);
const CC_HOOK = /drag|pull|stun|root|tether|knock|airborne|charm|fear|taunt|suppress/;

/** Ability applies hard CC (data effects, or a hook whose id says so). */
export function isCC(a: AbilityData | undefined): boolean {
  if (!a) return false;
  return a.effects.some((e) => CC_EFFECTS.has(e.kind) || (e.kind === 'hook' && CC_HOOK.test(e.id)));
}

const ranked = (v: number | number[], rank: number): number => (typeof v === 'number' ? v : v[Math.max(0, Math.min(v.length - 1, rank - 1))]!);

/** Estimated ability rank of an enemy at a level (bots cannot see enemy skill points). */
export const estRank = (slot: number, level: number): number => (slot === 3 ? (level >= 16 ? 3 : level >= 11 ? 2 : 1) : Math.min(5, Math.max(1, Math.ceil(level / 3))));

/** "Main" ability for cooldown tracking (§3): first basic ability with CC or mobility, else Q. */
export function mainAbility(c: ChampionData): number {
  for (let i = 0; i < 3; i++) {
    const a = c.abilities[i]!;
    if (isCC(a) || a.type === 'dash' || a.type === 'blink') return i;
  }
  return 0;
}

export const isHookChamp = (c: ChampionData | undefined): boolean => !!c && /hook|harpoon/.test(c.archetype);

const champOf = (id: string): ChampionData | undefined => (CHAMPION_DATA as Record<string, ChampionData>)[id];

function newTrack(slot: number, champ: string, role: string, abilities: number): TrackMem {
  return {
    slot,
    champ,
    role,
    visibleNow: false,
    lastX: 0,
    lastY: 0,
    lastTick: -1,
    dirX: 0,
    dirY: 0,
    level: 1,
    hpFrac: 1,
    cloud: null,
    cds: {},
    eid: -1,
    noticedFrom: -1,
    prev: null,
    known: false,
    anchor: null,
    abilityReadyAt: new Array(abilities).fill(0),
    casts: [],
    dead: false,
    cs: 0,
    csAtLastSeen: 0,
    usableFrom: 0,
    missingPingTick: -1,
    flashes: 0,
  };
}

const LANE_ROLE: Record<LaneName, string[]> = { top: ['top'], mid: ['mid'], bot: ['adc', 'support'] };

export function perceive(st: PerceptionState, snap: Snapshot, bot: BotStatic, params: BotParams, rng: Rng, mem?: BotMemory): BotPerception {
  const tick = snap.tick;
  const map = bot.map;
  const team = bot.team as 0 | 1;
  const enemyTeam = (1 - team) as 0 | 1;
  const b = params.behavior;
  const me = snap.me;
  const self = me && !me.dead ? snap.entities.find((e) => e.id === me.eid) ?? null : null;
  const inputs = junglerInputs(params);
  const cdt = cdTracking(params);

  // ---------------------------------------------------------------- init (lobby knowledge)
  if (!st.initialized) {
    st.initialized = true;
    for (const p of bot.players) {
      if (p.team === team) continue;
      const c = champOf(p.champion);
      st.tracks.set(p.slot, newTrack(p.slot, p.champion, p.role, c?.abilities.length ?? 4));
      st.styleObs.set(p.slot, newStyleObs(tick));
    }
    st.nextGlance = tick + rng.int(Math.max(1, Math.round(b.minimapIntervalS * 30)));
    st.lastTick = tick;
  }
  const hasFlash = (slot: number): boolean => !!bot.players.find((p) => p.slot === slot)?.summoners.includes('sprung');
  const junglerSlot = bot.players.find((p) => p.team !== team && p.role === 'jungle')?.slot ?? -1;

  for (const e of snap.entities) if (e.kind === Kind.Champion) st.eidToSlot.set(e.id, e.slot);
  for (const row of snap.players) {
    const t = st.tracks.get(row.slot);
    if (!t) continue;
    t.dead = row.dead;
    t.cs = row.cs;
    t.level = row.level; // scoreboard level is public
  }

  const events = snap.events;
  const evTick = (i: number): number => snap.eventTicks?.[i] ?? tick;

  // ---------------------------------------------------------------- minimap glance (periodic + forced)
  const reasons: string[] = [];
  if (tick >= st.nextGlance) reasons.push('interval');
  const newPings: PingMem[] = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!;
    if (ev.e === 'ping' && ev.team === team) {
      const pm: PingMem = { slot: ev.slot, kind: ev.kind, x: ev.x, y: ev.y, tick: evTick(i), target: ev.target };
      newPings.push(pm);
      if (ev.slot === bot.slot) reasons.push('ownPing');
      else if (atLeast(params, 'silver')) reasons.push('allyPing');
    } else if (ev.e === 'death' && ev.kind === Kind.Champion) reasons.push('killFeed');
    else if (ev.e === 'death' && ev.kind === Kind.Monster) {
      const o = nearestObjective(map, ev);
      if (o) st.objectiveDeaths.set(o, evTick(i));
    }
  }
  if (atLeast(params, 'gold')) {
    for (const [name, first, respawn] of OBJECTIVES) {
      const dead = st.objectiveDeaths.get(name);
      const spawn = (dead === undefined ? first : dead / 30 + respawn) * 30;
      if (spawn > st.lastTick && spawn <= tick) reasons.push('objectiveSpawn');
    }
  }
  const recalling = !!me && me.recallLeft > 0;
  if (recalling && !st.wasRecalling) reasons.push('recall');
  st.wasRecalling = recalling;
  const glance = reasons.length > 0;
  if (glance) {
    st.lastGlance = tick;
    st.nextGlance = tick + Math.max(1, Math.round(b.minimapIntervalS * 30));
    st.glanceReason = reasons.join('+');
  }
  st.pings.push(...newPings);
  while (st.pings.length && tick - st.pings[0]!.tick > 30 * 30) st.pings.shift();

  // ---------------------------------------------------------------- enemy champions: notice + update tracks
  const castSlotsSince = new Map<number, Set<number>>(); // slot -> ability slots cast in this batch
  for (const ev of events) {
    if (ev.e !== 'cast') continue;
    const s = st.eidToSlot.get(ev.src);
    if (s === undefined || !st.tracks.has(s)) continue;
    let set = castSlotsSince.get(s);
    if (!set) castSlotsSince.set(s, (set = new Set()));
    set.add(ev.slot);
  }
  const allies = snap.entities.filter((e) => e.kind === Kind.Champion && e.team === team && e.alive && e.id !== me?.eid);
  const visibleEnemies: SnapEntity[] = [];
  const present = new Set<number>();
  for (const e of snap.entities) {
    if (e.kind !== Kind.Champion || e.team === team || !e.alive) continue;
    const t = st.tracks.get(e.slot);
    if (!t) continue;
    present.add(e.slot);
    t.eid = e.id;
    const near = !!self && dst(self, e) <= NEAR_RANGE;
    let perceived: boolean;
    if (near) {
      // §9: +150 ms while distracted (mem only with the runner's new brain hooks; 0 without the attention model)
      if (t.noticedFrom < 0) t.noticedFrom = tick + Math.round(((sampleReactionMs(b, rng) + (mem ? reactionPenaltyMs(mem, tick) : 0)) * 30) / 1000);
      perceived = tick >= t.noticedFrom;
    } else {
      t.noticedFrom = -1;
      perceived = glance; // far: only what the last minimap glance showed
    }
    if (!perceived) {
      t.visibleNow = false;
      continue;
    }
    // a new sighting episode (Silver's 8-15 s delay restarts) only after a gap longer than one glance interval
    // (min 5 s): re-glances at a far enemy or weaving in and out of near range continue the same episode
    const newEpisode = t.lastTick < 0 || tick - t.lastTick > Math.max(150, b.minimapIntervalS * 30 + 30);
    updateTrack(t, e, tick, st, params, rng, hasFlash(e.slot), castSlotsSince.get(e.slot), allies, self, mem ? { mem, bot } : undefined);
    if (newEpisode) {
      const [lo, hi] = inputs.sightDelayS;
      t.usableFrom = hi > 0 ? tick + Math.round((lo + (hi - lo) * rng.next()) * 30) : tick;
    }
    t.visibleNow = true;
    visibleEnemies.push(e);
  }
  for (const t of st.tracks.values()) {
    if (!present.has(t.slot)) {
      t.noticedFrom = -1;
      t.visibleNow = false;
    }
  }

  // ---------------------------------------------------------------- events: casts, damage, deaths, pings
  const incoming: IncomingCast[] = [];
  const selfVel = self && st.selfPrev && tick > st.selfPrev.tick ? { x: ((self.x - st.selfPrev.x) * 30) / (tick - st.selfPrev.tick), y: ((self.y - st.selfPrev.y) * 30) / (tick - st.selfPrev.tick) } : { x: 0, y: 0 };
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!;
    const at = evTick(i);
    if (ev.e === 'cast') {
      const s = st.eidToSlot.get(ev.src);
      const t = s === undefined ? undefined : st.tracks.get(s);
      if (!t || !self) continue;
      const c = champOf(t.champ);
      const casterPos: Pt = t.prev && t.lastTick >= at - 15 ? { x: t.lastX, y: t.lastY } : (snap.entities.find((x) => x.id === ev.src) ?? { x: t.lastX, y: t.lastY });
      // a cast is "seen" by this bot only in its near range (cooldowns: seen or heard, §3)
      if (dst(casterPos, self) > NEAR_RANGE) continue;
      noteCast(t, ev.slot, at, ev.x, ev.y, c, cdt, self, selfVel);
      const a = c?.abilities[ev.slot];
      if (a && !ev.recast) {
        const inc = incomingOf(t.slot, ev.slot, a, casterPos, ev.x, ev.y, at, self, t.level);
        if (inc) incoming.push(inc);
      }
    } else if (ev.e === 'damage' || ev.e === 'attack') {
      const ss = st.eidToSlot.get(ev.src);
      const ds = st.eidToSlot.get(ev.dst);
      if (ev.e === 'damage' && me && ev.dst === me.eid) st.dmgTaken.push({ tick: at, amount: ev.amount });
      const enemySrc = ss !== undefined && st.tracks.has(ss);
      const enemyDst = ds !== undefined && st.tracks.has(ds);
      if (ev.e === 'damage' && (enemySrc ? ds !== undefined && !enemyDst : enemyDst && ss !== undefined)) {
        const o = st.styleObs.get(enemySrc ? ss! : ds!);
        if (o) noteDamage(o, at, enemySrc);
      }
      if (ev.e === 'attack' && enemySrc && ds !== undefined) {
        const o = st.styleObs.get(ss!);
        if (o) {
          if (o.lastAutoTick >= 0 && at - o.lastAutoTick < 90 && o.movedSinceAuto) o.orbwalks++;
          o.autos++;
          o.lastAutoTick = at;
          o.movedSinceAuto = false;
        }
      }
    } else if (ev.e === 'death' && ev.kind === Kind.Monster) {
      const camp = nearestCamp(map, ev);
      if (camp) st.campKilled.set(camp, at);
    } else if (ev.e === 'ping' && ev.team === team && ev.kind === 'missing' && ev.slot !== bot.slot) {
      // spec §9 / §5.2: missing ping -> "unknown, direction from ping"; Iron ignores 60 %, Gold 40 %, Platinum+ never
      if (rng.chance(bySkill(params, [[5, 0.6], [45, 0.4], [57, 0]]))) continue;
      const t = missingTarget(st, ev);
      if (t && !t.visibleNow) {
        t.missingPingTick = at;
        if (!t.anchor || t.anchor.tick < at) t.anchor = { x: ev.x, y: ev.y, tick: at, src: 'ping' };
      }
    }
  }
  while (st.dmgTaken.length && tick - st.dmgTaken[0]!.tick > 30) st.dmgTaken.shift();

  // audio cues (all ranks hear them; Platinum+ use them to correct tracks)
  const audio: AudioCue[] = (snap.audio ?? []).map((a) => ({ ...a }));
  for (const a of audio) {
    const t = st.tracks.get(a.slot);
    if (!t) continue;
    if (cdt.main || cdt.ult || cdt.all) noteCooldown(t, a.abilitySlot, a.tick, champOf(t.champ), cdt);
    if (atLeast(params, 'platinum') && !t.visibleNow && (!t.anchor || t.anchor.tick < a.tick)) t.anchor = { x: a.x, y: a.y, tick: a.tick, src: 'audio' };
  }

  // ---------------------------------------------------------------- bushes, wards, style observations
  const ownWards = snap.entities.filter((e) => e.kind === Kind.Ward && e.team === team && e.alive && (e.vision ?? 0) > 0);
  map.bushes.forEach((bu, i) => {
    if ([...allies, ...(self ? [self] : []), ...ownWards].some((u) => dst(u, bu) < bu.r + 100)) st.bushClear.set(i, tick);
  });
  for (const e of snap.entities) {
    if (e.kind !== Kind.Ward || e.team === team || st.wardsSeen.has(e.id)) continue;
    st.wardsSeen.add(e.id);
    let best: SnapEntity | null = null;
    for (const v of visibleEnemies) if (dst(v, e) < 1500 && (!best || dst(v, e) < dst(best, e))) best = v;
    if (best) st.styleObs.get(best.slot)!.wards++;
  }
  if (tick < 14 * 60 * 30) {
    for (const v of visibleEnemies) {
      const t = st.tracks.get(v.slot)!;
      const lane = (Object.keys(LANE_ROLE) as LaneName[]).find((l) => LANE_ROLE[l].includes(t.role));
      const o = st.styleObs.get(v.slot)!;
      if (v.moving && v.atkPhase === 0) o.movedSinceAuto = true;
      if (!lane || tick < 90 * 30) continue;
      if (lanePos(map, enemyTeam, lane, v).off > 1600 && tick - ((o as { lastRoam?: number }).lastRoam ?? -1e9) > 600) {
        o.roams++;
        (o as { lastRoam?: number }).lastRoam = tick;
      }
    }
  }

  // ---------------------------------------------------------------- leash read (GM/Challenger)
  if (inputs.leash && !st.junglerStart && tick < 110 * 30) {
    const t = st.tracks.get(junglerSlot);
    if (t?.visibleNow) {
      const buffs = map.sides[enemyTeam].camps.filter((c) => c.buff);
      const near = buffs.find((c) => dst(c, { x: t.lastX, y: t.lastY }) < 1500);
      if (near) st.junglerStart = dst(near, map.sides[enemyTeam].lanes.top[2]!) < dst(near, map.sides[enemyTeam].lanes.bot[2]!) ? 'top' : 'bot';
    }
  }

  // ---------------------------------------------------------------- clouds, waves, gank risk, threat
  const msOf = (t: TrackMem): number => (champOf(t.champ)?.base.ms ?? 340) * MS_FACTOR;
  const clouds = new Map<number, Cloud | null>();
  for (const t of st.tracks.values()) {
    const env: CloudEnv = { map, enemyTeam, ms: msOf(t), campKilled: st.campKilled };
    // seen but not yet noticed (reaction delay): the bot still believes its previous estimate, not "nothing"
    t.cloud = cloudOf(t.visibleNow && tick < t.usableFrom ? { ...t, visibleNow: false } : t, tick, params, env);
    clouds.set(t.slot, t.cloud);
  }
  const waves = waveStates(map, snap, team);
  const lanerOf = (lane: LaneName): { x: number; y: number; hpFrac: number; flashUp: boolean } | null => {
    for (const role of LANE_ROLE[lane]) {
      const p = bot.players.find((q) => q.team === team && q.role === role);
      if (!p) continue;
      const e = p.slot === bot.slot ? self : allies.find((a) => a.slot === p.slot);
      if (!e) continue;
      const flashUp = p.slot === bot.slot ? !!me?.abilities.slice(4).some((a) => a.id === 'sprung' && a.cdLeft <= 0) : true; // ponytail: allies' summoner CDs are not in the snapshot
      return { x: e.x, y: e.y, hpFrac: e.maxHp > 0 ? e.hp / e.maxHp : 1, flashUp };
    }
    return null;
  };
  const laners = { top: lanerOf('top'), mid: lanerOf('mid'), bot: lanerOf('bot') };
  const jt = st.tracks.get(junglerSlot);
  const prior = inputs.timers ? junglerPrior(map, enemyTeam, tick / 30, st.junglerStart) : null;
  const risk = gankRisk({
    map,
    team,
    tick,
    params,
    tracks: st.tracks,
    clouds,
    waves,
    laners,
    junglerSlot,
    prior,
    startKnown: st.junglerStart !== null,
    enemyMs: 340 * MS_FACTOR,
  });
  let junglerEstimate: JunglerEstimate | null = null;
  if (jt) {
    const s = riskSource(jt, clouds.get(junglerSlot) ?? null, { map, team, tick, params, tracks: st.tracks, clouds, waves, laners, junglerSlot, prior, startKnown: st.junglerStart !== null, enemyMs: msOf(jt) });
    junglerEstimate = s ? { x: s.x, y: s.y, r: s.r, weight: s.w, src: s.src, tick: s.tick } : prior;
  }
  const threat = threatFn({
    map,
    team,
    tick,
    params,
    visible: visibleEnemies.map((e) => ({ e, track: st.tracks.get(e.slot)!, champ: champOf(st.tracks.get(e.slot)!.champ) })),
    clouds: [...clouds.values()].filter((c): c is Cloud => !!c),
    enemyTowers: snap.entities.filter((e) => e.kind === Kind.Tower && e.team === enemyTeam && e.alive),
    bushClear: st.bushClear,
  });

  // ---------------------------------------------------------------- hook pattern (Platinum+, §3 "Vorhersage")
  const hookPattern = new Map<number, 'position' | 'lead' | 'mixed'>();
  if (atLeast(params, 'platinum')) {
    for (const t of st.tracks.values()) {
      const c = champOf(t.champ);
      if (!isHookChamp(c)) continue;
      const hooks = t.casts.filter((k) => k.slot === 0).slice(-3);
      if (hooks.length < 3) continue;
      const kinds = hooks.map((k) => classifyAim(k, c!.abilities[0]!));
      hookPattern.set(t.slot, kinds.every((k) => k === kinds[0]) ? kinds[0]! : 'mixed');
    }
  }

  const burst = st.dmgTaken.reduce((a, d) => a + d.amount, 0);
  const view: BotPerception = {
    tick,
    time: snap.time,
    enemies: st.tracks,
    gankRisk: risk,
    threat,
    audio,
    snap,
    self,
    visibleEnemies,
    allies,
    waves,
    glanced: glance ? st.glanceReason : null,
    newPings,
    incoming,
    hookPattern,
    burst1s: self && self.maxHp > 0 ? burst / self.maxHp : 0,
    ageMs: Math.round(((tick - st.lastGlance) * 1000) / 30),
    mem: st,
    junglerEstimate,
  };
  if (self) st.selfPrev = { x: self.x, y: self.y, tick };
  st.lastTick = tick;
  return view;
}

// ------------------------------------------------------------------ helpers

const OBJECTIVES: [string, number, number][] = [
  ['leviathan', 300, 300],
  ['schleierwaechter', 1200, 360],
];

function nearestObjective(map: BotStatic['map'], p: Pt): string | null {
  const o = map.objectives;
  if (dst(o.leviathan, p) < 800) return 'leviathan';
  if (dst(o.schleierwaechter, p) < 800) return 'schleierwaechter';
  return null;
}

function nearestCamp(map: BotStatic['map'], p: Pt): string | null {
  for (const side of [0, 1] as const) for (const c of map.sides[side].camps) if (dst(c, p) < 700) return `${side}:${c.id}`;
  return null;
}

function missingTarget(st: PerceptionState, ev: { x: number; y: number; target: number }): TrackMem | null {
  if (ev.target >= 0) {
    const s = st.eidToSlot.get(ev.target);
    if (s !== undefined && st.tracks.has(s)) return st.tracks.get(s)!;
  }
  let best: TrackMem | null = null;
  let bd = 3000;
  for (const t of st.tracks.values()) {
    if (!t.known || t.visibleNow || t.dead) continue;
    const d = Math.hypot(t.lastX - ev.x, t.lastY - ev.y);
    if (d < bd) (bd = d), (best = t);
  }
  return best;
}

function updateTrack(t: TrackMem, e: SnapEntity, tick: number, st: PerceptionState, params: BotParams, rng: Rng, flash: boolean, castSlots: Set<number> | undefined, allies: SnapEntity[], self: SnapEntity | null, hk?: { mem: BotMemory; bot: BotStatic }): void {
  const c = champOf(t.champ);
  const ms = (c?.base.ms ?? 340) * MS_FACTOR;
  // blink detection: a jump longer than walking allows, without a cast of a dash/blink ability in between
  // ponytail: a long knockback by our own team can read as a Flash; rare, accepted
  const dashCast = !!castSlots && [...castSlots].some((s) => {
    const ty = c?.abilities[s]?.type;
    return ty === 'dash' || ty === 'blink';
  });
  const jumpPrev = t.prev && t.visibleNow ? dst(t.prev, e) > (ms * (tick - t.prev.tick)) / 30 + BLINK_MARGIN : false;
  const jumpTick = Math.hypot(e.x - e.px, e.y - e.py) > BLINK_MARGIN + 50;
  if (flash && !dashCast && (jumpPrev || jumpTick) && !(t.cds.flashReadyAt !== undefined && t.cds.flashReadyAt > tick)) {
    const from = jumpTick ? { x: e.px, y: e.py } : t.prev!;
    const o = st.styleObs.get(t.slot);
    t.flashes++;
    if (o) {
      o.flashes++;
      const target = [...allies, ...(self ? [self] : [])].sort((a, b) => dst(a, from) - dst(b, from))[0];
      if (target && dst(target, e) < dst(target, from)) o.flashOffensive++;
    }
    // no_flash_tracking: up to Emerald half of the seen Flashes are forgotten (K's error table)
    // (§9 new brain: the forgotten Flash is an error episode, errors.json durS; one draw either way)
    if (cdTracking(params).flash) {
      const forgot = hk ? rollErrorUntil(hk.mem, hk.bot, params, 'no_flash_tracking', tick, rng) >= 0 : !!maybeInject(params, 'no_flash_tracking', rng);
      if (!forgot) t.cds.flashReadyAt = tick + FLASH_CD_S * 30;
    }
  }
  if (t.prev && t.visibleNow) {
    const mx = e.x - t.prev.x;
    const my = e.y - t.prev.y;
    const l = Math.hypot(mx, my);
    if (l > 20) (t.dirX = mx / l), (t.dirY = my / l);
    else if (e.moving) (t.dirX = e.fx), (t.dirY = e.fy);
  } else (t.dirX = e.moving ? e.fx : 0), (t.dirY = e.moving ? e.fy : 0);
  t.lastX = e.x;
  t.lastY = e.y;
  t.lastTick = tick;
  t.level = e.level;
  t.hpFrac = e.maxHp > 0 ? e.hp / e.maxHp : 1;
  t.known = true;
  t.anchor = { x: e.x, y: e.y, tick, src: 'seen' };
  t.csAtLastSeen = t.cs;
  t.prev = { x: e.x, y: e.y, tick };
}

function noteCooldown(t: TrackMem, slot: number, at: number, c: ChampionData | undefined, cdt: ReturnType<typeof cdTracking>): void {
  const a = c?.abilities[slot];
  if (!a || !c) return;
  const ready = at + Math.round(ranked(a.cooldown, estRank(slot, t.level)) * 30);
  if (cdt.all) t.abilityReadyAt[slot] = ready;
  if (slot === 3 && cdt.ult) t.cds.ultReadyAt = ready;
  if (slot === mainAbility(c) && cdt.main) t.cds.mainReadyAt = ready;
}

function noteCast(t: TrackMem, slot: number, at: number, tx: number, ty: number, c: ChampionData | undefined, cdt: ReturnType<typeof cdTracking>, self: SnapEntity, vel: Pt): void {
  noteCooldown(t, slot, at, c, cdt);
  t.casts.push({ tick: at, slot, tx, ty, myX: self.x, myY: self.y, myVx: vel.x, myVy: vel.y });
  if (t.casts.length > 6) t.casts.shift();
}

/** Did the cast aim at the bot's position at cast time ('position') or ahead of its movement ('lead')? */
function classifyAim(k: TrackMem['casts'][number], a: AbilityData): 'position' | 'lead' {
  const speed = a.speed ?? 1500;
  const flight = a.castTime + Math.hypot(k.tx - k.myX, k.ty - k.myY) / speed;
  const px = k.myX + k.myVx * flight;
  const py = k.myY + k.myVy * flight;
  return Math.hypot(k.tx - k.myX, k.ty - k.myY) <= Math.hypot(k.tx - px, k.ty - py) ? 'position' : 'lead';
}

/** Predicted effect of an enemy cast on the bot (cast wind-up + facing/aim + distance). */
function incomingOf(slot: number, abilitySlot: number, a: AbilityData, o: Pt, cx: number, cy: number, at: number, self: SnapEntity, level: number): IncomingCast | null {
  const rank = estRank(abilitySlot, level);
  const range = ranked(a.range, rank);
  const l = Math.hypot(cx - o.x, cy - o.y);
  const dx = l > 0 ? (cx - o.x) / l : 0;
  const dy = l > 0 ? (cy - o.y) / l : 0;
  const rx = self.x - o.x;
  const ry = self.y - o.y;
  const along = rx * dx + ry * dy;
  let onMe = false;
  let width = 0;
  if (a.type === 'skillshot_line') {
    width = a.width ?? 70;
    onMe = along >= 0 && along <= range + self.radius && Math.abs(rx * dy - ry * dx) <= width / 2 + self.radius + 30;
  } else if (a.type === 'skillshot_circle' || a.type === 'zone') {
    width = (a.radius ?? 200) * 2;
    onMe = Math.hypot(self.x - cx, self.y - cy) <= (a.radius ?? 200) + self.radius;
  } else if (a.type === 'targeted' || a.type === 'cone') {
    width = a.type === 'cone' ? range : 0;
    onMe = Math.hypot(self.x - cx, self.y - cy) < 200 || (a.type === 'cone' && along >= 0 && along <= range);
  } else if (a.type === 'self') {
    width = (a.radius ?? 0) * 2;
    onMe = !!a.radius && Math.hypot(rx, ry) <= a.radius + self.radius;
  } else if (a.type === 'dash') {
    width = 150;
    onMe = along >= 0 && along <= range + 150 && Math.abs(rx * dy - ry * dx) <= 150;
  }
  if (!onMe && Math.hypot(rx, ry) > range + 400) return null;
  const flight = a.speed && a.type === 'skillshot_line' ? Math.max(0, along) / a.speed : 0;
  return { slot, abilitySlot, tick: at, ox: o.x, oy: o.y, dx, dy, range, width, hitTick: at + Math.round((a.castTime + (a.delay ?? 0) + flight) * 30), cc: isCC(a), onMe };
}
