// A3 diagnostic for test 10 clause 3: minions with >= 2 focused + servable kill windows that the bot never attacked.
// npx tsx tools/scratch/a3clause3.ts [seed] [minutes]
import { createSim, step } from '../../src/sim/sim';
import { BotRunner, botGameConfig } from '../../src/ai/runner';
import { reflexState } from '../../src/ai/reflex/state';
import { isDistracted } from '../../src/ai/humanize/attention';
import { reflexParams } from '../../src/ai/reflex/reflex';
declare const process: { argv: string[] };
const seed = Number(process.argv[2] ?? 7);
const min = Number(process.argv[3] ?? 5);
const config = botGameConfig(seed, 'iron', 'stable');
const sim = createSim(config);
const bots = new BotRunner(config, undefined, { reflex: true });
const open = new Map<string, boolean>();
const wins = new Map<string, { from: number; to: number; ticks: number; plannedOther: number; plannedSelf: number; filler: number; thinkIssued: number; mode: string; intentFarm: number }[]>();
const attacked = new Set<string>();
const { Atk, Unit } = sim.c;
while (sim.tick < min * 1800) {
  const inputs = bots.tick(sim);
  for (const b of bots.bots) {
    const me = sim.slots[b.ctx.slot]!;
    const last = reflexState(b.mem).last;
    const now = new Set<string>();
    if (last && last.tick === sim.tick) {
      const T = sim.tick;
      const focused = !isDistracted(b.mem, T);
      // a chance = what the planner would take: lane mode (no trade / fight decision), no other farm plan queued
      // (window collision: the rank loses one), the window within the rank's plan horizon
      const st = reflexState(b.mem);
      const otherPlan = st.plans.find((p) => (p.kind === 'lastHit' || p.kind === 'prehit') && p.targetId >= 0);
      const horizon = reflexParams(b.ctx).horizon;
      const calm = focused && b.mem.mode === 'lane';
      for (const w of last.windows) {
        if (w.a === Infinity || w.a >= w.b || w.walk > 0) continue;
        const serial = (w.m as { serial?: number }).serial ?? w.m.id;
        const key = `${b.ctx.slot}:${serial}`;
        now.add(key);
        if (!open.has(key)) open.set(key, false);
        const start = Math.max(last.ready, T + 1, Math.ceil(w.a - w.lead));
        const chance = calm && (!otherPlan || otherPlan.targetId === w.m.id) && w.a - T <= horizon;
        const usable = chance && start + w.lead < w.b;
        let list = wins.get(key);
        if (!list) wins.set(key, (list = []));
        if (usable && !open.get(key)) {
          open.set(key, true);
          list.push({ from: T, to: T, ticks: 0, plannedOther: 0, plannedSelf: 0, filler: 0, thinkIssued: 0, mode: b.mem.mode, intentFarm: 0 });
        }
        const cur = open.get(key) ? list[list.length - 1] : undefined;
        if (cur && usable) {
          cur.to = T;
          cur.ticks++;
          const fp = reflexState(b.mem).plans.find((p) => p.kind === 'lastHit' || p.kind === 'prehit');
          if (fp && fp.targetId === w.m.id) cur.plannedSelf++;
          else if (fp) cur.plannedOther++;
          if (reflexState(b.mem).filler >= 0) cur.filler++;
          if (reflexState(b.mem).intent?.farm) cur.intentFarm++;
        }
      }
    }
    for (const k of [...open.keys()]) if (k.startsWith(`${b.ctx.slot}:`) && !now.has(k)) open.delete(k);
    if (me >= 0 && Atk.phase[me] === 1 && Atk.target[me]! >= 0) attacked.add(`${b.ctx.slot}:${Unit.serial[Atk.target[me]!]}`);
  }
  step(sim, inputs);
}
let n2 = 0;
for (const [key, list] of wins) {
  if (list.length < 2) continue;
  n2++;
  if (attacked.has(key)) continue;
  console.log(`MISSED ${key} (${bots.bots.find((b) => `${b.ctx.slot}` === key.split(':')[0])?.ctx.role}):`, JSON.stringify(list));
}
console.log(`n2 ${n2}`);
