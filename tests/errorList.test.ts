// Post-game error list (S2, 6.3): bot errors / attention from the slim bot log, player patterns, i18n coverage.
import { describe, expect, it } from 'vitest';
import { buildErrorList } from '../src/stats/errorList';
import { slimBotLog, type Replay } from '../src/replay/replay';
import { PATTERN_IDS } from '../src/stats/playerPatterns';
import { ERROR_IDS } from '../src/ai/errors';
import de from '../src/i18n/de.json';
import en from '../src/i18n/en.json';

const line = (o: object): string => JSON.stringify(o);
const log = [
  line({ tick: 900, bot: 3, node: 'lane', chosen: 'farm', reason: 'x', inputs: {} }), // dropped by slimBotLog
  line({ tick: 1200, bot: 3, node: 'error', inputs: { durS: 4 }, chosen: 'late_recall', reason: 'injectedError: late_recall (dur 4 s)', injectedError: 'late_recall' }),
  line({ tick: 1320, bot: 3, node: 'error', inputs: { afterS: 4, myBad: true }, chosen: 'detected:late_recall', reason: 'noticed' }),
  line({ tick: 2000, bot: 4, node: 'error', inputs: { durS: 6.5 }, chosen: 'flash_in_dive', reason: 'x', injectedError: 'flash_in_dive' }),
  line({ tick: 600, bot: 3, node: 'attention', inputs: { reason: 'minimap', durS: 2, tilt: 0, until: 660 }, chosen: 'distracted(minimap)', reason: '2 s (until 660)' }),
  line({ tick: 1000, bot: 3, node: 'attention', inputs: { reason: 'chat', durS: 3, tilt: 0, until: 1120 }, chosen: 'distracted(chat)', reason: '4 s (until 1120)' }),
  line({ tick: 1050, bot: 3, node: 'attention', inputs: { reason: 'shop', durS: 3, tilt: 0, until: 1200 }, chosen: 'distracted(chat+shop)', reason: 'extended' }),
].join('\n');

const replay = {
  version: 1,
  config: { players: [{ slot: 0, team: 0, champion: 'mira' }, { slot: 3, team: 1, champion: 'vargrim' }, { slot: 4, team: 1, champion: 'fenna' }] },
  inputs: {},
  ticks: 6000,
  hash: '',
  botLog: slimBotLog(log),
  humanSlot: 0,
  player: [
    { id: 'tower_chase', tick: 3000, durS: 2, vars: { dmgPct: 40, died: 1 } },
    { id: 'fight_in_enemy_wave', tick: 900, durS: 0, vars: { n: 3 } },
  ],
} as unknown as Replay;

describe('error list', () => {
  it('slimBotLog keeps only error and attention lines', () => {
    expect(replay.botLog!.trim().split('\n')).toHaveLength(6);
    expect(replay.botLog).not.toContain('"node":"lane"');
  });

  it('bot errors: duration, detection time, "my bad"; undetected stays null', () => {
    const l = buildErrorList(replay);
    expect(l.bots).toEqual([
      { slot: 3, champ: 'vargrim', id: 'late_recall', tick: 1200, durS: 4, detectedAfterS: 4, myBad: true },
      { slot: 4, champ: 'fenna', id: 'flash_in_dive', tick: 2000, durS: 6.5, detectedAfterS: null, myBad: false },
    ]);
  });

  it('attention: windows counted, extensions add time, share of the game', () => {
    const [a] = buildErrorList(replay).attention;
    expect(a).toMatchObject({ slot: 3, champ: 'vargrim', windows: 2, longestTick: 1000 });
    // 60 + 120 ticks + 80 ticks of extension (1120 -> 1200) = 260 ticks
    expect(a!.distractedS).toBe(8.7);
    expect(a!.pct).toBe(4);
    expect(a!.top).toBe('minimap');
  });

  it('player patterns come sorted by time', () => {
    expect(buildErrorList(replay).you.map((e) => e.tick)).toEqual([900, 3000]);
  });

  it('no log, no patterns: empty lists', () => {
    expect(buildErrorList({ ...replay, botLog: undefined, player: undefined })).toEqual({ bots: [], attention: [], you: [] });
  });

  it('de + en have a sentence for every bot error id, player pattern and attention cause', () => {
    for (const tbl of [de, en] as Record<string, string>[]) {
      for (const id of ERROR_IDS) expect(tbl[`pe.err.${id}`], id).toBeTruthy();
      for (const id of PATTERN_IDS) expect(tbl[`pe.you.${id}`], id).toBeTruthy();
      for (const r of ['minimap', 'killfeed', 'shop', 'chat', 'random', 'tilt']) expect(tbl[`pe.att.${r}`], r).toBeTruthy();
    }
  });
});
