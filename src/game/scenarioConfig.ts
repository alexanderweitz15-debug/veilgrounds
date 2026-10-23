// Szenario-Trainer config builder (client side): human in slot 0 (blue) plus the scenario's bots / passive champions
// from src/sim/trainer/scenarios.ts. Bots are normal BotRunner bots of the lobby rank; nothing here touches src/ai.
import type { PlayerSetup, SimConfig, TrainerOpts } from '../sim/types';
import { CHAMPION_DATA } from '../sim/champions';
import { BUILDS } from '../ai/bot/builds';
import type { Rank } from '../ai/profiles/schema';
import { SCENARIOS, isScenarioId, type ScenarioId } from '../sim/trainer/scenarios';

export interface ScenarioPick {
  champion: string;
  summoners: [string, string];
  runes?: PlayerSetup['runes'];
}

/** Boots + first two core items of the champion's standard build. */
const presetItems = (champion: string): string[] => {
  const b = BUILDS[champion];
  return b ? [b.standard.boots, ...b.standard.core.slice(0, 2)] : [];
};

export function scenarioConfig(opts: TrainerOpts, pick: ScenarioPick, rank: Rank, seed: number): SimConfig {
  const id: ScenarioId = isScenarioId(opts.scenario) ? opts.scenario : 'turret2v1';
  const sc = SCENARIOS[id];
  let summoners = pick.summoners;
  if (sc.needSummoner && !summoners.includes(sc.needSummoner)) summoners = summoners[0] === 'sprung' ? ['sprung', sc.needSummoner] : [sc.needSummoner, summoners[1]];
  const players: PlayerSetup[] = [
    { slot: 0, team: 0, champion: pick.champion, role: sc.playerRole, summoners, isHuman: true, ...(pick.runes ? { runes: pick.runes } : {}) },
  ];
  const taken = new Set([pick.champion]);
  for (const u of sc.units) {
    const champion = u.champs.find((c) => !taken.has(c) && c in CHAMPION_DATA) ?? Object.keys(CHAMPION_DATA).sort().find((c) => !taken.has(c))!;
    taken.add(champion);
    players.push({
      slot: u.slot,
      team: u.team,
      champion,
      role: u.role,
      summoners: u.summoners ?? ['sprung', 'heilen'],
      isHuman: false,
      ...(u.bot ? { bot: { rank, variance: 'stable' as const, personalitySeed: (seed ^ (u.slot * 7919)) >>> 0, ...(u.style ? { playstyle: { ...u.style } } : {}) } } : {}),
    });
  }
  const trainer: TrainerOpts = { ...opts, scenario: id };
  if (sc.items) {
    const items: Record<string, string[]> = {};
    for (const p of players) items[String(p.slot)] = p.team === 1 && sc.foeItems !== undefined ? presetItems(p.champion).slice(0, sc.foeItems) : presetItems(p.champion);
    trainer.items = items;
  }
  return {
    seed,
    mode: 'scenario',
    players,
    ...(sc.minions ? { minionLanes: [1 as const] } : { minionsEnabled: false }),
    trainer,
  };
}
