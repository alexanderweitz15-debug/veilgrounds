// Shared by the replay tests: a short 5v5 game with 9 bots and a scripted human (slot 0), recorded like the sim worker
// does (human inputs first, then the bots', Recorder.record before step, Recorder.observe after).
import { botGameConfig, BotRunner } from '../src/ai/runner';
import { createSim, step } from '../src/sim/sim';
import { Recorder, type Replay } from '../src/replay/replay';
import { Rng } from '../src/sim/rng';
import type { TickInput } from '../src/sim/types';

const cache = new Map<string, Replay>();

export function humanInputs(seed: number, tick: number): TickInput[] {
  const r = new Rng(seed * 7919 + tick);
  if (!r.chance(0.04)) return [];
  return [{ slot: 0, cmd: { t: 'move', x: r.range(1500, 9000), y: r.range(1500, 9000) } }];
}

/** Recorded game (memoised per seed/ticks: the bots make it slow). */
export function recordBotGame(seed: number, ticks: number): Replay {
  const key = `${seed}:${ticks}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const cfg = botGameConfig(seed, 'gold');
  cfg.players[0] = { ...cfg.players[0]!, isHuman: true, bot: undefined } as never;
  const sim = createSim(cfg);
  const rec = new Recorder(cfg);
  const bots = new BotRunner(cfg, undefined, { reflex: true });
  while (sim.tick < ticks) {
    const inputs = [...humanInputs(seed, sim.tick), ...bots.tick(sim)];
    rec.record(sim.tick, inputs);
    step(sim, inputs);
    rec.observe(sim);
  }
  const replay = rec.finish(sim, bots.log.toNDJSON());
  cache.set(key, replay);
  return replay;
}
