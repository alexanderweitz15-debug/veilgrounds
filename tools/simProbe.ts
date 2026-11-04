// npm run sim-probe -- --games=3 --minutes=30 --seed=1 --rank=gold [--offset=0] [--brain=new] [--champions=fenna,sev,...]
// Headless bot games with per-tick invariant checks (NaN/Infinity, outside map, in walls, dead units acting, negative
// gold/mana, stuck cooldowns/casts, buffs that never expire, stuck minions, idle champions, structure respawns, leaks,
// exceptions). One line per violation class and game; the first occurrence carries tick / eid / context.
// Champions rotate: game g takes the g-th slice of each role pool, so every champion shows up after a few games.

import { query } from 'bitecs';
import { RANKS, type Rank } from '../src/ai/profiles/schema';
import { botGameConfig, championsForRole } from '../src/ai/runner';
import { runBotGame } from '../src/ai/harness';
import { BUILDS } from '../src/ai/bot/builds';
import sevBuild from '../src/data/builds/sev.json';
import { champAbil } from '../src/sim/systems/abilities';
import { towerState, INHIB_RESPAWN } from '../src/sim/systems/towers';
import { buffState } from '../src/sim/buffs';
import { MAP_SIZE, walkable } from '../src/sim/map';
import { Kind, isMinion, isStructure, type SimConfig } from '../src/sim/types';
import type { Sim } from '../src/sim/sim';

BUILDS.sev ??= sevBuild as (typeof BUILDS)[string];
declare const process: { argv: string[]; stdout: { write(s: string): void } };

const args = new Map(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k!, v ?? 'true'] as const; }));
const rank = (args.get('rank') ?? 'gold') as Rank;
if (!RANKS.includes(rank)) throw new Error('rank');
const games = Number(args.get('games') ?? 3);
const minutes = Number(args.get('minutes') ?? 30);
const seed0 = Number(args.get('seed') ?? 1);
const offset = Number(args.get('offset') ?? 0);
const forced = (args.get('champions') ?? '').split(',').filter(Boolean);
const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'] as const;

const out = (s: string): void => void process.stdout.write(s + '\n');

function config(g: number): SimConfig {
  const seed = seed0 + g;
  const c = botGameConfig(seed, rank);
  const taken = new Set<string>();
  const want = [...forced];
  for (const team of [0, 1]) {
    ROLES.forEach((role, i) => {
      const p = c.players[team * 5 + i]!;
      const pool = championsForRole(role);
      let pick = want.find((w) => pool.includes(w) && !taken.has(w));
      if (pick) want.splice(want.indexOf(pick), 1);
      else {
        for (let k = 0; k < pool.length; k++) {
          const cand = pool[(g + offset + k + team * 3) % pool.length]!;
          if (!taken.has(cand)) { pick = cand; break; }
        }
      }
      if (pick) { p.champion = pick; taken.add(pick); }
    });
  }
  if (args.get('brain') === 'new') c.botUtility = true;
  return c;
}

interface Hit { n: number; first: string }
const SEC = 30;

function probe(g: number): void {
  const cfg = config(g);
  const hits = new Map<string, Hit>();
  const flag = (k: string, detail: string, tick: number): void => {
    const h = hits.get(k);
    if (h) h.n++;
    else hits.set(k, { n: 1, first: `t=${tick} (${(tick / SEC / 60).toFixed(1)} min) ${detail}` });
  };
  let sim0: Sim | undefined;
  let lastTick = 0;
  const wall = new Map<number, number>();
  const anchor = new Map<number, { x: number; y: number; t: number; flagged: boolean }>();
  const idleA = new Map<number, { x: number; y: number; t: number; flagged: boolean }>();
  const deadSince = new Map<number, number>();
  const prevDeadPos = new Map<number, [number, number]>();
  const unt = new Map<number, number>();
  const inv = new Map<number, number>();
  const prevCs = new Map<number, number>();
  const prevLevel = new Map<number, number>();
  const prevTotal = new Map<number, number>();
  const structPrev = new Map<number, { alive: boolean; hp: number; deadAt: number }>();
  const tgtDead = new Map<number, number>();
  const bufSeen = new Set<string>();
  let maxEnt = 0;
  const sizes: { t: number; ents: number; buffs: number; payloads: number; zones: number }[] = [];
  const t0 = Date.now();
  let res;
  try {
    res = runBotGame(cfg, Math.round(minutes * 60 * SEC), (sim, _inputs, bots) => {
      sim0 = sim;
      lastTick = sim.tick;
      const T = sim.tick;
      const { Pos, Unit, Hp, Mana, Stats, Champ, Atk, Move } = sim.c;
      const modeOf = (slot: number): string => bots.bots.find((b) => b.ctx.slot === slot)?.mem.mode ?? '?';
      const active = new Set<number>();
      for (const e of sim.events) {
        if (e.e === 'attack' || e.e === 'damage' || e.e === 'cast') active.add(e.src);
      }
      let ents = 0;
      for (const eid of query(sim.world, [Unit, Pos, Hp])) {
        ents++;
        const k = Unit.kind[eid]!;
        const alive = Unit.alive[eid] === 1;
        const tag = `eid=${eid} kind=${k} team=${Unit.team[eid]}${k === Kind.Champion ? ` ${sim.championIds[Unit.champ[eid]!]}` : ''}`;
        const x = Pos.x[eid]!, y = Pos.y[eid]!;
        if (k === Kind.Projectile) continue;
        if (!Number.isFinite(x) || !Number.isFinite(y)) flag('nan_pos', tag, T);
        const nums: [string, number][] = [['hp', Hp.cur[eid]!], ['hpmax', Hp.max[eid]!], ['shield', Hp.shield[eid]!], ['mana', Mana.cur[eid]!], ['manamax', Mana.max[eid]!]];
        for (const [n, v] of nums) if (!Number.isFinite(v)) flag(`nan_${n}`, tag, T);
        for (const key of Object.keys(Stats) as (keyof typeof Stats)[]) if (!Number.isFinite(Stats[key][eid]!)) flag(`nan_stat_${key}`, tag, T);
        if (!alive) {
          if (k !== Kind.Champion) flag('zombie_entity', `${tag} (dead non-champion left in world)`, T);
          else {
            if (Atk.phase[eid] !== 0 && T - (deadSince.get(eid) ?? T) > 5) flag('dead_champ_attacking', tag, T);
            const pp = prevDeadPos.get(eid);
            if (pp && deadSince.has(eid) && T - deadSince.get(eid)! > 2 && (pp[0] !== x || pp[1] !== y) && Math.abs(Champ.respawnAt[eid]! - T) > 2) flag('dead_champ_moved', `${tag} ${pp} -> ${x},${y}`, T);
            if (!deadSince.has(eid)) deadSince.set(eid, T);
            prevDeadPos.set(eid, [x, y]);
            const ra = Champ.respawnAt[eid]!;
            if (T > ra + 5 && ra > 0) flag('stuck_dead', `${tag} respawnAt=${ra}`, T);
            if (ra - T > 120 * SEC) flag('long_respawn', `${tag} respawn in ${((ra - T) / SEC).toFixed(0)} s`, T);
          }
          continue;
        }
        deadSince.delete(eid);
        if (x < 0 || y < 0 || x >= MAP_SIZE || y >= MAP_SIZE) flag('outside_map', `${tag} ${x.toFixed(0)},${y.toFixed(0)}`, T);
        if (Hp.cur[eid]! <= 0 && (k === Kind.Champion || isMinion(k) || k === Kind.Monster || k === Kind.Pet)) {
          const w = (tgtDead.get(eid) ?? 0) + 1;
          tgtDead.set(eid, w);
          if (w > 3) flag('alive_hp_le0', `${tag} hp=${Hp.cur[eid]}`, T);
        } else tgtDead.delete(eid);
        if (Hp.cur[eid]! > Hp.max[eid]! + 1e-6) flag('hp_over_max', `${tag} ${Hp.cur[eid]}>${Hp.max[eid]}`, T);
        if (Hp.shield[eid]! < -1e-9) flag('neg_shield', `${tag} ${Hp.shield[eid]}`, T);
        if (Mana.cur[eid]! < -1e-6) flag('neg_mana', `${tag} ${Mana.cur[eid]}`, T);
        if (Mana.cur[eid]! > Mana.max[eid]! + 1e-6) flag('mana_over_max', `${tag} ${Mana.cur[eid]}>${Mana.max[eid]}`, T);
        if (Stats.ms[eid]! < 0 || Stats.ms[eid]! > 2500) flag('ms_range', `${tag} ms=${Stats.ms[eid]}`, T);
        if (Stats.as[eid]! < 0 || Stats.as[eid]! > 12) flag('as_range', `${tag} as=${Stats.as[eid]}`, T);
        if (Stats.range[eid]! < 0 || Stats.range[eid]! > 4000) flag('range_range', `${tag} range=${Stats.range[eid]}`, T);
        if (Stats.armor[eid]! < -400 || Stats.mr[eid]! < -400) flag('armor_range', `${tag} armor=${Stats.armor[eid]} mr=${Stats.mr[eid]}`, T);
        // wall
        if (k === Kind.Champion || isMinion(k) || k === Kind.Monster) {
          if (Number.isFinite(x) && !walkable(sim.map.nav, x, y)) {
            const w = (wall.get(eid) ?? 0) + 1;
            wall.set(eid, w);
            if (w === 60) flag('in_wall_2s', `${tag} ${x.toFixed(0)},${y.toFixed(0)} mode=${Move.mode[eid]}`, T);
          } else wall.delete(eid);
        }
        // attack on dead target
        if (Atk.phase[eid] === 1 && Atk.target[eid]! >= 0) {
          const tg = Atk.target[eid]!;
          if (Unit.serial[tg] !== Atk.targetSerial[eid] || !Unit.alive[tg]) {
            const w = (tgtDead.get(-eid - 1) ?? 0) + 1;
            tgtDead.set(-eid - 1, w);
            if (w === 20) flag('windup_on_dead_target', tag, T);
          } else tgtDead.delete(-eid - 1);
        }
        if (k === Kind.Champion) {
          const slot = Unit.slot[eid]!;
          if (Champ.gold[eid]! < -1e-6) flag('neg_gold', `${tag} ${Champ.gold[eid]}`, T);
          if (!Number.isFinite(Champ.gold[eid]!) || !Number.isFinite(Champ.xp[eid]!) || !Number.isFinite(Champ.totalGold[eid]!)) flag('nan_econ', tag, T);
          if ((prevLevel.get(eid) ?? 0) > Champ.level[eid]!) flag('level_down', tag, T);
          if ((prevCs.get(eid) ?? 0) > Champ.cs[eid]!) flag('cs_down', tag, T);
          if ((prevTotal.get(eid) ?? 0) > Champ.totalGold[eid]! + 1e-6) flag('totalgold_down', tag, T);
          prevLevel.set(eid, Champ.level[eid]!);
          prevCs.set(eid, Champ.cs[eid]!);
          prevTotal.set(eid, Champ.totalGold[eid]!);
          if (Champ.level[eid]! < 1 || Champ.level[eid]! > 18) flag('level_range', `${tag} ${Champ.level[eid]}`, T);
          const a = champAbil(sim, eid);
          for (let i = 0; i < 4; i++) {
            if (!Number.isFinite(a.cdUntil[i]!)) flag('nan_cd', `${tag} slot ${i}`, T);
            else if (a.cdUntil[i]! - T > 300 * SEC) flag('cd_stuck', `${tag} slot ${i} ${((a.cdUntil[i]! - T) / SEC).toFixed(0)} s`, T);
          }
          for (let i = 0; i < 2; i++) if (a.sumCdUntil[i]! - T > 600 * SEC) flag('sumcd_stuck', `${tag} ${a.sums[i]} ${((a.sumCdUntil[i]! - T) / SEC).toFixed(0)} s`, T);
          if (a.channel && a.channel.until < T - 30) flag('channel_stuck', `${tag} slot ${a.channel.slot} until ${a.channel.until}`, T);
          const c = a.cast as unknown as { end?: number; endTick?: number; at?: number; slot?: number } | null;
          if (c) {
            const end = c.end ?? c.endTick ?? c.at;
            if (end !== undefined && end < T - 60) flag('cast_stuck', `${tag} slot ${c.slot} end ${end}`, T);
          }
          // untargetable / invulnerable flags stuck
          if (Unit.untargetable[eid]) { const w = (unt.get(eid) ?? 0) + 1; unt.set(eid, w); if (w === 20 * SEC) flag('untargetable_20s', `${tag} pos=${x.toFixed(0)},${y.toFixed(0)}`, T); } else unt.delete(eid);
          if (Unit.invulnerable[eid]) { const w = (inv.get(eid) ?? 0) + 1; inv.set(eid, w); if (w === 20 * SEC) flag('invulnerable_20s', `${tag} pos=${x.toFixed(0)},${y.toFixed(0)}`, T); } else inv.delete(eid);
          // idle > 20 s
          const busy = active.has(eid) || a.cast || a.channel || Champ.recallAt[eid]! > 0 || Move.mode[eid] !== 0 && false;
          const an = idleA.get(eid);
          const moved = an ? Math.hypot(x - an.x, y - an.y) : 1e9;
          if (!an || moved > 30 || busy) idleA.set(eid, { x, y, t: T, flagged: false });
          else if (T - an.t >= 20 * SEC && !an.flagged) {
            an.flagged = true;
            const hpFrac = Hp.cur[eid]! / Hp.max[eid]!;
            flag('champ_idle_20s', `${tag} slot=${slot} pos=${x.toFixed(0)},${y.toFixed(0)} hp=${(hpFrac * 100).toFixed(0)}% mode=${modeOf(slot)} moveMode=${Move.mode[eid]}`, T);
          }
        }
        // minions stuck
        if (isMinion(k)) {
          const an = anchor.get(eid);
          const active2 = Atk.phase[eid] !== 0 || active.has(eid);
          if (!an || Math.hypot(x - an.x, y - an.y) > 60 || active2 || Move.mode[eid] === 0) anchor.set(eid, { x, y, t: T, flagged: false });
          else if (T - an.t >= 10 * SEC && !an.flagged) {
            an.flagged = true;
            flag('minion_stuck_10s', `${tag} lane=${Unit.lane[eid]} pos=${x.toFixed(0)},${y.toFixed(0)} moveMode=${Move.mode[eid]} target=${Atk.target[eid]} walk=${walkable(sim.map.nav, x, y)}`, T);
          }
        }
      }
      maxEnt = Math.max(maxEnt, ents);
      // buffs
      const bs = buffState(sim);
      for (const [eid, e] of bs.ents) {
        for (const b of e.list) {
          if (!Number.isFinite(b.until) || !Number.isFinite(b.pct) || !Number.isFinite(b.flat) || !Number.isFinite(b.amount)) flag('nan_buff', `${b.id}/${b.kind}`, T);
          if (b.until < T - 2 && Unit.serial[eid] === e.serial) flag('expired_buff_kept', `eid=${eid} ${b.id}/${b.kind} until=${b.until}`, T);
          const dur = b.until - b.start;
          if (dur > 60 * SEC && dur < 1e7 && !bufSeen.has(b.id + b.kind)) { bufSeen.add(b.id + b.kind); flag('long_buff_' + b.id + '/' + b.kind, `dur=${(dur / SEC).toFixed(0)}s eid=${eid} champ=${sim.championIds[Unit.champ[eid]!]}`, T); }
          if (b.kind === 'dot' && b.period <= 0) flag('dot_no_period', `${b.id}`, T);
        }
        if (!Unit.alive[eid] && Unit.serial[eid] === e.serial && Unit.kind[eid] !== Kind.Champion && T % 300 === 0 && e.list.some((b) => b.until > T)) flag('buff_on_dead_nonchamp', `eid=${eid}`, T);
      }
      // structures
      for (const r of towerState(sim).list) {
        const ref = structPrev.get(r.eid + r.serial * 8192);
        const aliveU = Unit.alive[r.eid] === 1 && Unit.serial[r.eid] === r.serial;
        if (r.alive !== aliveU) flag('struct_alive_mismatch', `k=${r.kind} t=${r.team} lane=${r.lane} tier=${r.tier} rec=${r.alive} ecs=${aliveU}`, T);
        if (ref) {
          if (r.kind === Kind.Tower && !ref.alive && r.alive) flag('tower_revived', `team=${r.team} lane=${r.lane} tier=${r.tier}`, T);
          if (r.kind === Kind.Nexus && !ref.alive && r.alive) flag('nexus_revived', `team=${r.team}`, T);
          if (r.kind === Kind.Inhibitor) {
            if (!r.alive && r.respawnAt > ref.deadAt && ref.deadAt >= 0 && ref.alive) { /* fresh death */ }
            if (!r.alive && T > r.respawnAt + 3) flag('inhib_no_respawn', `team=${r.team} lane=${r.lane} respawnAt=${r.respawnAt}`, T);
            if (!r.alive && r.respawnAt - T > INHIB_RESPAWN + 2) flag('inhib_respawn_long', `${r.respawnAt - T}`, T);
            if (!ref.alive && r.alive && Hp.cur[r.eid]! < Hp.max[r.eid]! - 1) flag('inhib_respawn_hp', `team=${r.team} lane=${r.lane} hp=${Hp.cur[r.eid]}/${Hp.max[r.eid]}`, T);
            if (!ref.alive && r.alive && ref.deadAt >= 0 && Math.abs(T - ref.deadAt - INHIB_RESPAWN) > 3) flag('inhib_respawn_time', `team=${r.team} lane=${r.lane} after ${T - ref.deadAt} (want ${INHIB_RESPAWN})`, T);
          }
          // damage while protected
          if (r.alive && Unit.invulnerable[r.eid] && Hp.cur[r.eid]! < ref.hp - 1e-6) flag('protected_struct_damaged', `k=${r.kind} team=${r.team} lane=${r.lane} tier=${r.tier} ${ref.hp}->${Hp.cur[r.eid]}`, T);
        }
        structPrev.set(r.eid + r.serial * 8192, { alive: r.alive, hp: Hp.cur[r.eid]!, deadAt: ref && ref.alive && !r.alive ? T : ref ? ref.deadAt : -1 });
        if (r.alive && Hp.cur[r.eid]! > Hp.max[r.eid]! + 1e-6) flag('struct_hp_over_max', `k=${r.kind}`, T);
      }
      if (T % (120 * SEC) === 0) {
        const pr = sim.state.projectiles as { payloads: Map<number, unknown> } | undefined;
        const ab = sim.state.abilities as { zones: unknown[] };
        sizes.push({ t: T / SEC / 60, ents, buffs: bs.ents.size, payloads: pr?.payloads.size ?? 0, zones: ab.zones.length });
      }
    }, { reflex: args.get('brain') === 'new' });
  } catch (err) {
    const e = err as Error;
    flag('EXCEPTION', `${e.message} :: ${(e.stack ?? '').split('\n').slice(1, 5).join(' | ')}`, lastTick);
  }
  const wallS = (Date.now() - t0) / 1000;
  const champs = cfg.players.map((p) => `${p.champion}/${p.role}`).join(' ');
  out(`## game ${g} seed ${cfg.seed} rank ${rank}: ${res ? res.minutes.toFixed(1) : (lastTick / SEC / 60).toFixed(1)} min in ${wallS.toFixed(0)} s, winner ${res?.winner ?? '-'}, maxEnt ${maxEnt}`);
  out(`   champs: ${champs}`);
  if (res?.winner === undefined && !hits.has('EXCEPTION') && sim0) {
    const tw = towerState(sim0).list.filter((r) => r.alive);
    out(`   NO WINNER; alive structures: ${tw.map((r) => `${r.team}:${r.kind}:${r.lane}:${r.tier}`).join(' ')}`);
    flag('game_not_ended', `after ${minutes} min`, lastTick);
  }
  out(`   sizes(min,ents,buffs,payloads,zones): ${sizes.map((s) => `${s.t}:${s.ents}/${s.buffs}/${s.payloads}/${s.zones}`).join(' ')}`);
  for (const [k, h] of [...hits].sort()) out(`   ${k} x${h.n}: ${h.first}`);
  if (!hits.size) out('   clean');
}

for (let g = 0; g < games; g++) probe(g);
