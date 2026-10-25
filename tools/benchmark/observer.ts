// Per-game benchmark observer. Purely observational: it reads the Sim (components, events, projectile payloads) and the
// bot commands after each step and never writes to either, so the match is bit-identical with or without it
// (tests/benchmarkObserver.test.ts compares stateHash). Plug it into runBotGame's onTick.
//
// Everything is accumulated per team as ratio pairs [num, den] and sample lists (see metrics.ts for the definitions).

import { query } from 'bitecs';
import type { Sim } from '../../src/sim/sim';
import { DT, Kind, VARIANTS, isMinion, type Command, type SimConfig, type TickInput } from '../../src/sim/types';
import { sees } from '../../src/sim/vision';
import { isBusy } from '../../src/sim/systems/abilities';
import { isLanerRole } from './metrics';
import { closest } from './geometry';

export interface TeamRaw {
  ratio: Record<string, [number, number]>;
  samples: Record<string, number[]>;
}
export interface ObserverResult {
  teams: [TeamRaw, TeamRaw];
  /** Team that destroyed the first tower (undefined: no tower fell) and the minute. */
  firstTower?: { team: number; min: number };
  /** Plates taken before 14:00 per team. */
  plates: [number, number];
}

const TICKS_MIN = 1800;
const UTIL_FROM = 120 * 30;
const UTIL_TO = 14 * TICKS_MIN;
const IDLE_FROM = 105 * 30;
const IDLE_ORDER_TICKS = 45;
const NV_WINDOW = 150; // 5 s
const NV_GUARD = 30; // the last 1 s before the death is ignored
const REACT_WINDOW = 60; // 2 s
const LANE_BY_ROLE: Record<string, number> = { top: 0, mid: 1, adc: 2, support: 2 };
const LANE_NAMES = ['top', 'mid', 'bot'] as const;
const ORDER_CMDS = new Set(['move', 'attack', 'attackMove', 'stop', 'cast', 'spell', 'item', 'recall', 'ward']);
const SKILL_CMDS = new Set(['cast', 'spell', 'item']);

interface LastOrder {
  t: string;
  x: number;
  y: number;
  target: number;
}
interface Stim {
  kind: 'rtDodge' | 'rtVision' | 'rtAmbush';
  t0: number;
}
interface Threat {
  slot: number;
  tStar: number;
  dist: number;
  seen: boolean;
}
interface Shot {
  team: number;
  slot: number;
  spawn: number;
  speed: number;
  aimed: boolean;
  threats: Threat[];
  hitSlots: Set<number>;
  lastTravelled: number;
  payload: { hit: number[] };
  lastSeenTick: number;
}
interface Exchange {
  x: number;
  y: number;
  last: number;
  d: [number, number];
}
interface RecallEp {
  start: number;
  gold: number;
  spentBefore: number;
  hp: number;
  wave: 'crashed' | 'bad' | 'neutral';
  lane: boolean;
  done: boolean;
  doneAt: number;
}
interface Champ {
  slot: number;
  team: number;
  role: string;
  eid: number;
  bot: boolean;
  lane: number;
  recalling: boolean;
  recall?: RecallEp;
  lastOrderTick: number;
  lastOrder?: LastOrder;
  lastChampDmgTaken: number;
  lastSkillCmd: number;
  pend: Stim[];
  idleSince: number;
  maxIdle: number;
}

export interface Observer {
  onTick(sim: Sim, inputs: TickInput[]): void;
  finish(sim: Sim): ObserverResult;
}

const hypot = Math.hypot;

export function createObserver(config: SimConfig): Observer {
  const res: ObserverResult = {
    teams: [
      { ratio: {}, samples: {} },
      { ratio: {}, samples: {} },
    ],
    plates: [0, 0],
  };
  let champs: Champ[] = [];
  let bySlot = new Map<number, Champ>();
  let inited = false;
  /** seen[team][enemySlot] ring of 256 ticks: did `team` see that champion at tick (index = tick & 255). */
  const seenHist: Uint8Array[][] = [[], []];
  const lastSeen: number[][] = [[], []]; // team -> slot -> last tick seen
  const shots = new Map<number, Shot>();
  const exchanges: Exchange[] = [];
  let lastExchangeSweep = 0;

  const add = (team: number, id: string, n: number, d = 0): void => {
    const r = res.teams[team]!.ratio;
    const c = (r[id] ??= [0, 0]);
    c[0] += n;
    c[1] += d;
  };
  const addRole = (team: number, id: string, role: string, n: number, d = 0): void => {
    add(team, id, n, d);
    add(team, `${id}.${role}`, n, d);
  };
  const sample = (team: number, id: string, role: string, v: number): void => {
    const s = res.teams[team]!.samples;
    (s[id] ??= []).push(v);
    (s[`${id}.${role}`] ??= []).push(v);
  };

  function init(sim: Sim): void {
    const { Unit } = sim.c;
    champs = config.players
      .filter((p) => !!p.bot)
      .map((p) => ({
        slot: p.slot,
        team: p.team,
        role: p.role,
        eid: sim.slots[p.slot]!,
        bot: true,
        lane: LANE_BY_ROLE[p.role] ?? -1,
        recalling: false,
        lastOrderTick: -1e9,
        lastChampDmgTaken: -1e9,
        lastSkillCmd: -1e9,
        pend: [],
        idleSince: -1,
        maxIdle: 0,
      }));
    bySlot = new Map(champs.map((c) => [c.slot, c]));
    for (const t of [0, 1]) {
      for (const c of champs) {
        seenHist[t]![c.slot] = new Uint8Array(256);
        lastSeen[t]![c.slot] = -1e9;
      }
    }
    void Unit;
    inited = true;
  }

  const slotOf = (sim: Sim, eid: number): number => (eid >= 0 && sim.c.Unit.kind[eid] === Kind.Champion ? sim.c.Unit.slot[eid]! : -1);

  // ------------------------------------------------------------------ commands and reaction times
  function orderChanging(c: Champ, cmd: Command, sim: Sim, forDodge: boolean): boolean {
    const last = c.lastOrder;
    switch (cmd.t) {
      case 'cast':
      case 'spell':
      case 'item':
      case 'stop':
      case 'recall':
        return true;
      case 'ward':
        return !forDodge;
      case 'attack':
        return !forDodge && !(last?.t === 'attack' && last.target === cmd.target);
      case 'move':
      case 'attackMove': {
        if (!last || (last.t !== 'move' && last.t !== 'attackMove')) return true;
        const px = sim.c.Pos.x[c.eid]!;
        const py = sim.c.Pos.y[c.eid]!;
        const off = hypot(cmd.x - last.x, cmd.y - last.y);
        if (off < 150) return false;
        const a1 = Math.atan2(cmd.y - py, cmd.x - px);
        const a0 = Math.atan2(last.y - py, last.x - px);
        let da = Math.abs(a1 - a0);
        if (da > Math.PI) da = 2 * Math.PI - da;
        return da >= (40 * Math.PI) / 180;
      }
      default:
        return false;
    }
  }

  function handleCommands(sim: Sim, inputs: TickInput[], T: number): void {
    for (const i of inputs) {
      const c = bySlot.get(i.slot);
      if (!c || !ORDER_CMDS.has(i.cmd.t)) continue;
      if (c.pend.length) {
        const keep: Stim[] = [];
        for (const s of c.pend) {
          const dodge = s.kind === 'rtDodge';
          if (T - s.t0 <= REACT_WINDOW && orderChanging(c, i.cmd, sim, dodge)) {
            const ms = ((T - s.t0) * 1000) / 30;
            sample(c.team, s.kind, c.role, ms);
            sample(c.team, 'rtAll', c.role, ms);
            addRole(c.team, 'rtNone', c.role, 0, 1);
          } else keep.push(s);
        }
        c.pend = keep;
      }
      if (SKILL_CMDS.has(i.cmd.t)) c.lastSkillCmd = T;
      c.lastOrderTick = T;
      const cmd = i.cmd;
      c.lastOrder = { t: cmd.t, x: 'x' in cmd ? (cmd.x ?? 0) : 0, y: 'y' in cmd ? (cmd.y ?? 0) : 0, target: cmd.t === 'attack' ? cmd.target : -1 };
    }
    for (const c of champs) {
      if (!c.pend.length) continue;
      c.pend = c.pend.filter((s) => {
        if (T - s.t0 <= REACT_WINDOW) return true;
        addRole(c.team, 'rtNone', c.role, 1, 1);
        return false;
      });
    }
  }

  const stim = (c: Champ, kind: Stim['kind'], T: number): void => {
    if (!c.pend.some((s) => s.kind === kind && T - s.t0 < 15)) c.pend.push({ kind, t0: T });
  };

  // ------------------------------------------------------------------ events
  function nearbyChampions(sim: Sim, x: number, y: number, r: number): number {
    const { Pos, Unit } = sim.c;
    let n = 0;
    for (const c of champs) if (Unit.alive[c.eid] && hypot(Pos.x[c.eid]! - x, Pos.y[c.eid]! - y) <= r) n++;
    return n;
  }

  function closeExchanges(T: number, all: boolean): void {
    for (let i = exchanges.length - 1; i >= 0; i--) {
      const e = exchanges[i]!;
      if (!all && T - e.last <= 120) continue;
      exchanges.splice(i, 1);
      if (e.d[0] + e.d[1] < 200 || e.d[0] === e.d[1]) continue;
      const w = e.d[0] > e.d[1] ? 0 : 1;
      add(w, 'exchWon', 1, 1);
      add(1 - w, 'exchWon', 0, 1);
    }
  }

  function handleEvents(sim: Sim, T: number): void {
    const { Unit, Pos } = sim.c;
    for (const ev of sim.events) {
      if (ev.e === 'damage') {
        const a = bySlot.get(slotOf(sim, ev.src));
        const v = bySlot.get(slotOf(sim, ev.dst));
        if (!a || !v || a.team === v.team || ev.amount <= 0) continue;
        // ambush stimulus: first champion damage after 5 s without
        if (T - v.lastChampDmgTaken > 150 && Unit.alive[v.eid]) stim(v, 'rtAmbush', T);
        v.lastChampDmgTaken = T;
        const vx = Pos.x[v.eid]!;
        const vy = Pos.y[v.eid]!;
        if (T < UTIL_TO && nearbyChampions(sim, vx, vy, 1600) <= 4) {
          add(a.team, 'tradeBal', ev.amount, ev.amount);
          add(v.team, 'tradeBal', 0, ev.amount);
          let ex = exchanges.find((e) => T - e.last <= 120 && hypot(e.x - vx, e.y - vy) < 1800);
          if (!ex) exchanges.push((ex = { x: vx, y: vy, last: T, d: [0, 0] }));
          ex.d[a.team]! += ev.amount;
          ex.last = T;
        }
      } else if (ev.e === 'death') {
        if (ev.kind === Kind.Champion) {
          const v = bySlot.get(slotOf(sim, ev.eid));
          if (!v) continue;
          const kSlot = ev.killerKind === Kind.Champion ? slotOf(sim, ev.killer) : -1;
          if (kSlot >= 0 && bySlot.get(kSlot)!.team !== v.team) {
            const hist = seenHist[v.team]![kSlot]!;
            let seen = false;
            for (let k = NV_GUARD; k <= NV_WINDOW + NV_GUARD && T - k >= 0; k++) if (hist[(T - k) & 255]) seen = true;
            add(v.team, 'deathsNoVision', seen ? 0 : 1, 1);
          }
          addRole(v.team, 'deathsPer10', v.role, 1, 0);
        } else if (ev.kind === Kind.Tower) {
          const taker = ev.team === 0 ? 1 : 0;
          if (!res.firstTower) res.firstTower = { team: taker, min: T / TICKS_MIN };
          add(taker, 'objTower', 1, 1);
          add(1 - taker, 'objTower', 0, 1);
          add(taker, 'objAll', 1, 1);
          add(1 - taker, 'objAll', 0, 1);
        } else if (ev.kind === Kind.Inhibitor) {
          const taker = ev.team === 0 ? 1 : 0;
          add(taker, 'objAll', 1, 1);
          add(1 - taker, 'objAll', 0, 1);
        } else if (ev.kind === Kind.Monster) {
          const variant = VARIANTS[Unit.variant[ev.eid]!];
          const id = variant === 'leviathan' ? 'objDrake' : variant === 'kesselbrut' ? 'objHerald' : variant === 'schleierwaechter' ? 'objBaron' : '';
          const kt = ev.killerTeam;
          if (id && (kt === 0 || kt === 1)) {
            add(kt, id, 1, 1);
            add(1 - kt, id, 0, 1);
            const w = id === 'objHerald' ? 1 / 3 : 1;
            add(kt, 'objAll', w, w);
            add(1 - kt, 'objAll', 0, w);
          }
        }
      } else if (ev.e === 'plate') {
        // a plate of team `ev.team`'s tower falls to the other team
        if (T < UTIL_TO) res.plates[ev.team === 0 ? 1 : 0]++;
      }
    }
  }

  // ------------------------------------------------------------------ projectiles (skillshots)
  function scanProjectiles(sim: Sim, T: number): void {
    const { Proj, Pos, Unit, Stats } = sim.c;
    const st = sim.state.projectiles as { payloads: Map<number, { t: string; slot: number; ret: number; hit: number[]; cx: number; cy: number }> } | undefined;
    if (!st) return;
    const live = new Set<number>();
    for (const eid of query(sim.world, [Proj])) {
      if (Proj.kind[eid] !== 1) continue;
      const pl = st.payloads.get(eid);
      if (!pl || pl.t !== 'ability' || pl.ret !== 0) continue;
      const src = Proj.src[eid]!;
      if (Unit.kind[src] !== Kind.Champion || Unit.serial[src] !== Proj.srcSerial[eid]) continue;
      const shooter = bySlot.get(Unit.slot[src]!);
      if (!shooter) continue;
      const key = Proj.payload[eid]!;
      live.add(key);
      let shot = shots.get(key);
      if (!shot) {
        const speed = Proj.speed[eid]!;
        const tmax = Proj.maxDist[eid]! / Math.max(1, speed);
        const half = Proj.width[eid]! / 2;
        const ux = Proj.dx[eid]! * speed;
        const uy = Proj.dy[eid]! * speed;
        shot = { team: shooter.team, slot: shooter.slot, spawn: T, speed, aimed: false, threats: [], hitSlots: new Set(), lastTravelled: 0, payload: pl, lastSeenTick: T };
        for (const x of champs) {
          if (x.team === shooter.team || !Unit.alive[x.eid]) continue;
          const xp = { x: Pos.x[x.eid]!, y: Pos.y[x.eid]! };
          const visibleToShooter = sees(sim, shooter.team, x.eid);
          if (visibleToShooter && hypot(pl.cx - xp.x, pl.cy - xp.y) <= 300) shot.aimed = true;
          let vx = (xp.x - Pos.px[x.eid]!) / DT;
          let vy = (xp.y - Pos.py[x.eid]!) / DT;
          if (hypot(vx, vy) > 2 * Math.max(300, Stats.ms[x.eid]!)) (vx = 0), (vy = 0); // dash / teleport step: not a walking velocity
          const c = closest(xp.x, xp.y, vx, vy, Pos.x[eid]!, Pos.y[eid]!, ux, uy, tmax);
          if (c.d <= Unit.radius[x.eid]! + half && c.t >= 0.2) shot.threats.push({ slot: x.slot, tStar: c.t, dist: c.d, seen: sees(sim, x.team, src) });
        }
        shots.set(key, shot);
        // reaction stimulus: seen threat against a champion
        for (const th of shot.threats) if (th.seen) stim(bySlot.get(th.slot)!, 'rtDodge', T);
      }
      shot.lastTravelled = Proj.travelled[eid]!;
      shot.lastSeenTick = T;
      for (const h of pl.hit) if (Unit.kind[h] === Kind.Champion && Unit.team[h] !== shot.team) shot.hitSlots.add(Unit.slot[h]!);
    }
    for (const [key, shot] of shots) {
      if (live.has(key)) continue;
      shots.delete(key);
      for (const h of shot.payload.hit) if (sim.c.Unit.kind[h] === Kind.Champion && sim.c.Unit.team[h] !== shot.team) shot.hitSlots.add(sim.c.Unit.slot[h]!);
      finalizeShot(sim, shot, T);
    }
  }

  function finalizeShot(sim: Sim, shot: Shot, T: number): void {
    const shooter = bySlot.get(shot.slot)!;
    const hit = shot.hitSlots.size > 0;
    addRole(shot.team, 'ssHit', shooter.role, hit ? 1 : 0, 1);
    if (shot.aimed) addRole(shot.team, 'ssAimed', shooter.role, hit ? 1 : 0, 1);
    for (const th of shot.threats) {
      if (!th.seen) continue;
      const v = bySlot.get(th.slot)!;
      const wasHit = shot.hitSlots.has(th.slot);
      if (!wasHit) {
        // not a dodge when the shot never got that far (blocked by a minion / another champion, expired) or the target died
        if (shot.lastTravelled + shot.speed * DT * 2 < shot.speed * th.tStar) continue;
        if (!sim.c.Unit.alive[v.eid]) continue;
      }
      addRole(v.team, 'dodge', v.role, wasHit ? 0 : 1, 1);
      const usedSkill = v.lastSkillCmd >= shot.spawn && v.lastSkillCmd <= T;
      add(v.team, 'dodgeMove', !wasHit && !usedSkill ? 1 : 0, 1);
    }
  }

  // ------------------------------------------------------------------ per-champion state
  function frontTower(sim: Sim, team: number, lane: number): number {
    const { Unit, Pos } = sim.c;
    const spots = sim.map.sides[team === 1 ? 1 : 0].towers[LANE_NAMES[lane]!];
    let best = -1;
    let bestIdx = 99;
    for (const e of query(sim.world, [Unit])) {
      if (Unit.kind[e] !== Kind.Tower || Unit.team[e] !== team || !Unit.alive[e]) continue;
      const idx = spots.findIndex((p) => hypot(p.x - Pos.x[e]!, p.y - Pos.y[e]!) < 200);
      if (idx >= 0 && idx < bestIdx) (best = e), (bestIdx = idx);
    }
    return best;
  }

  function waveState(sim: Sim, c: Champ): 'crashed' | 'bad' | 'neutral' {
    const { Unit, Pos } = sim.c;
    const own = frontTower(sim, c.team, c.lane);
    const enemy = frontTower(sim, 1 - c.team, c.lane);
    let atOwn = 0;
    let atEnemy = 0;
    for (const u of query(sim.world, [Unit])) {
      if (!Unit.alive[u] || !isMinion(Unit.kind[u]!) || Unit.lane[u] !== c.lane) continue;
      if (own >= 0 && Unit.team[u] !== c.team && hypot(Pos.x[u]! - Pos.x[own]!, Pos.y[u]! - Pos.y[own]!) < 1000) atOwn++;
      if (enemy >= 0 && Unit.team[u] === c.team && hypot(Pos.x[u]! - Pos.x[enemy]!, Pos.y[u]! - Pos.y[enemy]!) < 1200) atEnemy++;
    }
    return atOwn >= 3 ? 'bad' : atEnemy >= 3 ? 'crashed' : 'neutral';
  }

  function finishRecall(c: Champ, sim: Sim, left: boolean): void {
    const r = c.recall;
    if (!r) return;
    c.recall = undefined;
    if (!r.done) return;
    const { Champ } = sim.c;
    addRole(c.team, 'recallSpent', c.role, Champ.totalGold[c.eid]! - Champ.gold[c.eid]! - r.spentBefore, 1);
    addRole(c.team, 'recallLeft', c.role, Champ.gold[c.eid]!, 1);
    void left;
  }

  function perChampion(sim: Sim, T: number, units: number[]): void {
    const { Unit, Pos, Hp, Champ, Atk, Move, Stats } = sim.c;
    for (const c of champs) {
      const e = c.eid;
      const alive = !!Unit.alive[e];
      const f = sim.map.sides[c.team === 1 ? 1 : 0].fountain;
      const inFountain = hypot(Pos.x[e]! - f.x, Pos.y[e]! - f.y) <= f.r;
      // vision history of the enemy team on this champion (+ appearance stimulus for the enemy bots)
      const enemy = 1 - c.team;
      const seenNow = alive && sees(sim, enemy, e);
      seenHist[enemy]![c.slot]![T & 255] = seenNow ? 1 : 0;
      if (seenNow) {
        if (T - lastSeen[enemy]![c.slot]! > 90) {
          for (const x of champs) {
            if (x.team === enemy && Unit.alive[x.eid] && hypot(Pos.x[x.eid]! - Pos.x[e]!, Pos.y[x.eid]! - Pos.y[e]!) <= 1500) stim(x, 'rtVision', T);
          }
        }
        lastSeen[enemy]![c.slot] = T;
      }
      if (T === 10 * TICKS_MIN) {
        if (isLanerRole(c.role)) add(c.team, 'cs10', Champ.cs[e]!, 1);
        add(c.team, `cs10.${c.role}`, Champ.cs[e]!, 1);
      }
      // ---- recall episodes
      const rec = alive && Champ.recallAt[e]! > 0;
      if (rec && !c.recalling) {
        const lane = c.lane >= 0 && c.role !== 'jungle';
        const w = lane ? waveState(sim, c) : 'neutral';
        c.recall = { start: T, gold: Champ.gold[e]!, spentBefore: Champ.totalGold[e]! - Champ.gold[e]!, hp: Hp.cur[e]! / Math.max(1, Hp.max[e]!), wave: w, lane, done: false, doneAt: 0 };
        addRole(c.team, 'recallPer10', c.role, 1, 0);
        addRole(c.team, 'recallGold', c.role, Champ.gold[e]!, 1);
        addRole(c.team, 'recallHp', c.role, Hp.cur[e]! / Math.max(1, Hp.max[e]!), 1);
        if (lane) {
          addRole(c.team, 'recallCrashed', c.role, w === 'crashed' ? 1 : 0, 1);
          addRole(c.team, 'recallBad', c.role, w === 'bad' ? 1 : 0, 1);
        }
      } else if (!rec && c.recalling && c.recall && !c.recall.done) {
        const done = alive && inFountain;
        addRole(c.team, 'recallDone', c.role, done ? 1 : 0, 1);
        if (done) {
          c.recall.done = true;
          c.recall.doneAt = T;
        } else c.recall = undefined;
      }
      c.recalling = rec;
      if (c.recall?.done && (!alive || !inFountain || T - c.recall.doneAt > 20 * 30)) finishRecall(c, sim, true);
      if (!alive) {
        c.idleSince = -1;
        if (c.recall && !c.recall.done) c.recall = undefined;
        continue;
      }
      // ---- idle share, broad: no order at all (A2)
      const busy = isBusy(sim, e);
      if (T > IDLE_FROM && !inFountain && !rec) {
        const idle = Move.mode[e] === 0 && Atk.phase[e] === 0 && Atk.target[e]! < 0 && !busy;
        addRole(c.team, 'idleAll', c.role, idle ? 1 : 0, 1);
        if (idle) {
          if (c.idleSince < 0) c.idleSince = T;
          c.maxIdle = Math.max(c.maxIdle, (T - c.idleSince) / 30);
        } else c.idleSince = -1;
      } else c.idleSince = -1;
      // ---- laner idle share (brain spec) and attack utilisation
      if (isLanerRole(c.role) && T >= UTIL_FROM && T < UTIL_TO && !rec) {
        const reach = Stats.range[e]! + Unit.radius[e]! + 200;
        let inReach = false;
        for (const u of units) {
          if (Unit.team[u] === c.team) continue;
          if (hypot(Pos.x[u]! - Pos.x[e]!, Pos.y[u]! - Pos.y[e]!) <= reach + Unit.radius[u]!) {
            inReach = true;
            break;
          }
        }
        if (inReach) {
          const attacking = Atk.phase[e] !== 0;
          addRole(c.team, 'util', c.role, attacking ? 1 : 0, 1);
          const idle = !attacking && Move.mode[e] === 0 && !busy && T - c.lastOrderTick > IDLE_ORDER_TICKS;
          addRole(c.team, 'idle', c.role, idle ? 1 : 0, 1);
        }
      }
    }
  }

  function unitsInReach(sim: Sim): number[] {
    const { Unit } = sim.c;
    const out: number[] = [];
    for (const u of query(sim.world, [Unit])) {
      if (!Unit.alive[u]) continue;
      const k = Unit.kind[u]!;
      if (isMinion(k) || k === Kind.Champion) out.push(u);
    }
    return out;
  }

  return {
    onTick(sim, inputs) {
      if (!inited) init(sim);
      const T = sim.tick;
      handleCommands(sim, inputs, T);
      handleEvents(sim, T);
      if (T - lastExchangeSweep >= 30) {
        lastExchangeSweep = T;
        closeExchanges(T, false);
      }
      scanProjectiles(sim, T);
      perChampion(sim, T, T >= UTIL_FROM && T < UTIL_TO ? unitsInReach(sim) : []);
    },
    finish(sim) {
      const T = sim.tick;
      closeExchanges(T, true);
      for (const c of champs) {
        if (c.recall?.done) finishRecall(c, sim, false);
        if (c.maxIdle > 0) sample(c.team, 'idleMaxS', c.role, c.maxIdle);
      }
      return res;
    },
  };
}
