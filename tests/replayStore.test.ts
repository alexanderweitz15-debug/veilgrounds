import { describe, expect, it } from 'vitest';
import { REPLAY_CAP, addMeta, deleteReplay, listReplays, loadReplay, metaOf, saveReplay, type Backend } from '../src/replay/store';
import type { Replay } from '../src/replay/replay';

const mem = (): Backend & { map: Map<string, unknown> } => {
  const map = new Map<string, unknown>();
  return { map, get: async <T>(k: string) => map.get(k) as T | undefined, set: async (k, v) => void map.set(k, structuredClone(v)), del: async (k) => void map.delete(k) };
};

const fake = (champ = 'mira', winner: number | null = 0): Replay => ({
  version: 1,
  config: { seed: 1, mode: 'classic', players: [{ slot: 0, team: 0, champion: champ, role: 'mid', summoners: ['sprung', 'heilen'], isHuman: true }, { slot: 5, team: 1, champion: 'kiran', role: 'mid', summoners: ['sprung', 'heilen'], isHuman: false }] },
  inputs: { 3: [{ slot: 0, cmd: { t: 'stop' } }] },
  ticks: 54000,
  hash: 'abc',
  winner,
  humanSlot: 0,
  markers: [
    { tick: 100, kind: 'kill', team: 0, victim: 5, killer: 0 },
    { tick: 200, kind: 'kill', team: 1, victim: 0, killer: 5 },
    { tick: 300, kind: 'kill', team: 0, victim: 5, killer: 0 },
    { tick: 400, kind: 'tower', team: 0 },
  ],
});

describe('replay store', () => {
  it('meta: duration, win, kills/deaths of the human', () => {
    const m = metaOf(fake(), 1000);
    expect(m).toMatchObject({ champion: 'mira', durationS: 1800, win: true, kills: 2, deaths: 1, team: 0, ticks: 54000 });
    expect(metaOf(fake('mira', 1), 1000).win).toBe(false);
    expect(metaOf(fake('mira', null), 1000).win).toBeNull();
  });

  it('save / list / load / delete round trip', async () => {
    const b = mem();
    const m = await saveReplay(fake(), 1000, b);
    expect((await listReplays(b)).map((x) => x.id)).toEqual([m.id]);
    expect((await loadReplay(m.id, b))!.hash).toBe('abc');
    await deleteReplay(m.id, b);
    expect(await listReplays(b)).toEqual([]);
    expect(await loadReplay(m.id, b)).toBeUndefined();
  });

  it('cap: oldest dropped together with its blob; same id replaces', async () => {
    const b = mem();
    const ids: string[] = [];
    for (let i = 0; i < REPLAY_CAP + 3; i++) ids.push((await saveReplay(fake(), 1000 + i, b)).id);
    const list = await listReplays(b);
    expect(list).toHaveLength(REPLAY_CAP);
    expect(list[0]!.id).toBe(ids[3]);
    expect(await loadReplay(ids[0]!, b)).toBeUndefined();
    expect(await loadReplay(ids[3]!, b)).toBeDefined();
    expect([...b.map.keys()].filter((k) => k.startsWith('replay:v1:'))).toHaveLength(REPLAY_CAP);
    await saveReplay(fake(), 1000 + REPLAY_CAP + 2, b);
    expect(await listReplays(b)).toHaveLength(REPLAY_CAP);
  });

  it('addMeta is pure and ordered by time', () => {
    const a = metaOf(fake(), 5);
    const c = metaOf(fake(), 9);
    const r = addMeta([c], a, 5);
    expect(r.index.map((m) => m.at)).toEqual([5, 9]);
    expect(addMeta([a, c], metaOf(fake(), 7), 2)).toMatchObject({ dropped: [a.id] });
  });
});
