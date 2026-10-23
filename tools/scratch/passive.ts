// Passive-bot repro (user report: "Gegner bleiben still stehen oder rennen in dich rein, waehrend du sie hitten kannst").
// A scripted human (slot 0) teleports next to an enemy bot every 30 s and auto-attacks it for 8 s; per trial we log
// whether / when the bot reacts (attacks back, casts, or runs away) and what it did while taking damage.
// usage: npx tsx tools/scratch/passive.ts <rank> <seed> [minutes=11] [reflex=0|1] [verbose=0|1]
import { botGameConfig, BotRunner } from '../../src/ai/runner';
import { createSim, step } from '../../src/sim/sim';
import { Kind, type TickInput } from '../../src/sim/types';
import type { Rank } from '../../src/ai/profiles/schema';
declare const process: { argv: string[]; stdout: { write(s: string): void } };

const rank = (process.argv[2] ?? 'gold') as Rank;
const seed = Number(process.argv[3] ?? 1);
const minutes = Number(process.argv[4] ?? 11);
const brainNew = process.argv[5] === '1';
const verbose = process.argv[6] === '1';

const config = botGameConfig(seed, rank, 'stable');
const human = config.players[0]!;
human.isHuman = true;
delete human.bot;
const sim = createSim(config);
const bots = new BotRunner(config, undefined, { noVariance: true, ...(brainNew ? { reflex: true } : {}) });
const { Pos, Hp, Unit, Atk } = sim.c;
const me = sim.slots[0]!;
const TRIAL = 240; // ticks
const EVERY = 900;
const out = (s: string): void => void process.stdout.write(s + '\n');

interface Trial {
  slot: number;
  eid: number;
  start: number;
  mode: string;
  before: string;
  hp0: number;
  dist0: number;
  firstDmg: number;
  react: number;
  reactWhy: string;
  cmds: string[];
  lastHp: number;
  minDist: number;
  maxDist: number;
  endDist: number;
  nodes: string[];
}
let trial: Trial | null = null;
let n = 0;
const results: Trial[] = [];

function lastLog(slot: number, tick: number): string {
  const es = bots.log.entries(slot).filter((e) => e.node !== 'mode' && e.tick <= tick);
  const e = es[es.length - 1];
  return e ? `${e.node}:${e.chosen}(${tick - e.tick}t ago)` : '-';
}

while (sim.tick < minutes * 1800 && sim.state.winner === undefined) {
  const inputs: TickInput[] = bots.tick(sim);
  const t = sim.tick;
  if (!trial && t >= 3600 && t % EVERY === 0 && Unit.alive[me]) {
    const slot = 5 + (n++ % 5);
    const eid = sim.slots[slot]!;
    if (Unit.alive[eid]) {
      const b = bots.bots.find((x) => x.ctx.slot === slot)!;
      Hp.max[me] = 60000;
      Hp.cur[me] = 60000;
      const ang = 0.7;
      Pos.x[me] = Pos.px[me] = Pos.x[eid]! - Math.cos(ang) * 120;
      Pos.y[me] = Pos.py[me] = Pos.y[eid]! - Math.sin(ang) * 120;
      sim.paths.delete(me);
      sim.c.Move.mode[me] = 0;
      trial = { slot, eid, start: t, mode: b.mem.mode, before: lastLog(slot, t), hp0: Hp.cur[eid]! / Hp.max[eid]!, dist0: 120, firstDmg: -1, react: -1, reactWhy: '', cmds: [], lastHp: Hp.cur[eid]!, minDist: 1e9, maxDist: 0, endDist: 0, nodes: [] };
    }
  }
  if (trial) {
    inputs.push({ slot: 0, cmd: { t: 'attack', target: trial.eid } });
    const mine = inputs.filter((i) => i.slot === trial!.slot);
    for (const i of mine) if (i.cmd.t !== 'levelUp' && i.cmd.t !== 'buy' && i.cmd.t !== 'chat' && i.cmd.t !== 'ping') trial.cmds.push(`${t - trial.start}:${i.cmd.t}${'target' in i.cmd && i.cmd.target !== undefined ? '>' + (i.cmd.target === me ? 'ME' : i.cmd.target) : ''}`);
    // reaction: an order against the attacker, or a cast / summoner spell
    if (trial.firstDmg >= 0 && trial.react < 0) {
      for (const i of mine) {
        if ((i.cmd.t === 'attack' && i.cmd.target === me) || i.cmd.t === 'cast' || i.cmd.t === 'spell') {
          trial.react = t - trial.firstDmg;
          trial.reactWhy = i.cmd.t;
        }
      }
    }
  }
  step(sim, inputs);
  if (trial) {
    const tr = trial;
    const eid = tr.eid;
    const dx = Pos.x[eid]! - Pos.x[me]!;
    const dy = Pos.y[eid]! - Pos.y[me]!;
    const d = Math.sqrt(dx * dx + dy * dy);
    tr.minDist = Math.min(tr.minDist, d);
    tr.maxDist = Math.max(tr.maxDist, d);
    if (tr.firstDmg < 0 && Hp.cur[eid]! < tr.lastHp - 1) tr.firstDmg = sim.tick;
    tr.endDist = d;
    tr.lastHp = Hp.cur[eid]!;
    if (tr.firstDmg >= 0 && tr.react < 0 && Atk.target[eid] === me) (tr.react = sim.tick - tr.firstDmg), (tr.reactWhy = 'auto');
    if (!Unit.alive[eid] || sim.tick - tr.start >= TRIAL) {
      for (const e of bots.log.entries(tr.slot)) if (e.node !== 'mode' && e.tick >= tr.start && e.tick <= sim.tick) { const k = `${e.node}:${e.chosen}`; if (tr.nodes[tr.nodes.length - 1] !== k) tr.nodes.push(k); }
      results.push(tr);
      trial = null;
      // back to base so the next trial starts clean
      Pos.x[me] = Pos.px[me] = 500;
      Pos.y[me] = Pos.py[me] = 500;
      sim.paths.delete(me);
    }
  }
}

let bad = 0;
for (const r of results) {
  const dead = !Unit.alive[r.eid];
  const reactS = r.react < 0 ? 'NONE' : (r.react / 30).toFixed(1) + 's/' + r.reactWhy;
  const noDmg = r.firstDmg < 0;
  const fled = r.endDist > 700;
  const slow = !noDmg && !dead && !fled && (r.react < 0 || r.react > 45);
  if (slow) bad++;
  out(`${rank} s${seed} t=${Math.round(r.start / 30)}s slot${r.slot} mode=${r.mode} before=${r.before} hp0=${r.hp0.toFixed(2)} dmgAt=${noDmg ? '-' : ((r.firstDmg - r.start) / 30).toFixed(1)} react=${reactS} dist=${Math.round(r.minDist)}-${Math.round(r.maxDist)}${dead ? ' DEAD' : ''}${fled ? ' FLED' : ''}${slow ? '  <== SLOW' : ''}`);
  if (verbose || slow) out('   ' + r.nodes.slice(0, 14).join(' > ') + '\n   ' + r.cmds.slice(0, 40).join(' '));
}
out(`${rank} s${seed}: ${results.length} trials, ${bad} slow/none`);
