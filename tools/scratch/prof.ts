import { botGameConfig } from '../../src/ai/runner';
import { runBotGame } from '../../src/ai/harness';
import { CANDIDATES } from '../../src/ai/utility/value';
import * as world from '../../src/ai/utility/world';
declare const process: { argv: string[]; stdout: { write(s: string): void } };
const t: Record<string, number> = {};
const calls: Record<string, number> = {};
for (const c of CANDIDATES) {
  const f = c.value;
  c.value = (w) => {
    const a = performance.now();
    const r = f(w);
    t[c.id] = (t[c.id] ?? 0) + performance.now() - a;
    calls[c.id] = (calls[c.id] ?? 0) + 1;
    return r;
  };
}
void world;
const min = Number(process.argv[2] ?? 3);
const t0 = performance.now();
runBotGame(botGameConfig(1, 'gold'), Math.round(min * 1800));
process.stdout.write(`total ${((performance.now() - t0) / 1000).toFixed(1)} s\n`);
for (const k of Object.keys(t)) process.stdout.write(`${k}: ${t[k]!.toFixed(0)} ms / ${calls[k]} calls\n`);
