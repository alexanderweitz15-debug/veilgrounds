// Szenario-Trainer (Phase 6): short scripted situations with a goal, a time limit and a success/fail evaluation.
// The scenario sets the match clock (sim.tick) to its start time, closes jungle camps it does not need and places
// champions with preset level / HP / items. Opponents are normal bots (BotRunner, rank from the lobby): this module
// only sets up the board and evaluates observable sim facts (deaths with killer team, positions, CS, hits).
// Deterministic: integer ticks, + - * / sqrt only, no sim.rng draws outside the scenario's own scripted events.

import { query } from 'bitecs';
import type { Sim } from '../sim';
import { despawn } from '../sim';
import { Kind, Lane, Team, sec, type PlayerSetup } from '../types';
import { grantGold, START_GOLD } from '../systems/economy';
import { buyItem, itemValue } from '../items/inventory';
import { champAbil, refreshCooldowns } from '../systems/abilities';
import { CLOSED, jungleState } from '../systems/jungle';
import { laneGeo, lanePoint, laneProgress, setLanePath } from '../systems/minions';
import { scheduleNextWave, spawnWave } from '../systems/waves';
import { TOWER_RANGE } from '../systems/towers';
import { spawnProjectile } from '../systems/projectiles';
import { dealDamage, kill } from '../damage';
import { reveal } from '../buffs';
import type { Pt } from '../map';
import { autoLevel, grade, place, raiseLevel, runSeconds, type TrainerHud } from './common';
import type { TrainerPayload } from './dodge';

export const SCENARIO_IDS = ['turret2v1', 'gankEscape', 'towerDive', 'dragonSteal', 'freezeWave', 'protectCarry', 'flashUlt', 'waveCatch', 'baronCall', 'shoveRecall'] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];

/** One champion of the scenario besides the player (slot 0, team 0). `bot: false` = passive champion (no BotRunner). */
export interface ScenarioUnit {
  slot: number;
  team: 0 | 1;
  role: PlayerSetup['role'];
  /** Preferred champions; the first one that is not the player's champion is used. */
  champs: string[];
  bot: boolean;
  summoners?: [string, string];
  /** Playstyle axes for the bot (-5..+5), e.g. aggression +5 for the attackers of a scenario. */
  style?: NonNullable<PlayerSetup['bot']>['playstyle'];
}

/** Static scenario data (shared with the client config builder, src/game/scenarioConfig.ts). */
export interface ScenarioInfo {
  id: ScenarioId;
  /** Match clock at the start (minutes). */
  startMin: number;
  limitSec: number;
  playerRole: PlayerSetup['role'];
  /** Summoner the player must carry (replaces the second pick if missing). */
  needSummoner?: string;
  /** Lane minions on (mid lane only). */
  minions?: boolean;
  /** Champions get boots + core items (config trainer.items). */
  items?: boolean;
  /** Enemy champions get only the first n preset items (gold lead scenarios). */
  foeItems?: number;
  units: ScenarioUnit[];
}

/** Tuning of the macro scenarios (Phase 7.3). */
export const WAVE_CATCH = { csGoal: 4, csFull: 8, riskySec: 5, exposeFullSec: 8, jungleReach: 2500 } as const;
/** allyDps: scripted extra true damage per living ally and second (the allies are passive), never below keepPct HP - the last hits are real. */
export const BARON_CALL = { goldLead: 4000, level: 16, foeLevel: 15, allyDps: 20, keepPct: 10, collapseDist: 1700 } as const;
export const SHOVE_RECALL = { gold: 1800, maxLost: 2, minOwnAtRecall: 3, maxFoeAtRecall: 2 } as const;
/** Score helpers (exported for tests). */
export const waveCatchScore = (cs: number, exposedSec: number): number =>
  Math.round(60 * Math.min(1, cs / WAVE_CATCH.csFull) + 40 * (1 - Math.min(1, exposedSec / WAVE_CATCH.exposeFullSec)));
export const baronScore = (elapsedTicks: number, limitTicks: number, alliesDown: number): number =>
  Math.max(50, Math.round(100 - (50 * elapsedTicks) / Math.max(1, limitTicks)) - 15 * alliesDown);
export const shoveScore = (lost: number): number => Math.max(60, 100 - 20 * lost);

const JG = ['grimald', 'nyx', 'lio', 'vessa', 'sev', 'vargrim'];
const MID = ['thessaly', 'renn', 'aurel', 'ilvane', 'sev'];
const TOP = ['isolde', 'brom', 'dagny', 'vargrim'];
const ADC = ['tobin', 'lysa', 'corvin', 'mira'];
/** Attackers: all-in, long trades, tower dives allowed (playstyle axes, src/data/bots/playstyleAxes.json). */
const DIVE = { aggression: 5, tradeLength: 5, teamplay: 5 };

export const SCENARIOS: Record<ScenarioId, ScenarioInfo> = {
  turret2v1: {
    id: 'turret2v1', startMin: 7, limitSec: 25, playerRole: 'mid', minions: true,
    units: [
      { slot: 5, team: 1, role: 'mid', champs: MID, bot: true, summoners: ['sprung', 'entflammen'], style: DIVE },
      { slot: 6, team: 1, role: 'mid', champs: JG, bot: true, summoners: ['sprung', 'bannen'], style: DIVE },
    ],
  },
  gankEscape: {
    id: 'gankEscape', startMin: 6, limitSec: 25, playerRole: 'mid',
    units: [
      { slot: 5, team: 1, role: 'mid', champs: MID, bot: true, summoners: ['sprung', 'entflammen'], style: DIVE },
      { slot: 6, team: 1, role: 'jungle', champs: JG, bot: true, summoners: ['sprung', 'bannen'], style: DIVE },
    ],
  },
  towerDive: {
    id: 'towerDive', startMin: 9, limitSec: 20, playerRole: 'mid', items: true,
    units: [
      { slot: 5, team: 1, role: 'mid', champs: MID, bot: true, summoners: ['sprung', 'heilen'] },
    ],
  },
  dragonSteal: {
    id: 'dragonSteal', startMin: 10, limitSec: 22, playerRole: 'jungle', needSummoner: 'bannen', items: true,
    units: [
      { slot: 6, team: 1, role: 'jungle', champs: JG, bot: false, summoners: ['sprung', 'bannen'] },
      { slot: 9, team: 1, role: 'support', champs: ['kiran', 'gorvam', 'hagen'], bot: false, summoners: ['sprung', 'erschoepfen'] },
    ],
  },
  freezeWave: { id: 'freezeWave', startMin: 5, limitSec: 60, playerRole: 'mid', minions: true, units: [] },
  protectCarry: {
    id: 'protectCarry', startMin: 12, limitSec: 20, playerRole: 'support', items: true, minions: true,
    units: [
      { slot: 3, team: 0, role: 'mid', champs: ADC, bot: true, summoners: ['sprung', 'heilen'], style: { aggression: -2, kiting: -5 } },
      { slot: 5, team: 1, role: 'mid', champs: ['nyx', 'vessa', 'kaelen'], bot: true, summoners: ['sprung', 'entflammen'], style: DIVE },
      { slot: 6, team: 1, role: 'mid', champs: TOP, bot: true, summoners: ['sprung', 'teleport'], style: DIVE },
    ],
  },
  flashUlt: {
    id: 'flashUlt', startMin: 8, limitSec: 24, playerRole: 'mid', needSummoner: 'sprung',
    units: [{ slot: 5, team: 1, role: 'adc', champs: ['corvin', 'tobin', 'lysa'], bot: false }],
  },
  // Wave under the tower while the enemy jungler is visible on the minimap
  waveCatch: {
    id: 'waveCatch', startMin: 8, limitSec: 35, playerRole: 'mid', minions: true, items: true,
    units: [{ slot: 6, team: 1, role: 'jungle', champs: JG, bot: true, summoners: ['sprung', 'bannen'], style: DIVE }],
  },
  // 4k gold ahead, enemy jungler dead: take the Schleierwaechter before he is back
  baronCall: {
    id: 'baronCall', startMin: 22, limitSec: 90, playerRole: 'jungle', items: true, foeItems: 1,
    units: [
      { slot: 1, team: 0, role: 'mid', champs: MID, bot: false },
      { slot: 3, team: 0, role: 'adc', champs: ADC, bot: false },
      { slot: 5, team: 1, role: 'jungle', champs: JG, bot: true, summoners: ['sprung', 'bannen'] },
      { slot: 6, team: 1, role: 'mid', champs: ['thessaly', 'renn', 'aurel', 'ilvane'], bot: true, summoners: ['sprung', 'heilen'], style: { teamplay: 5 } },
      { slot: 7, team: 1, role: 'adc', champs: ['corvin', 'lysa', 'tobin'], bot: true, summoners: ['sprung', 'heilen'], style: { teamplay: 5 } },
    ],
  },
  // Item gold in the pocket: shove the wave into the enemy tower, then recall
  shoveRecall: { id: 'shoveRecall', startMin: 8, limitSec: 70, playerRole: 'mid', minions: true, units: [] },
};

export const isScenarioId = (s: unknown): s is ScenarioId => typeof s === 'string' && (SCENARIO_IDS as readonly string[]).includes(s);

// ---------------------------------------------------------------- state

export interface ScenarioState {
  id: ScenarioId;
  start: number;
  end: number;
  limit: number;
  /** 'won' / 'lost' once decided. */
  result: 'running' | 'won' | 'lost';
  /** Why it ended (i18n key suffix scenario.why.<why>). */
  why: string;
  /** Champion eid per scenario slot (player = slot 0). */
  me: number;
  ally: number;
  foe: number;
  foe2: number;
  /** All allies / foes of the scenario besides the player (slot order). */
  allies: number[];
  foes: number[];
  /** Counters shown in the HUD (insertion order = display order). */
  n: Record<string, number>;
  /** Scenario-specific scheduling: next scripted event tick, shots fired / to fire. */
  next: number;
  /** Player CS at the start (freeze / CS goals). */
  cs0: number;
  /** Dragon eid (dragon steal) once spawned, -1 before. */
  obj: number;
  /** Dragon set up (HP lowered) once it spawned. */
  ready: boolean;
  /** HP percentages applied on the first tick (after the stats system raised max HP for level and items). */
  hp: [number, number][];
}

const eidOfSlot = (sim: Sim, slot: number): number => sim.slots[slot] ?? -1;

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const len = (p: Pt): number => Math.sqrt(p.x * p.x + p.y * p.y);
/** Point `d` units from a toward b (lateral `side` units to the left of that direction). */
function toward(a: Pt, b: Pt, d: number, side = 0): Pt {
  const v = sub(b, a);
  const l = len(v) || 1;
  const ux = v.x / l;
  const uy = v.y / l;
  return { x: a.x + ux * d - uy * side, y: a.y + uy * d + ux * side };
}
const dist = (sim: Sim, e: number, p: Pt): number => len({ x: sim.c.Pos.x[e]! - p.x, y: sim.c.Pos.y[e]! - p.y });
const posOf = (sim: Sim, e: number): Pt => ({ x: sim.c.Pos.x[e]!, y: sim.c.Pos.y[e]! });

const outerTower = (sim: Sim, team: number): Pt => sim.map.sides[team]!.towers.mid[0]!;
const fountain = (sim: Sim, team: number): Pt => sim.map.sides[team]!.fountain;

/** HP share for the first tick: max HP is final only after the stats system ran (level + items). */
function setHpPct(s: ScenarioState, e: number, pct: number): void {
  s.hp.push([e, pct]);
}

/** Level, items (bought in the fountain at init, so shop rules apply), full mana. */
function equip(sim: Sim, e: number, level: number): void {
  raiseLevel(sim, e, level);
  autoLevel(sim, e);
  const slot = sim.c.Unit.slot[e]!;
  for (const id of sim.config.trainer?.items?.[String(slot)] ?? []) {
    grantGold(sim, e, 6000);
    buyItem(sim, e, id);
  }
  sim.c.Champ.gold[e] = 0;
  sim.c.Hp.cur[e] = sim.c.Hp.max[e]!;
  sim.c.Mana.cur[e] = sim.c.Mana.max[e]!;
  refreshCooldowns(sim, e);
}

// ---------------------------------------------------------------- init

export function initScenario(sim: Sim): ScenarioState {
  const id: ScenarioId = isScenarioId(sim.config.trainer?.scenario) ? sim.config.trainer!.scenario as ScenarioId : 'turret2v1';
  const info = SCENARIOS[id];
  // match clock: bots, tower damage and camp timers behave as at this game time (replays start from createSim too)
  sim.tick = sec(info.startMin * 60);
  // only the camps a scenario needs; lane waves only where asked
  for (const c of jungleState(sim).camps) c.spawnAt = CLOSED;
  if (!info.minions) sim.flags.minions = false;
  const units = info.units.map((u) => eidOfSlot(sim, u.slot));
  const allies = info.units.map((u, i) => (u.team === 0 ? units[i]! : -1)).filter((e) => e >= 0);
  const foes = info.units.map((u, i) => (u.team === 1 ? units[i]! : -1)).filter((e) => e >= 0);
  const s: ScenarioState = {
    id,
    start: sim.tick,
    end: -1,
    limit: sec(info.limitSec),
    result: 'running',
    why: '',
    me: eidOfSlot(sim, 0),
    ally: -1,
    foe: -1,
    foe2: -1,
    allies,
    foes,
    n: {},
    next: 0,
    cs0: 0,
    ready: false,
    obj: -1,
    hp: [],
  };
  s.ally = allies[0] ?? -1;
  s.foe = foes[0] ?? -1;
  s.foe2 = foes[1] ?? -1;
  if (s.me < 0) return s;
  SETUP[id](sim, s);
  s.cs0 = sim.c.Champ.cs[s.me]!;
  return s;
}

const SETUP: Record<ScenarioId, (sim: Sim, s: ScenarioState) => void> = {
  turret2v1(sim, s) {
    const t = outerTower(sim, 0);
    const e = outerTower(sim, 1);
    equip(sim, s.me, 7);
    setHpPct(s, s.me, 50);
    place(sim, s.me, ...xy(toward(t, e, 900)));
    for (const [f, side] of [[s.foe, 160], [s.foe2, -220]] as const) {
      if (f < 0) continue;
      equip(sim, f, 8);
      place(sim, f, ...xy(toward(t, e, 1500, side)));
    }
    // an enemy wave is hitting the tower: the attackers have a reason to stand there
    const g = laneGeo(sim, 0, Lane.Mid);
    const pt = laneProgress(g, t.x, t.y);
    spawnWave(sim, Team.Red, Lane.Mid, false, false).forEach((m, i) => putOnLane(sim, m, g, pt + 1900 + Math.floor(i / 3) * 70, ((i % 3) - 1) * 70));
    scheduleNextWave(sim, sim.tick + sec(60));
    s.n = { survive: info(s).limitSec, kills: 0 };
  },
  gankEscape(sim, s) {
    const g = laneGeo(sim, 0, Lane.Mid);
    const p = lanePoint(g, g.len * 0.53);
    equip(sim, s.me, 6);
    setHpPct(s, s.me, 70);
    place(sim, s.me, p.x, p.y);
    if (s.foe >= 0) {
      equip(sim, s.foe, 6);
      place(sim, s.foe, ...xy(lanePoint(g, g.len * 0.7)));
    }
    if (s.foe2 >= 0) {
      equip(sim, s.foe2, 7);
      // jungler waits in the river bush closest to the player (600..1600 away), else flanks from the side
      let best: Pt | null = null;
      let bestD = Infinity;
      for (const b of sim.map.bushes) {
        const d = len(sub(b, p));
        if (d >= 700 && d <= 1300 && d < bestD) (bestD = d), (best = b);
      }
      place(sim, s.foe2, ...xy(best ?? toward(p, outerTower(sim, 1), 700, 800)));
    }
    s.n = { distTower: 0 };
  },
  towerDive(sim, s) {
    const e = outerTower(sim, 1);
    equip(sim, s.me, 9);
    place(sim, s.me, ...xy(toward(e, outerTower(sim, 0), 1150)));
    if (s.ally >= 0) {
      equip(sim, s.ally, 9);
      place(sim, s.ally, ...xy(toward(e, outerTower(sim, 0), 1250, 260)));
    }
    if (s.foe >= 0) {
      equip(sim, s.foe, 7);
      setHpPct(s, s.foe, 30);
      place(sim, s.foe, ...xy(toward(e, fountain(sim, 1), 180)));
    }
    s.n = { foeHp: 30 };
  },
  dragonSteal(sim, s) {
    const d = sim.map.objectives.leviathan;
    const camp = jungleState(sim).camps.find((c) => c.id === 'leviathan');
    if (camp) camp.spawnAt = sim.tick; // spawns on the first tick; HP is lowered in update once it exists
    equip(sim, s.me, 10);
    place(sim, s.me, ...xy(toward(d, outerTower(sim, 0), 1250)));
    for (const [f, side] of [[s.foe, 120], [s.foe2, -160]] as const) {
      if (f < 0) continue;
      equip(sim, f, 10);
      place(sim, f, ...xy(toward(d, fountain(sim, 1), 240, side)));
    }
    s.n = { dragonHp: 100 };
  },
  freezeWave(sim, s) {
    const g = laneGeo(sim, 0, Lane.Mid);
    const t = outerTower(sim, 0);
    const pt = laneProgress(g, t.x, t.y);
    equip(sim, s.me, 5);
    place(sim, s.me, ...xy(lanePoint(g, pt + 500)));
    // a big enemy wave (two waves) is pushing in; a small own wave meets it just outside tower range
    const enemy = [...spawnWave(sim, Team.Red, Lane.Mid, false, false), ...spawnWave(sim, Team.Red, Lane.Mid, false, false)];
    enemy.forEach((m, i) => putOnLane(sim, m, g, pt + 1500 + Math.floor(i / 3) * 70, ((i % 3) - 1) * 70));
    const own = spawnWave(sim, Team.Blue, Lane.Mid, false, false);
    own.forEach((m, i) => {
      if (i >= 3) despawn(sim, m); // melee only
      else putOnLane(sim, m, g, pt + 1150, (i - 1) * 70);
    });
    scheduleNextWave(sim, sim.tick + sec(20));
    s.n = { freezePct: 0, cs: 0, towerHits: 0, samples: 0, good: 0 };
  },
  protectCarry(sim, s) {
    const g = laneGeo(sim, 0, Lane.Mid);
    const m = lanePoint(g, g.len / 2);
    const home = outerTower(sim, 0);
    const away = outerTower(sim, 1);
    equip(sim, s.me, 11);
    place(sim, s.me, ...xy(toward(m, home, 450, -150)));
    if (s.ally >= 0) {
      equip(sim, s.ally, 11);
      place(sim, s.ally, ...xy(toward(m, home, 650, 150)));
      setHpPct(s, s.ally, 85);
    }
    for (const [f, side] of [[s.foe, 180], [s.foe2, -180]] as const) {
      if (f < 0) continue;
      equip(sim, f, 12);
      place(sim, f, ...xy(toward(m, away, 700, side)));
    }
    // both waves meet where the teams stand: the laners have a reason to stay and fight
    for (const [team, dd] of [[Team.Blue, -350], [Team.Red, 350]] as const) spawnWave(sim, team, Lane.Mid, false, false).forEach((x, i) => putOnLane(sim, x, g, g.len / 2 + dd + (team === Team.Blue ? -1 : 1) * Math.floor(i / 3) * 70, ((i % 3) - 1) * 70));
    scheduleNextWave(sim, sim.tick + sec(60));
    s.n = { carryHp: 100, foesDown: 0 };
  },
  flashUlt(sim, s) {
    const g = laneGeo(sim, 0, Lane.Mid);
    const p = lanePoint(g, g.len * 0.35);
    equip(sim, s.me, 8);
    place(sim, s.me, p.x, p.y);
    if (s.foe >= 0) {
      equip(sim, s.foe, 11);
      place(sim, s.foe, ...xy(lanePoint(g, g.len * 0.35 + FLASH.dist)));
    }
    s.next = sim.tick + sec(3);
    s.n = { shots: 0, dodged: 0, hits: 0 };
  },

  waveCatch(sim, s) {
    const g = laneGeo(sim, 0, Lane.Mid);
    const t = outerTower(sim, 0);
    const pt = laneProgress(g, t.x, t.y);
    equip(sim, s.me, 8);
    place(sim, s.me, ...xy(lanePoint(g, pt + 150)));
    // a big enemy wave (two waves, the second one a few steps behind) crashes into the tower; no own wave
    const wave = [...spawnWave(sim, Team.Red, Lane.Mid, false, false), ...spawnWave(sim, Team.Red, Lane.Mid, false, false)];
    wave.forEach((m, i) => putOnLane(sim, m, g, pt + 450 + Math.floor(i / 3) * 150, ((i % 3) - 1) * 70));
    scheduleNextWave(sim, sim.tick + sec(120));
    if (s.foe >= 0) {
      equip(sim, s.foe, 8);
      // the jungler waits in the river bush closest to the lane (shown on the minimap), else on the lane flank
      let best: Pt | null = null;
      let bestD = Infinity;
      const ref = lanePoint(g, pt + 2300);
      for (const b of sim.map.bushes) {
        const d = len(sub(b, ref));
        if (d <= 1200 && d < bestD) (bestD = d), (best = b);
      }
      place(sim, s.foe, ...xy(best ?? toward(ref, outerTower(sim, 1), 0, 500)));
      reveal(sim, 0, s.foe, 2);
    }
    s.n = { survive: info(s).limitSec, cs: 0, foeDist: 0, exposed: 0, exposedTicks: 0 };
  },
  baronCall(sim, s) {
    const pit = sim.map.objectives.schleierwaechter;
    const camp = jungleState(sim).camps.find((c) => c.id === 'schleierwaechter');
    if (camp) camp.spawnAt = sim.tick; // spawns on the first tick
    const home = outerTower(sim, 0);
    const away = outerTower(sim, 1);
    equip(sim, s.me, BARON_CALL.level);
    place(sim, s.me, ...xy(toward(pit, home, 1000, -150)));
    s.allies.forEach((a, i) => {
      equip(sim, a, BARON_CALL.level);
      place(sim, a, ...xy(toward(pit, home, 800 + i * 120, 250 - i * 400)));
    });
    s.foes.forEach((f, i) => {
      equip(sim, f, BARON_CALL.foeLevel);
      if (i === 0) kill(sim, f, -1); // the enemy jungler is dead (respawn timer by level and game time)
      else place(sim, f, ...xy(toward(pit, away, 2700, i === 1 ? -500 : 500)));
    });
    // gold lead: the team totals differ by exactly goldLead (earned-gold statistic shown in the HUD)
    const { Champ } = sim.c;
    for (const e of [s.me, ...s.allies, ...s.foes]) Champ.totalGold[e] = START_GOLD + itemValue(sim, e);
    const lead = teamGold(sim, s, 0) - teamGold(sim, s, 1);
    for (const e of [s.me, ...s.allies]) Champ.totalGold[e] = Champ.totalGold[e]! + (BARON_CALL.goldLead - lead) / (1 + s.allies.length);
    s.n = { baronHp: 100, goldLead: Math.round(teamGold(sim, s, 0) - teamGold(sim, s, 1)), foeJglIn: 0, foesNear: 0, alliesDown: 0 };
  },
  shoveRecall(sim, s) {
    const g = laneGeo(sim, 0, Lane.Mid);
    const mid = g.len / 2;
    equip(sim, s.me, 8);
    grantGold(sim, s.me, SHOVE_RECALL.gold); // item gold in the pocket: the reason to recall
    place(sim, s.me, ...xy(lanePoint(g, mid - 500)));
    // both waves meet in the middle of the lane
    for (const [team, dir] of [[Team.Blue, -1], [Team.Red, 1]] as const) {
      spawnWave(sim, team, Lane.Mid, false, false).forEach((m, i) => putOnLane(sim, m, g, mid + dir * (150 + Math.floor(i / 3) * 70), ((i % 3) - 1) * 70));
    }
    scheduleNextWave(sim, sim.tick + sec(120));
    s.n = { foeMinions: 0, ownMinions: 0, lost: 0, recalls: 0, foeAtRecall: 0, ownAtRecall: 0 };
  },
};

/** Sum of earned gold of the player's team (team 0) or the enemy team (team 1). */
function teamGold(sim: Sim, s: ScenarioState, team: 0 | 1): number {
  const list = team === 0 ? [s.me, ...s.allies] : s.foes;
  let v = 0;
  for (const e of list) v += sim.c.Champ.totalGold[e]!;
  return v;
}

const xy = (p: Pt): [number, number] => [p.x, p.y];
const info = (s: ScenarioState): ScenarioInfo => SCENARIOS[s.id];

function putOnLane(sim: Sim, m: number, g: ReturnType<typeof laneGeo>, d: number, side: number): void {
  const a = lanePoint(g, d);
  const b = lanePoint(g, d + 50);
  const p = toward(a, b, 0, side);
  place(sim, m, p.x, p.y);
  setLanePath(sim, m);
}

/** Flash scenario: scripted ultimate shots (too wide to walk out of in time). */
const FLASH = { dist: 1450, width: 420, speed: 1800, every: sec(4), shots: 5 } as const;

// ---------------------------------------------------------------- update

const alive = (sim: Sim, e: number): boolean => e >= 0 && sim.c.Unit.alive[e] === 1;

function finish(sim: Sim, s: ScenarioState, won: boolean, why: string): void {
  if (s.end >= 0) return;
  s.end = sim.tick;
  s.result = won ? 'won' : 'lost';
  s.why = why;
}

export function updateScenario(sim: Sim, s: ScenarioState): void {
  if (s.end >= 0 || s.me < 0) return;
  if (s.hp.length) {
    for (const [e, pct] of s.hp) sim.c.Hp.cur[e] = Math.max(1, Math.round((sim.c.Hp.max[e]! * pct) / 100));
    s.hp = [];
  }
  const elapsed = sim.tick - s.start;
  const timeUp = elapsed >= s.limit;
  let meDied = !alive(sim, s.me);
  for (const ev of sim.events) {
    if (ev.e !== 'death') continue;
    if (ev.eid === s.me) meDied = true;
    if (ev.kind === Kind.Champion && ev.team === 1 && s.n.kills !== undefined && ev.killer === s.me) s.n.kills++;
  }
  UPDATE[s.id](sim, s, { meDied, timeUp });
}

interface Tick {
  meDied: boolean;
  timeUp: boolean;
}

const UPDATE: Record<ScenarioId, (sim: Sim, s: ScenarioState, k: Tick) => void> = {
  turret2v1(sim, s, k) {
    s.n.survive = Math.max(0, (s.limit - (sim.tick - s.start)) / 30);
    if (k.meDied) return finish(sim, s, false, 'died');
    if (k.timeUp) finish(sim, s, true, 'survived');
  },
  gankEscape(sim, s, k) {
    const t = outerTower(sim, 0);
    const d = dist(sim, s.me, t);
    s.n.distTower = Math.max(0, Math.round(d - (TOWER_RANGE - 150)));
    if (k.meDied) return finish(sim, s, false, 'died');
    if (d <= TOWER_RANGE - 150) return finish(sim, s, true, 'safe');
    if (k.timeUp) finish(sim, s, false, 'time');
  },
  towerDive(sim, s, k) {
    if (s.foe >= 0) s.n.foeHp = alive(sim, s.foe) ? Math.round((100 * sim.c.Hp.cur[s.foe]!) / Math.max(1, sim.c.Hp.max[s.foe]!)) : 0;
    const foeDied = s.foe >= 0 && !alive(sim, s.foe);
    if (k.meDied && !foeDied) return finish(sim, s, false, 'died');
    if (foeDied) return finish(sim, s, true, k.meDied ? 'trade' : 'kill');
    if (k.timeUp) finish(sim, s, false, 'time');
  },
  dragonSteal(sim, s, k) {
    const camp = jungleState(sim).camps.find((c) => c.id === 'leviathan');
    const drag = camp?.members[0]?.eid ?? -1;
    const { Hp, Unit } = sim.c;
    if (!s.ready && alive(sim, drag)) {
      s.ready = true;
      Hp.cur[drag] = Math.round(Hp.max[drag]! * 0.5);
      s.obj = drag;
      // the enemy jungler and support stand in the pit hitting the dragon
      for (const f of [s.foe, s.foe2]) {
        if (f < 0) continue;
        sim.c.Atk.target[f] = drag;
        sim.c.Atk.targetSerial[f] = sim.c.Unit.serial[drag]!;
        sim.c.Move.mode[f] = 2; // chase into range like an attack order
      }
      s.next = sim.tick + 30;
    }
    for (const ev of sim.events) {
      if (ev.e !== 'death' || ev.eid !== s.obj) continue;
      s.n.dragonHp = 0;
      const kt = ev.killer >= 0 ? Unit.team[ev.killer] : -1;
      return finish(sim, s, kt === 0, kt === 0 ? 'stolen' : 'lostDragon');
    }
    if (alive(sim, drag)) {
      s.n.dragonHp = Math.round((100 * Hp.cur[drag]!) / Math.max(1, Hp.max[drag]!));
      // the enemy team keeps hitting the dragon (scripted pressure, no aggro source so it never resets): ~50 % in 15 s
      if (sim.tick >= s.next && sim.tick - s.start > sec(2)) {
        s.next = sim.tick + 30;
        dealDamage(sim, -1, drag, Hp.max[drag]! / 50, 'true');
      }
      reveal(sim, 0, drag, 2); // the pit is warded: the player sees the dragon HP
    }
    if (k.meDied) return finish(sim, s, false, 'died');
    if (k.timeUp) finish(sim, s, false, 'time');
  },
  freezeWave(sim, s, k) {
    const { Unit, Champ } = sim.c;
    s.n.cs = Champ.cs[s.me]! - s.cs0;
    if (k.meDied) return finish(sim, s, false, 'died');
    if ((sim.tick - s.start) % 15 === 0) {
      const g = laneGeo(sim, 0, Lane.Mid);
      const t = outerTower(sim, 0);
      let front = Infinity;
      let inRange = false;
      for (const e of minionsOf(sim, Team.Red)) {
        const d = laneProgress(g, sim.c.Pos.x[e]!, sim.c.Pos.y[e]!);
        if (d < front) front = d;
        if (dist(sim, e, t) <= TOWER_RANGE + Unit.radius[e]!) inRange = true;
      }
      s.n.samples!++;
      if (inRange) s.n.towerHits!++;
      // frozen: enemy wave on the own half, outside tower range
      if (front !== Infinity && !inRange && front <= g.len / 2) s.n.good!++;
      s.n.freezePct = Math.round((100 * s.n.good!) / Math.max(1, s.n.samples!));
    }
    if (k.timeUp) {
      const ok = s.n.freezePct! >= 60 && s.n.cs! >= 6;
      finish(sim, s, ok, ok ? 'frozen' : s.n.cs! < 6 ? 'cs' : 'pushed');
    }
  },
  protectCarry(sim, s, k) {
    const { Hp } = sim.c;
    // both sides see every champion: a fight, not a fog duel
    for (const e of [s.me, s.ally, s.foe, s.foe2]) if (alive(sim, e)) reveal(sim, sim.c.Unit.team[e] === 0 ? 1 : 0, e, 2);
    s.n.carryHp = alive(sim, s.ally) ? Math.round((100 * Hp.cur[s.ally]!) / Math.max(1, Hp.max[s.ally]!)) : 0;
    s.n.foesDown = [s.foe, s.foe2].filter((f) => f >= 0 && !alive(sim, f)).length;
    if (s.ally >= 0 && !alive(sim, s.ally)) return finish(sim, s, false, 'carryDied');
    if ([s.foe, s.foe2].every((f) => f < 0 || !alive(sim, f))) return finish(sim, s, true, 'foesDown');
    if (k.timeUp) finish(sim, s, true, 'carrySafe');
  },
  flashUlt(sim, s, k) {
    const { Hp, Pos } = sim.c;
    // the player cannot die here: the HP bar shows the dodges left
    Hp.cur[s.me] = Math.max(1, (Hp.max[s.me]! * (FLASH.shots - s.n.hits!)) / FLASH.shots);
    if (k.timeUp || (s.n.shots! >= FLASH.shots && sim.tick >= s.next)) {
      s.n.dodged = s.n.shots! - s.n.hits!;
      return finish(sim, s, s.n.hits! <= 1, s.n.hits! <= 1 ? 'dodged' : 'hit');
    }
    if (sim.tick < s.next || s.n.shots! >= FLASH.shots) return;
    s.next = sim.tick + FLASH.every;
    // Flash is back for every shot
    const a = champAbil(sim, s.me);
    a.sumCdUntil.fill(0);
    const src = s.foe >= 0 ? posOf(sim, s.foe) : { x: Pos.x[s.me]! + FLASH.dist, y: Pos.y[s.me]! };
    const to = posOf(sim, s.me);
    const v = sub(to, src);
    const l = len(v) || 1;
    const payload: TrainerPayload = { t: 'trainer', flags: [], hit: [] };
    spawnProjectile(sim, { kind: 1, src: s.foe, team: Team.Red, x: src.x, y: src.y, dx: v.x / l, dy: v.y / l, speed: FLASH.speed, width: FLASH.width, maxDist: FLASH.dist + 900, payload });
    if (s.foe >= 0) sim.events.push({ e: 'cast', src: s.foe, slot: 3, x: to.x, y: to.y, rank: 1, at: sim.tick });
    s.n.shots!++;
    s.n.dodged = s.n.shots! - 1 - s.n.hits!;
  },
  waveCatch(sim, s, k) {
    const { Champ } = sim.c;
    const t = outerTower(sim, 0);
    const foeAlive = alive(sim, s.foe);
    if (foeAlive) reveal(sim, 0, s.foe, 2); // the jungler is on the minimap the whole time
    s.n.survive = Math.max(0, (s.limit - (sim.tick - s.start)) / 30);
    s.n.cs = Champ.cs[s.me]! - s.cs0;
    s.n.foeDist = foeAlive ? Math.round(dist(sim, s.foe, posOf(sim, s.me))) : 0;
    // exposed = outside the tower's cover while the jungler is close enough to jump
    if (alive(sim, s.me) && foeAlive && dist(sim, s.me, t) > TOWER_RANGE - 100 && s.n.foeDist! < WAVE_CATCH.jungleReach) s.n.exposedTicks!++;
    s.n.exposed = Math.floor(s.n.exposedTicks! / 30);
    if (k.meDied) return finish(sim, s, false, 'died');
    const resolved = sim.tick - s.start > sec(4) && minionsOf(sim, Team.Red).length === 0;
    if (!k.timeUp && !resolved) return;
    const ok = s.n.cs! >= WAVE_CATCH.csGoal;
    finish(sim, s, ok, !ok ? 'passive' : s.n.exposed! >= WAVE_CATCH.riskySec ? 'caughtRisky' : 'caught');
  },
  baronCall(sim, s, k) {
    const { Hp, Unit, Champ } = sim.c;
    const camp = jungleState(sim).camps.find((c) => c.id === 'schleierwaechter');
    const baron = camp?.members[0]?.eid ?? -1;
    if (!s.ready && alive(sim, baron)) {
      s.ready = true;
      s.obj = baron;
    }
    if (alive(sim, baron)) {
      reveal(sim, 0, baron, 2); // the pit is warded: HP bar visible
      s.n.baronHp = Math.round((100 * Hp.cur[baron]!) / Math.max(1, Hp.max[baron]!));
      // the allies hit the Schleierwaechter (passive champions get the order again when they lost the target)
      if (sim.tick % 30 === 0 && Hp.cur[baron]! > (Hp.max[baron]! * BARON_CALL.keepPct) / 100) {
        const dps = s.allies.filter((a) => alive(sim, a)).length * BARON_CALL.allyDps;
        if (dps > 0) dealDamage(sim, -1, baron, dps, 'true');
      }
      if (sim.tick % 15 === 0) {
        for (const a of s.allies) {
          if (!alive(sim, a) || sim.c.Atk.target[a] === baron) continue;
          sim.c.Atk.target[a] = baron;
          sim.c.Atk.targetSerial[a] = Unit.serial[baron]!;
          sim.c.Move.mode[a] = 2;
        }
      }
    }
    for (const ev of sim.events) if (ev.e === 'death' && ev.kind === Kind.Champion && ev.team === 0 && ev.eid !== s.me) s.n.alliesDown!++;
    s.n.goldLead = Math.round(teamGold(sim, s, 0) - teamGold(sim, s, 1));
    const jgl = s.foes[0] ?? -1;
    s.n.foeJglIn = jgl >= 0 && !alive(sim, jgl) ? Math.max(0, (Champ.respawnAt[jgl]! - sim.tick) / 30) : 0;
    let near = 0;
    for (const f of s.foes) if (alive(sim, f) && dist(sim, f, sim.map.objectives.schleierwaechter) < 2500) near++;
    // the enemy jungler is back: the team collapses on the pit (a shown threat, whatever the bots do on their own)
    if (jgl >= 0 && alive(sim, jgl) && s.next === 0 && sim.tick > s.start + 30) {
      s.next = sim.tick;
      s.foes.forEach((f, i) => alive(sim, f) && place(sim, f, ...xy(toward(sim.map.objectives.schleierwaechter, outerTower(sim, 1), BARON_CALL.collapseDist, (i - 1) * 450))));
    }
    s.n.foesNear = near;
    for (const ev of sim.events) {
      if (ev.e !== 'death' || ev.eid !== s.obj || s.obj < 0) continue;
      s.n.baronHp = 0;
      const kt = ev.killer >= 0 ? Unit.team[ev.killer] : -1;
      if (kt === 1) return finish(sim, s, false, 'baronStolen');
      if (kt === 0 && !k.meDied) return finish(sim, s, true, s.n.alliesDown! === 0 ? 'baronClean' : 'baronCost');
    }
    if (k.meDied) return finish(sim, s, false, 'died');
    if (k.timeUp) finish(sim, s, false, 'time');
  },
  shoveRecall(sim, s, k) {
    const { Champ } = sim.c;
    const foes = minionsOf(sim, Team.Red).length;
    const own = minionsOf(sim, Team.Blue).length;
    s.n.foeMinions = foes;
    s.n.ownMinions = own;
    // own minions that died since the recall began (the price of leaving the wave)
    if (s.next > 0) for (const ev of sim.events) if (ev.e === 'death' && ev.team === 0 && ev.kind >= Kind.MinionMelee && ev.kind <= Kind.MinionSuper) s.n.lost!++;
    if (k.meDied) return finish(sim, s, false, 'died');
    const recalling = Champ.recallAt[s.me]! > 0;
    const f = fountain(sim, 0);
    const home = dist(sim, s.me, f) <= f.r + 50;
    if (recalling && s.next === 0) {
      // recall started: remember how the wave looked (and restart the loss count)
      s.next = sim.tick;
      s.n.recalls!++;
      s.n.lost = 0;
      s.n.foeAtRecall = foes;
      s.n.ownAtRecall = own;
    } else if (!recalling && s.next > 0) {
      if (home) {
        const early = s.n.foeAtRecall! > SHOVE_RECALL.maxFoeAtRecall || s.n.ownAtRecall! < SHOVE_RECALL.minOwnAtRecall;
        const ok = !early && s.n.lost! <= SHOVE_RECALL.maxLost;
        return finish(sim, s, ok, early ? 'early' : ok ? 'shoved' : 'lostMinions');
      }
      s.next = 0; // recall cancelled (moved, damaged, CC): try again
    }
    if (k.timeUp) finish(sim, s, false, s.n.recalls! === 0 ? 'noRecall' : 'time');
  },
};

function minionsOf(sim: Sim, team: number): number[] {
  const out: number[] = [];
  const { Unit } = sim.c;
  for (const e of query(sim.world, [Unit])) {
    if (Unit.alive[e] !== 1 || Unit.team[e] !== team) continue;
    const k = Unit.kind[e]!;
    if (k >= Kind.MinionMelee && k <= Kind.MinionSuper) out.push(e);
  }
  return out;
}

/** A trainer projectile (flash scenario) hit unit `t` (called from dodge.ts trainerShotHit). */
export function scenarioShotHit(sim: Sim, t: number): void {
  const s = (sim.state.trainer as { scenario?: ScenarioState } | undefined)?.scenario;
  if (!s || s.id !== 'flashUlt' || s.end >= 0 || t !== s.me) return;
  s.n.hits!++;
  sim.events.push({ e: 'damage', src: s.foe, dst: t, amount: sim.c.Hp.max[t]! / FLASH.shots, type: 'true' });
}

// ---------------------------------------------------------------- HUD

export function scenarioHud(sim: Sim, s: ScenarioState): TrainerHud {
  const won = s.result === 'won';
  const hidden = new Set(['samples', 'good', 'exposedTicks', 'foeAtRecall', 'ownAtRecall']);
  const stats: TrainerHud['stats'] = Object.entries(s.n)
    .filter(([k]) => !hidden.has(k))
    .map(([k, v]) => ({ k: `sc_${k}`, v, fmt: k === 'survive' || k === 'foeJglIn' ? 'sec' : k.endsWith('Pct') || k.endsWith('Hp') ? 'pct' : 'int' }));
  const t = runSeconds(sim, s.start, s.end);
  // score: goals with a deadline (escape, dive, steal) score faster wins higher; survival goals are pass/fail
  const fast = s.id === 'gankEscape' || s.id === 'towerDive' || s.id === 'dragonSteal';
  const score = !won || s.end < 0 ? 0 : fast ? Math.max(50, Math.round(100 - (50 * (s.end - s.start)) / Math.max(1, s.limit))) : s.id === 'freezeWave' ? s.n.freezePct! : 100;
  const macro = !won || s.end < 0 ? 0 : s.id === 'waveCatch' ? waveCatchScore(s.n.cs!, s.n.exposed!) : s.id === 'baronCall' ? baronScore(s.end - s.start, s.limit, s.n.alliesDown!) : s.id === 'shoveRecall' ? shoveScore(s.n.lost!) : -1;
  return {
    kind: 'scenario',
    time: t,
    duration: s.limit / 30,
    done: s.end >= 0,
    ...(s.end >= 0 ? { won } : {}),
    score: macro >= 0 ? macro : score,
    grade: s.end < 0 ? '' : won ? grade(macro >= 0 ? macro : score) : 'D',
    stats,
    scenario: s.id,
    ...(s.why ? { why: s.why } : {}),
  };
}
