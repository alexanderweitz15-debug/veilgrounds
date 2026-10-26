// Death recap line "what a Challenger would have done" (S1, FEATURE-GAP 1.14): a rule on the recorded damage picks
// one i18n key `recap.hint.<id>`. Thresholds in src/data/deathHint.json. Pure, tested in tests/deathHint.test.ts.
import data from '../data/deathHint.json';

export interface HintHit {
  /** Seconds before the death (0 = the killing blow). */
  ago: number;
  kind: 'champ' | 'tower' | 'minion' | 'monster' | 'other';
  /** Unique id of a champion source (for the group rule). */
  key: string;
  amount: number;
  type: 'phys' | 'magic' | 'true';
}

export type HintId = 'tower' | 'group' | 'minions' | 'monster' | 'burst' | 'magic' | 'phys' | 'default';

export function deathHint(hits: readonly HintHit[]): HintId {
  const total = hits.reduce((a, h) => a + h.amount, 0);
  if (total <= 0) return 'default';
  const share = (f: (h: HintHit) => boolean): number => hits.filter(f).reduce((a, h) => a + h.amount, 0) / total;
  if (share((h) => h.kind === 'tower') >= data.towerShare) return 'tower';
  if (new Set(hits.filter((h) => h.kind === 'champ').map((h) => h.key)).size >= data.groupChamps) return 'group';
  if (share((h) => h.kind === 'minion') >= data.minionShare) return 'minions';
  if (share((h) => h.kind === 'monster') >= data.monsterShare) return 'monster';
  if (share((h) => h.ago <= data.burstS) >= data.burstShare) return 'burst';
  if (share((h) => h.type === 'magic') >= data.typeShare) return 'magic';
  if (share((h) => h.type === 'phys') >= data.typeShare) return 'phys';
  return 'default';
}
