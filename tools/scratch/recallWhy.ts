// @ts-nocheck - scratch (lead): why do laners recall so often with the new brain?
// Counts completed recalls (position jump to the fountain) per laner, with HP and the last recall reason logged.
// npx tsx tools/scratch/recallWhy.ts <minutes> <rank> <seed> [old]
import { botGameConfig } from '../../src/ai/runner';
import { runBotGame } from '../../src/ai/harness';

const min = Number(process.argv[2] ?? 15);
const rank = process.argv[3] ?? 'gold';
const seed = Number(process.argv[4] ?? 1);
const oldBrain = process.argv[5] === 'old';
const base = botGameConfig(seed, rank);
const cfg = oldBrain ? base : { ...base, botUtility: true, botReflex: true };
const laners = new Map(cfg.players.filter((p) => p.role !== 'jungle').map((p) => [p.slot, p.role]));
const last = new Map<number, { x: number; y: number; hp: number }>();
const trips: { t: number; slot: number; role: string; hp: number; reason: string }[] = [];
let botsRef = null;
const r = runBotGame(cfg, Math.round(min * 1800), (sim, _inputs, bots) => {
  botsRef = bots;
  const { Unit, Pos, Hp } = sim.c;
  for (const [slot, role] of laners) {
    const e = sim.slots[slot];
    if (e === undefined || !Unit.alive[e]) { last.delete(slot); continue; }
    const p = { x: Pos.x[e], y: Pos.y[e], hp: Hp.cur[e] / Hp.max[e] };
    const q = last.get(slot);
    if (q && Math.hypot(p.x - q.x, p.y - q.y) > 2500) {
      const ents = bots.log.entries(slot).filter((x) => x.node === 'recall' || (x.node === 'intent' && x.chosen === 'recall'));
      const l = ents[ents.length - 1];
      trips.push({ t: Math.round(sim.tick / 30), slot, role, hp: Math.round(q.hp * 100), reason: l ? `${l.node}:${l.reason ?? ''}` : '?' });
    }
    last.set(slot, p);
  }
}, { noVariance: true, reflex: !oldBrain });
const byReason: Record<string, number> = {};
for (const t of trips) byReason[t.reason] = (byReason[t.reason] ?? 0) + 1;
console.log(JSON.stringify({ min, rank, seed, brain: oldBrain ? 'old' : 'new', trips: trips.length, perLaner: +(trips.length / laners.size).toFixed(2), byReason, hp: trips.map((t) => t.hp).sort((a, b) => a - b) }));
