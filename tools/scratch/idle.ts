import { botGameConfig } from '../../src/ai/runner';
import { measureIdle } from '../../tests/utilityIdle';
declare const process: { argv: string[]; stdout: { write(s: string): void } };
const min = Number(process.argv[2] ?? 6);
const rank = (process.argv[3] ?? 'gold') as 'gold';
const r = measureIdle(botGameConfig(Number(process.argv[4] ?? 1), rank), Math.round(min * 1800));
const by: Record<string, number> = {};
for (const s of r.stretches) {
  const k = s.entry ? `${s.entry.chosen}|${s.entry.reason}|${s.entry.inputs.skipped ?? ''}` : 'nolog';
  by[k] = (by[k] ?? 0) + s.len;
}
process.stdout.write(`idle share ${(r.idleTicks / r.aliveTicks).toFixed(3)} stretches ${r.stretches.length}\n${JSON.stringify(by, null, 1)}\n`);
