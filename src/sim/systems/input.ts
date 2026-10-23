// Player-equivalent commands -> unit intents. Same path for humans and bots.

import type { Sim } from '../sim';
import type { System } from './index';
import { findPath, nearestWalkable } from '../map';
import { canTarget, onMoveCommand, setHoldFire, setAttackMoveCursor } from './attack';
import { cancelCastIntents, chooseUlt, commandCast, levelAbility, refreshCooldowns, updateCastIntents } from './abilities';
import { cancelRecall, grantGold, grantXp, startRecall, xpToNext } from './economy';
import { spawnDummy } from './champions';
import { PING_KINDS, type Command } from '../types';
import { sees } from '../vision';
import { buyItem, sellItem } from '../items/inventory';
import { useItem } from '../items/itemHooks';
import { swapTrinket, useTrinket } from '../wards';
import { scheduleNextWave } from './waves';
import { raiseLevel } from '../trainer/common';
import { respawnCamps, toggleGodMode, toggleNoCooldowns } from '../trainer/sandbox';

export const inputSystem: System = {
  name: 'input',
  update(sim) {
    for (const { slot, cmd } of sim.pending) {
      const eid = sim.slots[slot];
      if (eid === undefined || eid < 0) continue;
      const safe = sanitize(sim, cmd);
      if (safe) apply(sim, eid, safe);
    }
    updateCastIntents(sim); // buffered casts, walk-into-range casts
  },
};

/** Orders (move/stop/attack/attack-move/recall) end a walk-into-range cast; Stop also clears the input buffer. */
function newOrder(sim: Sim, eid: number, stop: boolean): void {
  cancelCastIntents(sim, eid, stop);
  setHoldFire(sim, eid, stop);
}

const clampTo = (v: number, max: number): number => Math.min(max, Math.max(0, v));

/**
 * Commands come from the UI and from bots: a command with a non-finite coordinate is dropped, coordinates outside
 * the map are clamped onto it (pathfinding and every ground effect assume in-map points).
 */
export function sanitize(sim: Sim, cmd: Command): Command | null {
  if (!('x' in cmd) || (cmd.x === undefined && cmd.y === undefined)) return cmd;
  const { x, y } = cmd;
  if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const S = sim.map.size;
  return { ...cmd, x: clampTo(x, S), y: clampTo(y, S) };
}

export function moveTo(sim: Sim, eid: number, x: number, y: number): void {
  const { Move, Pos } = sim.c;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  x = clampTo(x, sim.map.size);
  y = clampTo(y, sim.map.size);
  sim.paths.set(eid, findPath(sim.map.nav, Pos.x[eid]!, Pos.y[eid]!, x, y));
  Move.mode[eid] = 1;
  Move.tx[eid] = x;
  Move.ty[eid] = y;
  Move.pathIdx[eid] = 0;
}

function apply(sim: Sim, eid: number, cmd: Command): void {
  const { Unit, Atk, Move } = sim.c;
  if (cmd.t === 'cheat') return cheat(sim, eid, cmd);
  if (cmd.t === 'buy') return void buyItem(sim, eid, cmd.item); // allowed while dead (inventory.ts)
  if (cmd.t === 'sell') return void sellItem(sim, eid, cmd.slot);
  if (cmd.t === 'trinket') return void swapTrinket(sim, eid, cmd.id); // shop rule: also while dead
  if (cmd.t === 'ping') return ping(sim, eid, cmd); // pings also while dead
  if (cmd.t === 'chat') return chat(sim, eid, cmd);
  if (cmd.t === 'ultChoice') return void chooseUlt(sim, eid, cmd.choice);
  if (!Unit.alive[eid]) return;
  switch (cmd.t) {
    case 'move':
      newOrder(sim, eid, false);
      onMoveCommand(sim, eid);
      cancelRecall(sim, eid);
      Atk.target[eid] = -1;
      Atk.attackMove[eid] = 0;
      moveTo(sim, eid, cmd.x, cmd.y);
      break;
    case 'stop':
      newOrder(sim, eid, true);
      onMoveCommand(sim, eid);
      cancelRecall(sim, eid);
      Atk.target[eid] = -1;
      Atk.attackMove[eid] = 0;
      Move.mode[eid] = 0;
      sim.paths.delete(eid);
      break;
    case 'attack': {
      const t = cmd.target;
      if (!canTarget(sim, eid, t)) break;
      newOrder(sim, eid, false);
      cancelRecall(sim, eid);
      if (Atk.target[eid] !== t) onMoveCommand(sim, eid);
      Atk.target[eid] = t;
      Atk.targetSerial[eid] = Unit.serial[t]!;
      Atk.attackMove[eid] = 0;
      Move.mode[eid] = 2;
      break;
    }
    case 'attackMove':
      newOrder(sim, eid, false);
      onMoveCommand(sim, eid);
      cancelRecall(sim, eid);
      Atk.target[eid] = -1;
      Atk.attackMove[eid] = 1;
      setAttackMoveCursor(sim, eid, !!cmd.cursor);
      Atk.amx[eid] = cmd.x;
      Atk.amy[eid] = cmd.y;
      moveTo(sim, eid, cmd.x, cmd.y);
      break;
    case 'cast':
      commandCast(sim, eid, false, cmd.slot, cmd.x, cmd.y, cmd.target);
      break;
    case 'spell':
      commandCast(sim, eid, true, cmd.slot, cmd.x, cmd.y, cmd.target);
      break;
    case 'levelUp':
      levelAbility(sim, eid, cmd.slot);
      break;
    case 'recall':
      cancelCastIntents(sim, eid, true);
      startRecall(sim, eid);
      break;
    case 'ward':
      useTrinket(sim, eid, cmd.x, cmd.y);
      break;
    case 'item':
      useItem(sim, eid, cmd.slot, cmd.x, cmd.y);
      break;
  }
}

/** Cheat amounts (gold, XP): finite and not negative. */
const validAmount = (v: number): boolean => Number.isFinite(v) && v >= 0;

function cheat(sim: Sim, eid: number, cmd: Extract<Command, { t: 'cheat' }>): void {
  // Only sandbox, lane practice and the kiting trainer accept cheats; classic games and scored trainers ignore them.
  if (sim.config.mode !== 'sandbox' && sim.config.mode !== 'laneOnly' && sim.config.mode !== 'kite') return;
  const { Hp, Mana, Pos, Unit } = sim.c;
  switch (cmd.op) {
    case 'refreshCd':
      refreshCooldowns(sim, eid);
      break;
    case 'refreshHp':
      Hp.cur[eid] = Hp.max[eid]!;
      Mana.cur[eid] = Mana.max[eid]!;
      break;
    case 'levelUp':
      if (cmd.value === undefined || validAmount(cmd.value)) grantXp(sim, eid, cmd.value ?? xpToNext(sim, eid));
      break;
    case 'gold':
      if (cmd.value === undefined || validAmount(cmd.value)) grantGold(sim, eid, cmd.value ?? 10000);
      break;
    case 'teleport':
      if (cmd.x !== undefined && cmd.y !== undefined && Unit.alive[eid]) {
        const p = nearestWalkable(sim.map.nav, cmd.x, cmd.y); // never into a wall
        Pos.x[eid] = Pos.px[eid] = p.x;
        Pos.y[eid] = Pos.py[eid] = p.y;
        sim.paths.delete(eid);
        sim.c.Move.mode[eid] = 0;
      }
      break;
    case 'spawnDummy':
      if (cmd.x !== undefined && cmd.y !== undefined) spawnDummy(sim, cmd.x, cmd.y, Unit.team[eid] === 0 ? 1 : 0);
      break;
    case 'toggleMinions':
      sim.flags.minions = !sim.flags.minions;
      break;
    case 'towersInvulnerable':
      sim.flags.towersInvulnerable = !sim.flags.towersInvulnerable;
      break;
    case 'setLevel':
      if (cmd.value !== undefined && Number.isFinite(cmd.value)) raiseLevel(sim, eid, cmd.value);
      break;
    case 'noCooldowns':
      toggleNoCooldowns(sim, eid);
      break;
    case 'godMode':
      toggleGodMode(sim, eid);
      break;
    case 'spawnWave':
      scheduleNextWave(sim, sim.tick + 1);
      break;
    case 'respawnCamps':
      respawnCamps(sim);
      break;
    case 'skipTime':
      break; // ponytail: needs fast-forward stepping in the worker; Phase 5 sandbox
  }
}

const PING_WINDOW = 30 * 4; // ticks
const PING_MAX = 6; // per window and player (anti-spam, LoL-like)

/** Team ping. Rate-limited per player; delivered only to the pinging team by the snapshot filter. */
/** Team chat (bots, spec §9): same rate limit as pings, 120 chars max. */
function chat(sim: Sim, eid: number, cmd: Extract<Command, { t: 'chat' }>): void {
  if (typeof cmd.text !== 'string' || !cmd.text) return;
  const st = (sim.state.chats ??= new Map<number, number[]>()) as Map<number, number[]>;
  const recent = (st.get(eid) ?? []).filter((t) => sim.tick - t < PING_WINDOW);
  if (recent.length >= PING_MAX) return;
  recent.push(sim.tick);
  st.set(eid, recent);
  const { Unit } = sim.c;
  sim.events.push({ e: 'chat', slot: Unit.slot[eid]!, team: Unit.team[eid]!, text: cmd.text.slice(0, 120), ...(cmd.ref !== undefined ? { ref: cmd.ref } : {}), ...(cmd.all ? { all: true } : {}) });
}

function ping(sim: Sim, eid: number, cmd: Extract<Command, { t: 'ping' }>): void {
  if (!PING_KINDS.includes(cmd.kind) || !Number.isFinite(cmd.x) || !Number.isFinite(cmd.y)) return;
  const st = (sim.state.pings ??= new Map<number, number[]>()) as Map<number, number[]>;
  const recent = (st.get(eid) ?? []).filter((t) => sim.tick - t < PING_WINDOW);
  if (recent.length >= PING_MAX) return;
  recent.push(sim.tick);
  st.set(eid, recent);
  const { Unit } = sim.c;
  // a target must be something the team actually sees (no info leak through pings)
  const target = cmd.target !== undefined && cmd.target >= 0 && Unit.alive[cmd.target] && sees(sim, Unit.team[eid]!, cmd.target) ? cmd.target : -1;
  sim.events.push({ e: 'ping', slot: Unit.slot[eid]!, team: Unit.team[eid]!, kind: cmd.kind, x: Math.max(0, Math.min(16000, cmd.x)), y: Math.max(0, Math.min(16000, cmd.y)), target });
}
