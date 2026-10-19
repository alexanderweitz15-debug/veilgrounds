// D5: training plan from the calibration of the last matches (AGENTS-PLAN D5): three suggestions with trainer mode,
// settings and duration; the reason names the weakest category, its rank and what the next rank expects.
// Pure: input = history records (src/stats/history.ts), output = plan data; texts are i18n keys + params.
import type { TrainerMode } from '../game/modes';
import type { TrainerOpts } from '../sim/types';
import { RANKS, type Rank } from '../ai/profiles/schema';
import { CATEGORY_IDS, type CategoryId } from './rankCalibration';
import type { MatchRecord } from './history';
import data from './trainingData.json';

interface Drill {
  mode: TrainerMode;
  opts: TrainerOpts;
  minutes: number;
}
const D = data as unknown as { planWindow: number; provisionalBelow: number; drills: Record<CategoryId, Drill[]> };

export interface CategoryStanding {
  category: CategoryId;
  /** Mean fractional rank index 0..9 over the calibrated matches of the window. */
  index: number;
  rank: Rank;
  /** Mean value and mean next-rank target. */
  value: number;
  next?: number;
  matches: number;
}

export interface PlanItem extends Drill {
  category: CategoryId;
  /** i18n key `plan.reason.<category>` with params rank / value / next. */
  reasonKey: string;
  params: Record<string, string | number>;
}

export interface TrainingPlan {
  /** Weakest first. */
  standings: CategoryStanding[];
  items: PlanItem[];
  /** Calibrated matches in the window. */
  matches: number;
  provisional: boolean;
}

/** Category standings over the last `window` calibrated records (categories without data are left out). */
export function standings(history: readonly MatchRecord[], window = D.planWindow): CategoryStanding[] {
  const recent = history.filter((r) => Object.keys(r.calibration).length > 0).slice(-window);
  const out: CategoryStanding[] = [];
  for (const category of CATEGORY_IDS) {
    const cs = recent.map((r) => r.calibration[category]).filter((c) => c !== undefined);
    if (!cs.length) continue;
    const mean = (f: (c: (typeof cs)[number]) => number): number => cs.reduce((a, c) => a + f(c), 0) / cs.length;
    const index = mean((c) => c.index);
    const nexts = cs.filter((c) => c.next !== undefined);
    out.push({
      category,
      index,
      rank: RANKS[Math.round(index)]!,
      value: mean((c) => c.value),
      ...(nexts.length ? { next: nexts.reduce((a, c) => a + c.next!, 0) / nexts.length } : {}),
      matches: cs.length,
    });
  }
  // weakest first; ties keep the data order (deterministic)
  return out.sort((a, b) => a.index - b.index);
}

const round = (v: number): number => Math.round(v * 10) / 10;

/**
 * Three suggestions: the two first drills of the weakest category and the first drill of the second weakest (or the
 * third drill of the weakest when only one category has data). Without calibrated matches: one drill per category.
 */
export function trainingPlan(history: readonly MatchRecord[]): TrainingPlan {
  const st = standings(history);
  const matches = history.filter((r) => Object.keys(r.calibration).length > 0).slice(-D.planWindow).length;
  const item = (s: CategoryStanding | null, category: CategoryId, k: number): PlanItem => {
    const drill = D.drills[category][k % D.drills[category].length]!;
    return {
      ...drill,
      opts: { ...drill.opts },
      category,
      reasonKey: s ? `plan.reason.${category}` : 'plan.reason.noData',
      params: s ? { rank: s.rank, value: round(s.value), next: s.next !== undefined ? round(s.next) : '-' } : {},
    };
  };
  let items: PlanItem[];
  if (!st.length) items = CATEGORY_IDS.slice(0, 3).map((c) => item(null, c, 0));
  else if (st.length === 1) items = [0, 1, 2].map((k) => item(st[0]!, st[0]!.category, k));
  else items = [item(st[0]!, st[0]!.category, 0), item(st[0]!, st[0]!.category, 1), item(st[1]!, st[1]!.category, 0)];
  return { standings: st, items, matches, provisional: matches < D.provisionalBelow };
}
