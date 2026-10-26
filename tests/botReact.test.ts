declare const process: { env: Record<string, string | undefined> };
// Bot reaction to being attacked by an enemy champion in lane (user bug "Gegner bleiben still stehen oder rennen in
// dich rein"): within 1.5 s at Gold the bot hits back or steps away - full and half HP, default and new brain.
import { describe, expect, it } from 'vitest';
import { createSim, step } from '../src/sim/sim';
import { BotRunner } from '../src/ai/runner';
import { Lane, type PlayerSetup, type SimConfig } from '../src/sim/types';
import { NO_RUNES, place } from './combat-helpers';

const WARMUP_S = 100;
const REACT_TICKS = 45;

function scene(champ: string, hpf: number, newBrain: boolean): number {
  const players: PlayerSetup[] = [
    { slot: 0, team: 0, champion: 'mira', role: 'mid', summoners: ['sprung', 'heilen'], isHuman: true, runes: NO_RUNES },
    { slot: 1, team: 1, champion: champ, role: 'mid', summoners: ['sprung', 'heilen'], isHuman: false, bot: { rank: 'gold', variance: 'stable' }, runes: NO_RUNES },
  ];
  const cfg: SimConfig = { seed: 1, mode: 'laneOnly', minionLanes: [Lane.Mid], players, ...(newBrain ? { botUtility: true } : {}) };
  const sim = createSim(cfg);
  const bots = new BotRunner(cfg, undefined, { noVariance: true, reflex: newBrain });
  const me = sim.slots[0]!;
  const bot = sim.slots[1]!;
  const { Hp, Pos, Atk } = sim.c;
  while (sim.tick < WARMUP_S * 30) step(sim, bots.tick(sim));
  const bx = Pos.x[bot]!;
  const by = Pos.y[bot]!;
  const dl = Math.hypot(8000 - bx, 8000 - by) || 1;
  const ux = (8000 - bx) / dl; // human stands 600 toward the map centre
  const uy = (8000 - by) / dl;
  place(sim, me, bx + ux * 600, by + uy * 600);
  Hp.cur[bot] = Hp.max[bot]! * hpf;
  let dmgBack = 0;
  for (let i = 0; i < 90; i++) {
    const inputs = bots.tick(sim);
    step(sim, [...inputs, ...(i % 15 === 0 || Atk.target[me] !== bot ? [{ slot: 0, cmd: { t: 'attack' as const, target: bot } }] : [])]);
    for (const e of sim.events) if (e.e === 'damage' && e.src === bot && e.dst === me) dmgBack += e.amount;
    const away = (Pos.x[bot]! - bx) * -ux + (Pos.y[bot]! - by) * -uy; // bot moved away from the human
    if (i % 5 === 0 && process.env.DBG) console.log(i, Math.round(away), Atk.phase[bot], Atk.target[bot], inputs.filter((x) => x.slot === 1).map((x) => x.cmd.t).join(','));
    if (dmgBack > 0 || away >= 50 || Atk.target[bot] === me) { if (process.env.DBG) for (const e of bots.log.entries(1)) if (e.tick >= WARMUP_S * 30) console.log('LOG', e.tick - WARMUP_S * 30, e.node, e.chosen, e.reason); return i; }
  }
  return -1;
}

describe('bot reacts to a champion attack in lane', () => {
  for (const newBrain of [false, true])
    for (const hpf of [1, 0.5])
      it(`${newBrain ? 'new' : 'default'} brain, ${hpf * 100} % HP: answers (new 1.5 s, default 2 s)`, () => {
        for (const champ of ['aurel']) {
          const react = scene(champ, hpf, newBrain);
          console.log(`react ${newBrain ? 'new' : 'old'} ${champ} hp${hpf}: ${react}`);
          expect(react, champ).toBeGreaterThanOrEqual(0);
          expect(react, champ).toBeLessThanOrEqual(newBrain ? REACT_TICKS : 60);
        }
      }, 60_000);
});
