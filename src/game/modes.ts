// Game mode presets for the Phase 1 menu.
import type { RuneChoice } from '../sim/items/runes';
import type { SimConfig } from '../sim/types';

/** Champion id of Mira Quell (src/data/champions/mira.json). */
export const MIRA_ID = 'mira';

/** In front of the blue fountain (r=650 at 900,900), out of nexus-tower reach (2350,1950 / 1950,2350). */
export const SANDBOX_DUMMY = { x: 1700, y: 1000 } as const;

export type ModeId = 'lane' | 'sandbox' | 'mock';

export function configFor(mode: 'lane' | 'sandbox', runes?: RuneChoice, champion = MIRA_ID, summoners: [string, string] = ['sprung', 'heilen']): SimConfig {
  const player = {
    slot: 0,
    team: 0 as const,
    champion,
    role: 'mid' as const,
    summoners,
    isHuman: true,
    ...(runes ? { runes } : {}),
  };
  const seed = (Math.random() * 2 ** 31) | 0;
  if (mode === 'sandbox') return { seed, mode: 'sandbox', players: [player], dummies: [{ ...SANDBOX_DUMMY, team: 1 }] };
  return { seed, mode: 'laneOnly', players: [player] };
}
