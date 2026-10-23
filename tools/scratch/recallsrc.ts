// Recall commands of laners by source (new brain: reflex + utility): governing log entry, completed or broken.
import { botGameConfig } from '../../src/ai/runner';
import { runBotGame } from '../../src/ai/harness';
declare const process: { argv: string[]; stdout: { write(s: string): void } };
const seed = Number(process.argv[2] ?? 1);
const min = Number(process.argv[3] ?? 14);
const utility = process.argv[4] !== 'off';
const cfg = { ...botGameConfig(seed, 'gold'), botUtility: utility };
const cmds: { tick: number; slot: number }[] = [];
const homeAt = new Map<number, number[]>();
const r = runBotGame(cfg, Math.round(min * 1800), (sim, inputs) => {
  for (const i of inputs) if (i.cmd.t === 'recall') cmds.push({ tick: sim.tick, slot: i.slot });
  if (sim.tick % 15) return;
  for (const p of cfg.players) {
    const eid = sim.slots[p.slot]!;
    const f = sim.map.sides[p.team === 1 ? 1 : 0].fountain;
    if (Math.hypot(sim.c.Pos.x[eid]! - f.x, sim.c.Pos.y[eid]! - f.y) < f.r) (homeAt.get(p.slot) ?? homeAt.set(p.slot, []).get(p.slot)!).push(sim.tick);
  }
}, { noVariance: true, reflex: true });
const laners = new Set(cfg.players.filter((p) => p.role === 'top' || p.role === 'mid' || p.role === 'adc').map((p) => p.slot));
const by: Record<string, number> = {};
let total = 0;
for (const c of cmds) {
  if (!laners.has(c.slot)) continue;
  total++;
  let src = '?';
  for (const e of r.bots.log.entries(c.slot)) {
    if (e.tick > c.tick) break;
    if (e.tick < c.tick - 120) continue;
    if (e.node === 'recall' || (e.node === 'intent' && e.chosen === 'recall') || e.node === 'objective' || e.node === 'roam') src = e.node === 'intent' ? `intent:${(e.inputs.t_item as number) > 0 ? 'item' : ''}${(e.inputs.t_hp as number) > 0 ? '+hp' : ''}${(e.inputs.t_mana as number) > 0 ? '+mana' : ''}` : `${e.node}:${e.chosen}|${e.reason}`;
  }
  const done = (homeAt.get(c.slot) ?? []).some((t) => t > c.tick + 200 && t < c.tick + 330);
  const k = `${src} ${done ? 'completed' : 'broken/walked'}`;
  by[k] = (by[k] ?? 0) + 1;
}
process.stdout.write(`laner recall cmds ${total} (${(total / laners.size).toFixed(1)} per laner in ${min} min)\n`);
for (const [k, v] of Object.entries(by).sort((a, b) => b[1] - a[1])) process.stdout.write(`${v} ${k}\n`);
