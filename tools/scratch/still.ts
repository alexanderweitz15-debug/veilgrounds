// @ts-nocheck
// Still-time per bot: ticks with an unchanged position while alive, not in the fountain, not recalling, not CC'd.
// Split by what the bot was doing (auto attack wind-up/target, nothing). Usage: tsx tools/scratch/still.ts [min] [brain old|new] [seed]
import { createSim, step } from '../../src/sim/sim';
import { BotRunner, botGameConfig } from '../../src/ai/runner';
import { hasBuff } from '../../src/sim/buffs';
import { isBusy } from '../../src/sim/systems/abilities';

const min = Number(process.argv[2] ?? 8);
const brain = process.argv[3] ?? 'old';
const seed = Number(process.argv[4] ?? 1);
const cfg = { ...botGameConfig(seed, 'gold'), ...(brain === 'new' ? { botUtility: true, botReflex: true } : {}) };
const sim = createSim(cfg);
const bots = new BotRunner(cfg, undefined, { reflex: brain === 'new' });
const px = new Map(), py = new Map(), run = new Map();
const stat = cfg.players.map(() => ({ alive: 0, still: 0, stillAtk: 0, stillIdle: 0, wind: 0, longest: 0, over2s: 0 }));
const CC = ['stun', 'root', 'airborne', 'suppress', 'fear', 'stasis'];
while (sim.tick < min * 1800) {
  const inp = bots.tick(sim);
  for (const i of inp) { const h = (globalThis.hist ??= new Map()); const a = h.get(i.slot) ?? []; a.push(`${sim.tick}:${i.cmd.t}${i.cmd.target ?? ''}`); if (a.length > 6) a.shift(); h.set(i.slot, a); }
  step(sim, inp);
  if (sim.tick < 100 * 30) continue;
  const { Unit, Pos, Atk, Champ } = sim.c;
  for (const p of cfg.players) {
    const e = sim.slots[p.slot], s = stat[p.slot];
    const f = sim.map.sides[p.team].fountain;
    const inF = (Pos.x[e] - f.x) ** 2 + (Pos.y[e] - f.y) ** 2 < (f.r + 200) ** 2;
    if (!Unit.alive[e] || inF || Champ.recallAt[e] > 0 || CC.some((k) => hasBuff(sim, e, k))) { run.set(p.slot, 0); px.delete(e); continue; }
    s.alive++;
    const still = px.get(e) === Pos.x[e] && py.get(e) === Pos.y[e];
    px.set(e, Pos.x[e]); py.set(e, Pos.y[e]);
    if (!still) { const r = run.get(p.slot) ?? 0; if (r > 60) s.over2s++; run.set(p.slot, 0); continue; }
    s.still++;
    if (Atk.phase[e] === 1) s.wind++; else if (Atk.target[e] >= 0 || Atk.phase[e] !== 0) s.stillAtk++; else s.stillIdle++;
    const r = (run.get(p.slot) ?? 0) + 1; run.set(p.slot, r); s.longest = Math.max(s.longest, r);
    if (r === 60 && process.env.DBG) console.log('STUCK', p.slot, p.champion, sim.tick, 'ph', Atk.phase[e], 'tg', Atk.target[e], Atk.target[e] >= 0 ? sim.c.Unit.kind[Atk.target[e]] : '-', 'busy', isBusy(sim, e), 'mv', sim.c.Move.mode[e], 'cmds', (globalThis.hist?.get(p.slot) ?? []).join(' '));
  }
}
let tot = { alive: 0, still: 0, a: 0, i: 0, w: 0 };
for (const p of cfg.players) {
  const s = stat[p.slot];
  tot.alive += s.alive; tot.still += s.still; tot.a += s.stillAtk; tot.i += s.stillIdle; tot.w += s.wind;
  console.log(`${p.slot} ${p.role.padEnd(7)} ${p.champion.padEnd(9)} still ${(100 * s.still / s.alive).toFixed(0)}% (wind ${(100 * s.wind / s.alive).toFixed(0)}% atk-other ${(100 * s.stillAtk / s.alive).toFixed(0)}% idle ${(100 * s.stillIdle / s.alive).toFixed(0)}%) longest ${(s.longest / 30).toFixed(1)}s  >2s:${s.over2s}`);
}
console.log(`ALL still ${(100 * tot.still / tot.alive).toFixed(1)}% = ${(60 * tot.still / tot.alive).toFixed(1)} s/min (windup ${(100 * tot.w / tot.alive).toFixed(1)}% atk-other ${(100 * tot.a / tot.alive).toFixed(1)}% idle ${(100 * tot.i / tot.alive).toFixed(1)}%)`);
