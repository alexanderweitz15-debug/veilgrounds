// Player-equivalent commands -> unit intents. Same path for humans and bots.

import type { Sim } from '../sim';
import type { System } from './index';
import { findPath } from '../map';
import { canTarget, onMoveCommand } from './attack';
import { castAbility, castSummoner, levelAbility, refreshCooldowns } from './abilities';
import { cancelRecall, grantGold, grantXp, startRecall, xpToNext } from './economy';
import { spawnDummy } from './champions';
import { PING_KINDS, type Command } from '../types';
import { sees } from '../vision';
import { buyItem, sellItem } from '../items/inventory';
import { useItem } from '../items/itemHooks';
import { swapTrinket, useTrinket } from '../wards';

export const inputSystem: System = {
  name: 'input',
  update(sim) {
    for (const { slot, cmd } of sim.pending) {
      const eid = sim.slots[slot];
      if (eid === undefined || eid < 0) continue;
      apply(sim, eid, cmd);
    }
  },
};

export function moveTo(sim: Sim, eid: number, x: number, y: number): void {
  const { Move, Pos } = sim.c;
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
  if (!Unit.alive[eid]) return;
  switch (cmd.t) {
    case 'move':
      onMoveCommand(sim, eid);
      cancelRecall(sim, eid);
      Atk.target[eid] = -1;
      Atk.attackMove[eid] = 0;
      moveTo(sim, eid, cmd.x, cmd.y);
      break;
    case 'stop':
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
      cancelRecall(sim, eid);
      if (Atk.target[eid] !== t) onMoveCommand(sim, eid);
      Atk.target[eid] = t;
      Atk.targetSerial[eid] = Unit.serial[t]!;
      Atk.attackMove[eid] = 0;
      Move.mode[eid] = 2;
      break;
    }
    case 'attackMove':
      onMoveCommand(sim, eid);
      cancelRecall(sim, eid);
      Atk.target[eid] = -1;
      Atk.attackMove[eid] = 1;
      Atk.amx[eid] = cmd.x;
      Atk.amy[eid] = cmd.y;
      moveTo(sim, eid, cmd.x, cmd.y);
      break;
    case 'cast':
      castAbility(sim, eid, cmd.slot, cmd.x, cmd.y, cmd.target);
      break;
    case 'spell':
      castSummoner(sim, eid, cmd.slot, cmd.x, cmd.y, cmd.target);
      break;
    case 'levelUp':
      levelAbility(sim, eid, cmd.slot);
      break;
    case 'recall':
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

function cheat(sim: Sim, eid: number, cmd: Extract<Command, { t: 'cheat' }>): void {
  // Only sandbox / trainers accept cheats; classic games ignore them so replays stay honest.
  if (sim.config.mode === 'classic') return;
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
      grantXp(sim, eid, cmd.value ?? xpToNext(sim, eid));
      break;
    case 'gold':
      grantGold(sim, eid, cmd.value ?? 10000);
      break;
    case 'teleport':
      if (cmd.x !== undefined && cmd.y !== undefined && Unit.alive[eid]) {
        Pos.x[eid] = Pos.px[eid] = cmd.x;
        Pos.y[eid] = Pos.py[eid] = cmd.y;
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
  sim.events.push({ e: 'chat', slot: Unit.slot[eid]!, team: Unit.team[eid]!, text: cmd.text.slice(0, 120), ...(cmd.ref !== undefined ? { ref: cmd.ref } : {}) });
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
