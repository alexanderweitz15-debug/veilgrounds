// Headless match probe (A2 bug hunt, Wave 0): plays complete bot matches and checks invariants every tick.
// npx tsx tools/bughunt/matchProbe.ts --seed=1 [--rank=gold] [--minutes=45] [--brain=new] [--variance=0]
// Wraps console.warn/error (everything is collected, not printed), catches thrown exceptions per match and checks:
// non-finite / out-of-map positions and stats, negative HP while alive, dead champions acting, wrong respawn timer
// (expected: DEATH_BASE by level at death, economy.deathTimerTicks), respawn state reset (position, HP, orders), gold /
// xp / level anomalies, stuck entities with an order, idle champions (no order, not recalling, not in the fountain),
// ward invariants (cap, expiry). Output format of tools/botSim.ts is untouched; this tool is separate.

import { query } from 'bitecs';
import { botGameConfig } from '../../src/ai/runner';
import { runBotGame } from '../../src/ai/harness';
import { BUILDS } from '../../src/ai/bot/builds';
import sevBuild from '../../src/data/builds/sev.json';
import type { Rank } from '../../src/ai/profiles/schema';
import type { Sim } from '../../src/sim/sim';
import { Kind } from '../../src/sim/types';
import { CUM_XP, MAX_LEVEL, deathTimerTicks } from '../../src/sim/systems/economy';
import { channelOf, isBusy } from '../../src/sim/systems/abilities';
import { walkable } from '../../src/sim/map';
import { wardsOf } from '../../src/sim/wards';
import { buffs } from '../../src/sim/buffs';

BUILDS.sev ??= sevBuild as (typeof BUILDS)[string];

declare const process: { argv: string[]; stdout: { write(s: string): void } };
declare const console: { warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k!, v ?? 'true'] as const;
  }),
);
const seed = Number(args.get('seed') ?? 1);
const rank = (args.get('rank') ?? 'gold') as Rank;
const minutes = Number(args.get('minutes') ?? 45);
const newBrain = args.get('brain') === 'new';
const noVariance = args.get('variance') === '0';

interface Finding {
  key: string;
  first: number;
  count: number;
  sample: string;
}
const findings = new Map<string, Finding>();
const note = (tick: number, key: string, sample: string): void => {
  const f = findings.get(key);
  if (f) f.count++;
  else findings.set(key, { key, first: tick, count: 1, sample });
};

const logs: string[] = [];
const origWarn = console.warn;
const origError = console.error;
console.warn = (...a) => logs.push('warn: ' + a.map(String).join(' '));
console.error = (...a) => logs.push('error: ' + a.map(String).join(' '));

const fmtT = (t: number): string => `${Math.floor(t / 1800)}:${String(Math.floor((t / 30) % 60)).padStart(2, '0')}`;
const finite = (n: number): boolean => Number.isFinite(n);

interface CTrack {
  alive: boolean;
  deathTick: number;
  deathLevel: number;
  gold: number;
  totalGold: number;
  xp: number;
  lastX: number;
  lastY: number;
  stillSince: number;
  idleSince: number;
  maxIdle: number;
  idleTotal: number;
  maxStuck: number;
  deadX: number;
  deadY: number;
}
const tracks = new Map<number, CTrack>();
const unitStill = new Map<number, { x: number; y: number; since: number; serial: number }>();
const wardBorn = new Map<number, number>();
const respawnedAt = new Map<number, number>();
const stuckEids = new Set<number>();

function check(sim: Sim, inputs: { slot: number; cmd: { t: string } }[]): void {
  const { Pos, Unit, Hp, Mana, Stats, Champ, Move, Atk } = sim.c;
  const T = sim.tick;
  for (const e of query(sim.world, [Unit, Pos, Hp])) {
    const k = Unit.kind[e]!;
    if (k === Kind.Projectile) continue;
    const alive = !!Unit.alive[e];
    const tag = `${k === Kind.Champion ? sim.championIds[Unit.champ[e]!] : 'kind' + k}#${e}`;
    if (!finite(Pos.x[e]!) || !finite(Pos.y[e]!)) note(T, `nonfinite-pos kind${k}`, `${tag} at ${fmtT(T)}`);
    else if (alive && (Pos.x[e]! < 0 || Pos.y[e]! < 0 || Pos.x[e]! > 16000 || Pos.y[e]! > 16000)) note(T, `out-of-map kind${k}`, `${tag} ${Pos.x[e]},${Pos.y[e]} at ${fmtT(T)}`);
    if (!finite(Hp.cur[e]!) || !finite(Hp.max[e]!) || !finite(Hp.shield[e]!)) note(T, `nonfinite-hp kind${k}`, `${tag} ${Hp.cur[e]}/${Hp.max[e]}/${Hp.shield[e]} at ${fmtT(T)}`);
    else if (alive && Hp.cur[e]! <= 0 && Hp.max[e]! > 0 && k !== Kind.Dummy) note(T, `alive-with-hp<=0 kind${k}`, `${tag} hp ${Hp.cur[e]} at ${fmtT(T)}`);
    else if (alive && Hp.cur[e]! > Hp.max[e]! + 1e-6) note(T, `hp>max kind${k}`, `${tag} ${Hp.cur[e]}/${Hp.max[e]} at ${fmtT(T)}`);
    if (alive) {
      for (const key of ['ad', 'ap', 'armor', 'mr', 'as', 'range', 'ms', 'crit', 'haste', 'tenacity'] as const) {
        const v = Stats[key][e]!;
        if (!finite(v)) note(T, `nonfinite-stat ${key} kind${k}`, `${tag} ${key}=${v} at ${fmtT(T)}`);
      }
      if (k === Kind.Champion && (Stats.ms[e]! < 0 || Stats.as[e]! <= 0)) note(T, 'bad-stat ms/as champion', `${tag} ms=${Stats.ms[e]} as=${Stats.as[e]} at ${fmtT(T)}`);
      if (!finite(Mana.cur[e]!) || Mana.cur[e]! < -1e-6) note(T, `bad-mana kind${k}`, `${tag} mana ${Mana.cur[e]} at ${fmtT(T)}`);
    }
    // stuck non-champions (walking a path / chasing, no CC): minions and monsters
    const tg0 = Atk.target[e]!;
    const inReach = Move.mode[e] === 2 && tg0 >= 0 && Math.hypot(Pos.x[tg0]! - Pos.x[e]!, Pos.y[tg0]! - Pos.y[e]!) <= Stats.range[e]! + Unit.radius[e]! + Unit.radius[tg0]! + 5;
    if (alive && k !== Kind.Champion && (Move.mode[e] === 1 || (Move.mode[e] === 2 && !inReach)) && Stats.ms[e]! > 0 && Unit.team[e] !== 2) {
      let u = unitStill.get(e);
      if (u && u.serial !== Unit.serial[e]) u = undefined; // eid recycled
      const d = u ? Math.hypot(Pos.x[e]! - u.x, Pos.y[e]! - u.y) : 1e9;
      if (!u || d > 25 || Atk.phase[e] !== 0) {
        if (u && T - u.since >= 600) note(T, `stuck minion/monster resolved kind${k}`, `${tag} was still for ${((T - u.since) / 30).toFixed(1)}s, resolved ${fmtT(T)} at ${Math.round(Pos.x[e]!)},${Math.round(Pos.y[e]!)}`);
        unitStill.set(e, { x: Pos.x[e]!, y: Pos.y[e]!, since: T, serial: Unit.serial[e]! });
      }
      else if (T - u.since === 300) {
        const tg = Atk.target[e]!;
        const tgs = tg >= 0 ? `target kind${Unit.kind[tg]} alive ${Unit.alive[tg]} at ${Math.round(Pos.x[tg]!)},${Math.round(Pos.y[tg]!)} d ${Math.round(Math.hypot(Pos.x[tg]! - Pos.x[e]!, Pos.y[tg]! - Pos.y[e]!))} r ${Unit.radius[tg]} untargetable ${Unit.untargetable[tg]} targetTeam ${Unit.team[tg]} ownTeam ${Unit.team[e]} serialOk ${Atk.targetSerial[e] === Unit.serial[tg]} atkPhase ${Atk.phase[e]} nextReady ${Atk.nextReady[e]} tick ${T} ownBuffs [${buffs(sim, e).map((b) => b.kind + ':' + b.id).join(',')}] ms ${Stats.ms[e]}` : 'no target';
        stuckEids.add(e);
        console.warn = origWarn;
        process.stdout.write(`STUCK exact: eid ${e} tick ${T} pos ${Pos.x[e]},${Pos.y[e]} face ${sim.c.Face.x[e]},${sim.c.Face.y[e]} radius ${Unit.radius[e]} wp ${JSON.stringify(sim.paths.get(e))} move ${Move.tx[e]},${Move.ty[e]} pathIdx ${Move.pathIdx[e]} atk.nextReady ${Atk.nextReady[e]}\n`);
        console.warn = (...a) => logs.push('warn: ' + a.map(String).join(' '));
        const near: string[] = [];
        for (const o of query(sim.world, [Unit, Pos])) if (o !== e && Unit.alive[o] && Math.hypot(Pos.x[o]! - Pos.x[e]!, Pos.y[o]! - Pos.y[e]!) < 250) near.push(`kind${Unit.kind[o]}/team${Unit.team[o]}@${Math.round(Pos.x[o]!)},${Math.round(Pos.y[o]!)}`);
        note(T, `stuck>10s kind${k}`, `${tag} team ${Unit.team[e]} lane ${Unit.lane[e]} near [${near.join(' ')}] path ${JSON.stringify(sim.paths.get(e)?.slice(0, 3).map((p) => [Math.round(p.x), Math.round(p.y)]))} at ${Math.round(Pos.x[e]!)},${Math.round(Pos.y[e]!)} mode ${Move.mode[e]} pathLen ${sim.paths.get(e)?.length} ${tgs} range ${Stats.range[e]} walkable ${walkable(sim.map.nav, Pos.x[e]!, Pos.y[e]!)} ${fmtT(T)}`);
      }
    }
    if (k === Kind.Ward && alive && !wardBorn.has(Unit.serial[e]!)) wardBorn.set(Unit.serial[e]!, T);
  }
  // champions
  for (const e of query(sim.world, [Champ, Unit])) {
    if (Unit.kind[e] !== Kind.Champion) continue;
    const slot = Unit.slot[e]!;
    const name = `${sim.championIds[Unit.champ[e]!]}(slot ${slot})`;
    let t = tracks.get(e);
    const alive = !!Unit.alive[e];
    if (!t) {
      t = { alive, deathTick: -1, deathLevel: 0, gold: Champ.gold[e]!, totalGold: Champ.totalGold[e]!, xp: Champ.xp[e]!, lastX: Pos.x[e]!, lastY: Pos.y[e]!, stillSince: T, idleSince: T, maxIdle: 0, idleTotal: 0, maxStuck: 0, deadX: 0, deadY: 0 };
      tracks.set(e, t);
    }
    // economy anomalies
    const g = Champ.gold[e]!;
    if (!finite(g) || g < -1e-6) note(T, 'gold<0/NaN', `${name} gold ${g} at ${fmtT(T)}`);
    if (Champ.totalGold[e]! < t.totalGold - 1e-6) note(T, 'totalGold decreased', `${name} ${t.totalGold} -> ${Champ.totalGold[e]} at ${fmtT(T)}`);
    if (Champ.xp[e]! < t.xp - 1e-6 || !finite(Champ.xp[e]!)) note(T, 'xp decreased/NaN', `${name} ${t.xp} -> ${Champ.xp[e]} at ${fmtT(T)}`);
    if (g > 6000) note(T, 'gold>6000 unspent', `${name} gold ${g} at ${fmtT(T)}`);
    const lvl = Champ.level[e]!;
    let lvlFromXp = 1;
    for (let i = 2; i <= MAX_LEVEL; i++) if (Champ.xp[e]! >= CUM_XP[i]!) lvlFromXp = i;
    if (lvl !== lvlFromXp) note(T, 'level != level from xp', `${name} level ${lvl}, xp ${Champ.xp[e]} implies ${lvlFromXp} at ${fmtT(T)}`);
    t.totalGold = Champ.totalGold[e]!;
    t.xp = Champ.xp[e]!;
    // death / respawn
    if (t.alive && !alive) {
      t.deathTick = T;
      t.deathLevel = lvl;
      t.deadX = Pos.x[e]!;
      t.deadY = Pos.y[e]!;
      const expect = deathTimerTicks(lvl, T);
      const got = Champ.respawnAt[e]! - T;
      if (Math.abs(got - expect) > 1) note(T, 'respawn timer wrong at death', `${name} level ${lvl}: respawnAt-T = ${got}, expected ${expect} at ${fmtT(T)}`);
      if (Champ.respawnAt[e]! <= 0) note(T, 'respawnAt not set at death', `${name} at ${fmtT(T)}`);
    }
    if (!alive) {
      if (Pos.x[e] !== t.deadX || Pos.y[e] !== t.deadY) note(T, 'dead champion moved', `${name} at ${fmtT(T)}`);
      if (Move.mode[e] !== 0) note(T, 'info: dead champion keeps Move.mode (reset on respawn)', `${name} mode ${Move.mode[e]} at ${fmtT(T)}`);
      if (Atk.phase[e] !== 0) note(T, 'dead champion in attack phase', `${name} phase ${Atk.phase[e]} at ${fmtT(T)}`);
      if (Champ.recallAt[e]! > 0) note(T, 'dead champion recalling', `${name} at ${fmtT(T)}`);
      for (const i of inputs) if (i.slot === slot && ['move', 'attack', 'attackMove', 'cast', 'spell', 'recall', 'ward', 'item'].includes(i.cmd.t)) note(T, `bot sent ${i.cmd.t} while dead`, `${name} at ${fmtT(T)}`);
      if (channelOf(sim, e)) note(T, 'dead champion channeling', `${name} at ${fmtT(T)}`);
    }
    if (!t.alive && alive) {
      respawnedAt.set(e, T);
      const f = sim.map.sides[Unit.team[e]!]!.fountain;
      const want = t.deathTick + deathTimerTicks(t.deathLevel, t.deathTick);
      if (Math.abs(T - want) > 2) note(T, 'respawn tick off', `${name}: respawned at ${T}, expected ${want} (level ${t.deathLevel}) ${fmtT(T)}`);
      if (Math.hypot(Pos.x[e]! - f.x, Pos.y[e]! - f.y) > 60) note(T, 'respawn not at fountain', `${name} at ${Pos.x[e]},${Pos.y[e]} ${fmtT(T)}`);
      if (Hp.cur[e]! < Hp.max[e]! - 1e-6) note(T, 'respawn hp not full', `${name} ${Hp.cur[e]}/${Hp.max[e]} ${fmtT(T)}`);
      if (Atk.target[e] !== -1 || Atk.attackMove[e]) note(T, 'respawn kept attack order', `${name} ${fmtT(T)}`);
      if (isBusy(sim, e) || channelOf(sim, e)) note(T, 'respawn still busy/channeling', `${name} ${fmtT(T)}`);
      if (buffs(sim, e).some((b) => b.kind === 'stun') || Stats.ms[e] === 0) note(T, 'respawn with CC / ms 0', `${name} ms ${Stats.ms[e]} buffs [${buffs(sim, e).map((b) => b.kind + ':' + b.id + ':' + b.until).join(',')}] ${fmtT(T)}`);
    }
    t.alive = alive;
    if (alive && t.deathTick >= 0 && T - 3 >= 0 && T === respawnedAt.get(e)! + 3 && (Stats.ms[e] === 0 || !finite(Stats.ms[e]!))) note(T, 'ms still 0 three ticks after respawn', `${name} ms ${Stats.ms[e]} busy ${isBusy(sim, e)} buffs [${buffs(sim, e).map((b) => b.kind + ':' + b.id + ':' + b.until).join(',')}] ${fmtT(T)}`);
    if (!alive) continue;
    // stuck with an order (walking/chasing, no CC, not attacking)
    const moved = Math.hypot(Pos.x[e]! - t.lastX, Pos.y[e]! - t.lastY);
    if (moved > 8 || Atk.phase[e] !== 0 || isBusy(sim, e) || Move.mode[e] === 0 || Stats.ms[e] === 0) {
      t.lastX = Pos.x[e]!;
      t.lastY = Pos.y[e]!;
      t.stillSince = T;
    } else if (T - t.stillSince >= 150) {
      const dur = (T - t.stillSince) / 30;
      if (dur > t.maxStuck) t.maxStuck = dur;
      if (T - t.stillSince === 150) note(T, 'champion stuck >5s with a move order', `${name} at ${Math.round(Pos.x[e]!)},${Math.round(Pos.y[e]!)} mode ${Move.mode[e]} pathIdx ${Move.pathIdx[e]} pathLen ${sim.paths.get(e)?.length} target (${Move.tx[e]!.toFixed(0)},${Move.ty[e]!.toFixed(0)}) atkTarget ${Atk.target[e]} ms ${Stats.ms[e]} buffs [${buffs(sim, e).map((b) => b.kind + ':' + b.id).join(',')}] ${fmtT(T)}`);
    }
    // idle: no order, standing, not recalling, not in fountain, not attacking
    const f = sim.map.sides[Unit.team[e]!]!.fountain;
    const inFountain = Math.hypot(Pos.x[e]! - f.x, Pos.y[e]! - f.y) <= f.r;
    const idle = Move.mode[e] === 0 && Atk.phase[e] === 0 && Atk.target[e] === -1 && Champ.recallAt[e] === 0 && !isBusy(sim, e) && !inFountain && T > 105 * 30;
    if (idle) {
      t.idleTotal++;
      if (T - t.idleSince > t.maxIdle) t.maxIdle = T - t.idleSince;
    } else t.idleSince = T;
  }
  // wards: caps, expiry
  for (const team of [0, 1]) {
    const perOwner = new Map<number, number>();
    for (const x of wardsOf(sim, team)) {
      if (x.type === 'veil') perOwner.set(x.owner, (perOwner.get(x.owner) ?? 0) + 1);
      const born = wardBorn.get(sim.c.Unit.serial[x.eid]!);
      if (x.type === 'veil' && born !== undefined && T - born > 90 * 30 + 3) note(T, 'veil ward outlived 90s', `eid ${x.eid} age ${(T - born) / 30}s ${fmtT(T)}`);
    }
    for (const [o, n] of perOwner) if (n > 3) note(T, 'more than 3 veil wards per player', `owner ${o}: ${n} ${fmtT(T)}`);
  }
}

const config = botGameConfig(seed, rank);
if (newBrain) config.botUtility = true;
const t0 = Date.now();
let result: ReturnType<typeof runBotGame> | undefined;
let thrown: string | undefined;
try {
  result = runBotGame(config, Math.round(minutes * 60 * 30), (sim, inputs) => check(sim, inputs), { noVariance, reflex: newBrain });
} catch (e) {
  thrown = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
}
console.warn = origWarn;
console.error = origError;
const out: string[] = [];
out.push(`# probe seed=${seed} rank=${rank} brain=${newBrain ? 'new' : 'default'} variance=${noVariance ? 0 : 'normal'} wall=${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (result) {
  const r = result;
  out.push(`result: winner=${r.winner} minutes=${r.minutes.toFixed(1)} ticks=${r.ticks} hash=${r.hash} kills15=${r.killsAt15} firstTower=${r.firstTowerMin?.toFixed(1)} towers=${r.towersTaken}`);
  for (const s of r.stats) {
    const tr = [...tracks.entries()].find(([e]) => r.sim.c.Unit.slot[e] === s.slot)?.[1];
    out.push(
      `  slot ${s.slot} ${s.team === 0 ? 'B' : 'R'} ${s.role.padEnd(7)} ${s.champion.padEnd(10)} K/D ${s.kills}/${s.deaths} cs ${s.cs} maxIdleS(harness) ${s.maxIdleS.toFixed(1)} probeMaxIdleS ${((tr?.maxIdle ?? 0) / 30).toFixed(1)} idleTotalS ${((tr?.idleTotal ?? 0) / 30).toFixed(0)} maxStuckS ${tr?.maxStuck.toFixed(1)}`,
    );
  }
}
if (result) {
  const { Pos, Unit, Move, Atk, Stats, Hp } = result.sim.c;
  for (const e of stuckEids) out.push(`final state of once-stuck eid ${e}: alive ${Unit.alive[e]} kind ${Unit.kind[e]} team ${Unit.team[e]} pos ${Pos.x[e]!.toFixed(0)},${Pos.y[e]!.toFixed(0)} mode ${Move.mode[e]} atk phase ${Atk.phase[e]} target ${Atk.target[e]} ms ${Stats.ms[e]} hp ${Hp.cur[e]!.toFixed(0)} path ${JSON.stringify(result.sim.paths.get(e)?.slice(0, 2))}`);
}
if (thrown) out.push('EXCEPTION: ' + thrown);
out.push(`console output lines: ${logs.length}`);
const uniq = new Map<string, number>();
for (const l of logs) uniq.set(l, (uniq.get(l) ?? 0) + 1);
for (const [l, n] of uniq) out.push(`  [${n}x] ${l.slice(0, 300)}`);
out.push(`findings: ${findings.size}`);
for (const f of [...findings.values()].sort((a, b) => a.first - b.first)) out.push(`  [${f.count}x first ${fmtT(f.first)}] ${f.key}: ${f.sample}`);
process.stdout.write(out.join('\n') + '\n');
