import { botGameConfig } from '../../src/ai/runner';
import { Kind } from '../../src/sim/types';
import { runUtilityGame } from '../../tests/utilityHarness';
declare const process: { argv: string[]; stdout: { write(s: string): void } };
const min = Number(process.argv[2] ?? 8);
const rank = (process.argv[3] ?? 'diamond') as 'diamond';
const cfg = botGameConfig(Number(process.argv[4] ?? 1), rank);
const out: string[] = [];
const t0 = performance.now();
const g = runUtilityGame(cfg, Math.round(min * 1800), (sim, inputs) => {
  const { Unit, Pos, Hp } = sim.c;
  for (const i of inputs) {
    if (i.cmd.t !== 'recall') continue;
    const p = cfg.players.find((q) => q.slot === i.slot)!;
    if (p.role === 'jungle' || p.role === 'support') continue;
    const eid = sim.slots[i.slot]!;
    let foe = 0;
    let own = 0;
    for (let e = 0; e < Unit.kind.length; e++) {
      const k = Unit.kind[e];
      if (!Unit.alive[e] || (k !== Kind.MinionMelee && k !== Kind.MinionCaster && k !== Kind.MinionSiege)) continue;
      if ((Pos.x[e]! - Pos.x[eid]!) ** 2 + (Pos.y[e]! - Pos.y[eid]!) ** 2 > 1500 * 1500) continue;
      if (Unit.team[e] === p.team) own++;
      else foe++;
    }
    out.push(`${(sim.tick / 1800).toFixed(2)} slot ${i.slot} ${p.role} hp ${(Hp.cur[eid]! / Hp.max[eid]!).toFixed(2)} enemyMinionsNear ${foe} ownNear ${own}`);
  }
});
process.stdout.write(out.join('\n') + `\n${((performance.now() - t0) / 1000).toFixed(0)} s\n`);
const sh = g.bots.log.entries().filter((e) => e.node === 'recall');
const c: Record<string, number> = {};
for (const e of sh) c[e.chosen + '|' + e.reason] = (c[e.chosen + '|' + e.reason] ?? 0) + 1;
process.stdout.write(JSON.stringify(c) + '\n');
