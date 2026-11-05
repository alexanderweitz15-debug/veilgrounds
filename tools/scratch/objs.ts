// @ts-nocheck
// Epic objective takes per game (leviathan / kesselbrut / schleierwaechter), towers, kills, game end.
// Usage: tsx tools/scratch/objs.ts [min] [brain old|new] [seeds e.g. 1,2,3] [rank]
import { createSim, step } from '../../src/sim/sim';
import { BotRunner, botGameConfig } from '../../src/ai/runner';
import { Kind } from '../../src/sim/types';
import { jungleState } from '../../src/sim/systems/jungle';

globalThis.DBGOBJ = !!process.env.DBGOBJ;
const min = Number(process.argv[2] ?? 25);
const brain = process.argv[3] ?? 'old';
const seeds = (process.argv[4] ?? '1').split(',').map(Number);
const rank = process.argv[5] ?? 'gold';
const tot = { lev: 0, kes: 0, sch: 0, tow: 0, kills: 0, games: 0 };
for (const seed of seeds) {
  globalThis.lt = 0; globalThis.kt = 0;
  const cfg = { ...botGameConfig(seed, rank), ...(brain === 'new' ? { botUtility: true, botReflex: true } : {}) };
  const sim = createSim(cfg);
  const bots = new BotRunner(cfg, undefined, { reflex: brain === 'new' });
  const log = [];
  let kills = 0, towers = 0;
  while (sim.tick < min * 1800 && sim.state.winner === undefined) {
    step(sim, bots.tick(sim));
    if (sim.tick % 30 === 0) { const j = jungleState(sim); const tot = j.leviathan[0] + j.leviathan[1]; if (tot !== (globalThis.lt ?? 0)) { log.push(`${(sim.tick / 1800).toFixed(1)}m LEVIATHAN #${tot}`); globalThis.lt = tot; } const kt = j.kesselbrut[0] + j.kesselbrut[1]; if (kt !== (globalThis.kt ?? 0)) { log.push(`${(sim.tick / 1800).toFixed(1)}m kessel #${kt}`); globalThis.kt = kt; } }
    for (const ev of sim.events) {
      if (ev.e !== 'death') continue;
      if (ev.kind === Kind.Champion) kills++;
      if (ev.kind === Kind.Tower) towers++;
      if (ev.kind === Kind.Monster) {
        const v = sim.c.Unit.variant?.[ev.eid];
        const name = ev.variant ?? v;
        const s = String(name ?? '');
        if (/leviathan|kessel|schleier|uralt/i.test(s) || /leviathan|kessel|schleier/.test(JSON.stringify(ev))) log.push(`${(sim.tick / 1800).toFixed(1)}m ${s || JSON.stringify(ev).slice(0, 60)} t${sim.c.Unit.team[ev.killer] ?? '?'}`);
      }
    }
  }
  const js = jungleState(sim);
  console.log('  jungle state: leviathan', js.leviathan, 'kesselbrut', js.kesselbrut, 'baronBuffs?', JSON.stringify(js.drake ?? {}).slice(0, 120));
  const ent = [];
  for (let sl = -1; sl < 10; sl++) for (const x of bots.log.entries(sl)) if (x.node === 'objective' || x.node === 'smite' || (x.node === 'teamAI' && /take_objective/.test(String(x.chosen)))) ent.push({ ...x, reason: `${x.reason} ${JSON.stringify(x.inputs).slice(0, 40)}` });
  const by = {};
  for (const x of ent) { const k = `${x.node}|${x.chosen}|${String(x.reason).replace(/[0-9.]+/g, '#').slice(0, 70)}`; by[k] = (by[k] ?? 0) + 1; }
  console.log('  objective log:', JSON.stringify(by, null, 1).slice(0, 4000));
  const lev = log.filter((l) => /leviathan|uralt/i.test(l)).length, kes = log.filter((l) => /kessel/i.test(l)).length, sch = log.filter((l) => /schleier/i.test(l)).length;
  tot.lev += lev; tot.kes += kes; tot.sch += sch; tot.tow += towers; tot.kills += kills; tot.games++;
  console.log(`seed ${seed}: ${(sim.tick / 1800).toFixed(1)} min, kills ${kills}, towers ${towers}, leviathan ${lev}, kesselbrut ${kes}, schleier ${sch}${sim.state.winner !== undefined ? ' WIN t' + sim.state.winner : ''}`);
  for (const l of log) console.log('   ', l);
}
const g = tot.games;
console.log(`AVG/game: kills ${(tot.kills / g).toFixed(1)} towers ${(tot.tow / g).toFixed(1)} leviathan ${(tot.lev / g).toFixed(1)} kesselbrut ${(tot.kes / g).toFixed(1)} schleier ${(tot.sch / g).toFixed(1)}`);
