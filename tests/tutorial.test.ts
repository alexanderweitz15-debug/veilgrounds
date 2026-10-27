// Interactive tutorial: step detection from snapshots / observed commands, preparation commands, saved progress, and
// a scripted walk through every step against the real sim (tutorialConfig = sandbox sim with cheats).
import { describe, expect, it } from 'vitest';
import { createSim, step as simStep } from '../src/sim/sim';
import { buildSnapshot, type PlayerHud, type SnapEntity, type Snapshot } from '../src/sim/snapshot';
import { Kind, isMinion, type Command, type SimEvent, type TickInput } from '../src/sim/types';
import { isTutorialConfig, tutorialConfig, SANDBOX_DUMMY } from '../src/game/modes';
import {
  FLASH_TICKS,
  LAST_HITS,
  MOVE_DIST,
  STEPS,
  STEP_IDS,
  STORAGE_KEY,
  TIP_TICKS,
  TutorialEngine,
  isComplete,
  loadProgress,
  parseProgress,
  saveProgress,
  type Geo,
  type StepId,
} from '../src/ui/tutorialSteps';
import de from '../src/i18n/de.json';
import en from '../src/i18n/en.json';

const geo: Geo = { fountain: { x: 900, y: 900 }, ownTower: { x: 5000, y: 5000 }, dummy: { x: 1700, y: 600 } };

// ---------------------------------------------------------------- synthetic snapshots

const hud = (o: Partial<PlayerHud> = {}): PlayerHud => ({
  eid: 1,
  champ: 'mira',
  level: 1,
  xp: 0,
  gold: 500,
  cs: 0,
  dead: false,
  respawnIn: 0,
  items: [null, null, null, null, null, null],
  itemCds: [],
  inFountain: true,
  marks: [],
  recallLeft: 0,
  abilities: [0, 1, 2, 3, 4, 5].map((i) => ({ id: `a${i}`, rank: 0, maxRank: 5, cdLeft: 0, cdTotal: 0, cost: 0, canLevel: i < 3 })),
  trinket: { id: 'schleierward', charges: 2, maxCharges: 2, cdLeft: 0, cdTotal: 0, canSwap: null },
  stats: { ad: 60, ap: 0, armor: 20, mr: 20, as: 1, ms: 340, range: 550, crit: 0 },
  ...o,
});

const ent = (o: Partial<SnapEntity> & { id: number }): SnapEntity => ({ serial: 0, kind: Kind.Champion, team: 0, x: 0, y: 0, px: 0, py: 0, fx: 1, fy: 0, hp: 100, maxHp: 100, shield: 0, mana: 0, maxMana: 0, radius: 30, level: 1, champ: null, slot: 0, atkPhase: 0, atkTarget: -1, moving: false, alive: true, ...o });

interface SnapOpts {
  tick?: number;
  me?: Partial<PlayerHud>;
  at?: { x: number; y: number };
  events?: SimEvent[];
  entities?: SnapEntity[];
}
const snap = (o: SnapOpts = {}): Snapshot =>
  ({
    tick: o.tick ?? 0,
    time: (o.tick ?? 0) / 30,
    team: 0,
    entities: [ent({ id: 1, ...(o.at ?? { x: 900, y: 900 }) }), ...(o.entities ?? [])],
    projectiles: [],
    objects: [],
    me: hud(o.me),
    events: o.events ?? [],
    players: [],
  }) as Snapshot;

/** Engine with a recorder for its own commands, started at step `id`. */
function engineAt(id: StepId, tick = 0) {
  const sent: Command[] = [];
  const progress = { done: STEP_IDS.slice(0, STEP_IDS.indexOf(id)), skipped: [] };
  const e = new TutorialEngine((c) => sent.push(c), geo, progress);
  expect(e.step?.id).toBe(id);
  e.ingest(snap({ tick })); // begins the step
  return { e, sent };
}

const player = (e: TutorialEngine, c: Command): void => e.onCommand(c);

describe('tutorial: step list', () => {
  it('has ten steps, unique ids, and de + en texts for each', () => {
    expect(STEPS.length).toBe(10);
    expect(new Set(STEP_IDS).size).toBe(10);
    for (const id of STEP_IDS) {
      for (const part of ['title', 'text', 'tip']) {
        const k = `tutorial.step.${id}.${part}`;
        expect((de as Record<string, string>)[k], k).toBeTruthy();
        expect((en as Record<string, string>)[k], k).toBeTruthy();
      }
    }
  });

  it('every placeholder in a step text is a key the step declares', () => {
    for (const s of STEPS) {
      for (const lang of [de, en] as Record<string, string>[]) {
        const vars = [...(lang[`tutorial.step.${s.id}.text`] ?? '').matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
        for (const v of vars) expect(s.keys, `${s.id}: {${v}}`).toContain(v);
      }
    }
  });
});

describe('tutorial: detection', () => {
  it('move: needs a move command AND a walk of MOVE_DIST', () => {
    const { e } = engineAt('move');
    e.ingest(snap({ tick: 1, at: { x: 900 + MOVE_DIST + 10, y: 900 } })); // pushed by something else, no command
    expect(e.done.has('move')).toBe(false);
    player(e, { t: 'move', x: 2000, y: 900 });
    e.ingest(snap({ tick: 2, at: { x: 900 + 100, y: 900 } }));
    expect(e.done.has('move')).toBe(false);
    e.ingest(snap({ tick: 3, at: { x: 900 + MOVE_DIST + 10, y: 900 } }));
    expect(e.done.has('move')).toBe(true);
    expect(e.phase).toBe('flash');
  });

  it('attackMove: the A-click command', () => {
    const { e } = engineAt('attackMove');
    player(e, { t: 'move', x: 1, y: 1 });
    e.ingest(snap({ tick: 1 }));
    expect(e.done.has('attackMove')).toBe(false);
    player(e, { t: 'attackMove', x: 1, y: 1, cursor: true });
    e.ingest(snap({ tick: 2 }));
    expect(e.done.has('attackMove')).toBe(true);
  });

  it('levelUp: sum of the Q/W/E/R ranks goes up', () => {
    const { e, sent } = engineAt('levelUp');
    expect(sent).toContainEqual({ t: 'cheat', op: 'setLevel', value: 2 }); // a second point is guaranteed
    const abilities = hud().abilities.map((a, i) => (i === 1 ? { ...a, rank: 1 } : a));
    e.ingest(snap({ tick: 20, me: { level: 2, abilities: hud().abilities } }));
    expect(e.done.has('levelUp')).toBe(false);
    e.ingest(snap({ tick: 21, me: { level: 2, abilities } }));
    expect(e.done.has('levelUp')).toBe(true);
  });

  it('cast: all four slots, own casts only, recasts ignored', () => {
    const { e, sent } = engineAt('cast');
    expect(sent).toContainEqual({ t: 'cheat', op: 'teleport', x: expect.any(Number), y: expect.any(Number) });
    const cast = (src: number, slot: number, recast = false): SimEvent => ({ e: 'cast', src, slot, x: 0, y: 0, ...(recast ? { recast: true } : {}) });
    e.ingest(snap({ tick: 1, events: [cast(1, 0), cast(99, 1), cast(1, 1, true)] }));
    expect(e.count).toBe(1);
    e.ingest(snap({ tick: 2, events: [cast(1, 1), cast(1, 2)] }));
    expect(e.count).toBe(3);
    expect(e.done.has('cast')).toBe(false);
    e.ingest(snap({ tick: 3, events: [cast(1, 3)] }));
    expect(e.done.has('cast')).toBe(true);
  });

  it('cast: prepares level 6, learns unlearned abilities, infinite mana (idempotent against the snapshot)', () => {
    const { e, sent } = engineAt('cast');
    sent.length = 0;
    const learnable = hud().abilities.map((a) => ({ ...a, canLevel: true }));
    e.ingest(snap({ tick: 20, me: { level: 6, abilities: learnable } })); // past the send throttle of tick 0
    expect(sent.filter((c) => c.t === 'levelUp').map((c) => (c as { slot: number }).slot)).toEqual([0, 1, 2, 3]);
    expect(sent).toContainEqual({ t: 'cheat', op: 'noCooldowns' });
    sent.length = 0;
    e.ingest(snap({ tick: 21, me: { level: 6, abilities: learnable, sandbox: { noCd: true, god: false } } })); // throttled / satisfied
    expect(sent.some((c) => c.t === 'cheat' && c.op === 'noCooldowns')).toBe(false);
    e.ingest(snap({ tick: 60, me: { level: 6, abilities: learnable, sandbox: { noCd: true, god: false } } }));
    expect(sent.some((c) => c.t === 'cheat' && c.op === 'noCooldowns')).toBe(false);
  });

  it('noCooldowns is switched off again after the cast step', () => {
    const { e, sent } = engineAt('shop');
    sent.length = 0;
    e.ingest(snap({ tick: 30, me: { sandbox: { noCd: true, god: false } } }));
    expect(sent).toContainEqual({ t: 'cheat', op: 'noCooldowns' });
  });

  it('shop: an item appears in the inventory (gold alone is not enough)', () => {
    const { e, sent } = engineAt('shop');
    expect(sent).toContainEqual({ t: 'cheat', op: 'gold', value: 1500 });
    e.ingest(snap({ tick: 1, me: { gold: 450 } }));
    expect(e.done.has('shop')).toBe(false);
    e.ingest(snap({ tick: 2, me: { gold: 450, items: ['trank', null, null, null, null, null] } }));
    expect(e.done.has('shop')).toBe(true);
  });

  it('ward: a trinket charge is used, or a new own ward unit appears', () => {
    const a = engineAt('ward');
    a.e.ingest(snap({ tick: 1, me: { trinket: { id: 'schleierward', charges: 1, maxCharges: 2, cdLeft: 5, cdTotal: 5, canSwap: null } } }));
    expect(a.e.done.has('ward')).toBe(true);
    const b = engineAt('ward');
    b.e.ingest(snap({ tick: 1, entities: [ent({ id: 7, kind: Kind.Ward, team: 1 })] })); // enemy ward: no
    expect(b.e.done.has('ward')).toBe(false);
    b.e.ingest(snap({ tick: 2, entities: [ent({ id: 8, kind: Kind.Ward, team: 0 })] }));
    expect(b.e.done.has('ward')).toBe(true);
  });

  it('ward: wards that existed before the step do not count', () => {
    const sent: Command[] = [];
    const e = new TutorialEngine((c) => sent.push(c), geo, { done: STEP_IDS.slice(0, 5), skipped: [] });
    const old = [ent({ id: 8, kind: Kind.Ward, team: 0 })];
    e.ingest(snap({ tick: 0, entities: old }));
    e.ingest(snap({ tick: 1, entities: old }));
    expect(e.done.has('ward')).toBe(false);
  });

  it('recall: the channel has to end in the fountain; an interrupted one starts over', () => {
    const { e } = engineAt('recall');
    e.ingest(snap({ tick: 1, me: { recallLeft: 6, inFountain: false } }));
    e.ingest(snap({ tick: 2, me: { recallLeft: 0, inFountain: false } })); // interrupted
    expect(e.done.has('recall')).toBe(false);
    e.ingest(snap({ tick: 3, me: { recallLeft: 0, inFountain: true } })); // walked home: not a recall
    expect(e.done.has('recall')).toBe(false);
    e.ingest(snap({ tick: 4, me: { recallLeft: 7, inFountain: false } }));
    e.ingest(snap({ tick: 5, me: { recallLeft: 0.1, inFountain: false } }));
    e.ingest(snap({ tick: 6, me: { recallLeft: 0, inFountain: true } }));
    expect(e.done.has('recall')).toBe(true);
  });

  it('lastHit: counts CS from the step start, shows n / 5, prepares minions once', () => {
    const { e, sent } = engineAt('lastHit');
    expect(sent.filter((c) => c.t === 'cheat' && c.op === 'toggleMinions').length).toBe(1);
    e.ingest(snap({ tick: 10, me: { cs: 0 } }));
    expect(sent.filter((c) => c.t === 'cheat' && c.op === 'spawnWave').length).toBe(1);
    e.ingest(snap({ tick: 50, me: { cs: 3 } }));
    expect(e.count).toBe(3);
    expect(e.done.has('lastHit')).toBe(false);
    e.ingest(snap({ tick: 60, me: { cs: LAST_HITS } }));
    expect(e.done.has('lastHit')).toBe(true);
    expect(sent.filter((c) => c.t === 'cheat' && c.op === 'spawnWave').length).toBe(1);
  });

  it('lastHit: CS from before the step does not count', () => {
    const sent: Command[] = [];
    const e = new TutorialEngine((c) => sent.push(c), geo, { done: STEP_IDS.slice(0, 7), skipped: [] });
    e.ingest(snap({ tick: 0, me: { cs: 12 } }));
    e.ingest(snap({ tick: 1, me: { cs: 14 } }));
    expect(e.done.has('lastHit')).toBe(false);
    expect(e.count).toBe(2);
  });

  it('tower: an enemy tower dies (own tower and minions do not count); minions stay on from the last-hit step', () => {
    const sent: Command[] = [];
    const e = new TutorialEngine((c) => sent.push(c), geo, { done: [], skipped: [] });
    e.skip(); // not engine-start semantics, only to reach later steps cheaply
    const death = (kind: number, team: number): SimEvent => ({ e: 'death', eid: 5, kind, team, killer: -1, x: 0, y: 0 });
    const t = engineAt('tower');
    t.e.ingest(snap({ tick: 1, events: [death(Kind.MinionMelee, 1), death(Kind.Tower, 0)] }));
    expect(t.e.done.has('tower')).toBe(false);
    t.e.ingest(snap({ tick: 2, events: [death(Kind.Tower, 1)] }));
    expect(t.e.done.has('tower')).toBe(true);
    // minions are toggled exactly once over the whole tutorial
    const s2: Command[] = [];
    const e2 = new TutorialEngine((c) => s2.push(c), geo, { done: STEP_IDS.slice(0, 7), skipped: [] });
    e2.ingest(snap({ tick: 0 }));
    e2.ingest(snap({ tick: 100, me: { cs: 9 } }));
    e2.skip();
    e2.ingest(snap({ tick: 101 }));
    e2.ingest(snap({ tick: 120 }));
    expect(s2.filter((c) => c.t === 'cheat' && c.op === 'toggleMinions').length).toBe(1);
    expect(s2.filter((c) => c.t === 'cheat' && c.op === 'spawnWave').length).toBe(2); // one wave per step
    expect(e.index).toBeGreaterThanOrEqual(0);
  });

  it('summoners: a summoner cooldown starts, or a D/F command was seen', () => {
    const a = engineAt('summoners');
    a.e.ingest(snap({ tick: 1 }));
    expect(a.e.done.has('summoners')).toBe(false);
    const abil = hud().abilities.map((x, i) => (i === 5 ? { ...x, cdLeft: 20, cdTotal: 20 } : x));
    a.e.ingest(snap({ tick: 2, me: { abilities: abil } }));
    expect(a.e.done.has('summoners')).toBe(true);
    const b = engineAt('summoners');
    player(b.e, { t: 'spell', slot: 0, x: 0, y: 0 });
    b.e.ingest(snap({ tick: 1 }));
    expect(b.e.done.has('summoners')).toBe(true);
  });

  it('the tutorial\'s own commands never count as player input', () => {
    const sent: Command[] = [];
    let e!: TutorialEngine;
    // wire like game.ts: every command, own ones included, passes through onCommand
    e = new TutorialEngine((c) => (sent.push(c), e.onCommand(c)), geo, { done: STEP_IDS.slice(0, 1), skipped: [] });
    e.ingest(snap({ tick: 0 }));
    expect(e.step?.id).toBe('attackMove');
    e.onCommand({ t: 'attackMove', x: 0, y: 0 });
    e.ingest(snap({ tick: 1 }));
    expect(e.done.has('attackMove')).toBe(true);
  });

  it('a dead player does not complete steps', () => {
    const { e } = engineAt('lastHit');
    e.ingest(snap({ tick: 5, me: { cs: 9, dead: true } }));
    expect(e.done.has('lastHit')).toBe(false);
    e.ingest(snap({ tick: 6, me: { cs: 9 } }));
    expect(e.done.has('lastHit')).toBe(true);
  });
});

describe('tutorial: flow', () => {
  it('flash phase, then the next step starts with its own baseline', () => {
    const e = new TutorialEngine(() => {}, geo);
    e.ingest(snap({ tick: 0 }));
    player(e, { t: 'move', x: 1, y: 1 });
    e.ingest(snap({ tick: 1, at: { x: 2000, y: 900 } }));
    expect(e.phase).toBe('flash');
    player(e, { t: 'attackMove', x: 1, y: 1 }); // during the flash: ignored
    e.ingest(snap({ tick: 1 + FLASH_TICKS - 1, at: { x: 2000, y: 900 } }));
    expect(e.step?.id).toBe('move');
    e.ingest(snap({ tick: 1 + FLASH_TICKS, at: { x: 2000, y: 900 } }));
    expect(e.step?.id).toBe('attackMove');
    e.ingest(snap({ tick: 100, at: { x: 2000, y: 900 } }));
    expect(e.done.has('attackMove')).toBe(false);
  });

  it('skip passes a step without marking it done; after the last step the engine finishes', () => {
    const e = new TutorialEngine(() => {}, geo);
    e.ingest(snap({ tick: 0 }));
    for (let i = 0; i < STEPS.length; i++) e.skip();
    expect(e.phase).toBe('finished');
    expect(e.step).toBeNull();
    expect(e.done.size).toBe(0);
    expect(e.skipped.size).toBe(STEPS.length);
    expect(isComplete(e.progress)).toBe(true);
  });

  it('resumes at the first step not done / skipped, restarts when everything was passed', () => {
    const e = new TutorialEngine(() => {}, geo, { done: ['move', 'levelUp'], skipped: ['attackMove'] });
    expect(e.step?.id).toBe('cast');
    expect(e.passed).toBe(3);
    const all = new TutorialEngine(() => {}, geo, { done: STEP_IDS, skipped: [] });
    expect(all.step?.id).toBe('move');
    expect(all.passed).toBe(0);
  });

  it('restart clears the progress', () => {
    const e = new TutorialEngine(() => {}, geo, { done: ['move'], skipped: ['attackMove'] });
    e.restart();
    expect(e.step?.id).toBe('move');
    expect(e.progress).toEqual({ done: [], skipped: [] });
  });

  it('shows the tip after TIP_TICKS in a step and notifies on change', () => {
    const e = new TutorialEngine(() => {}, geo);
    let n = 0;
    e.onChange = () => n++;
    e.ingest(snap({ tick: 100 }));
    expect(n).toBeGreaterThan(0);
    expect(e.showTip).toBe(false);
    e.ingest(snap({ tick: 100 + TIP_TICKS }));
    expect(e.showTip).toBe(true);
  });

  it('ignores snapshots without a player (spectator / loading)', () => {
    const e = new TutorialEngine(() => {}, geo);
    e.ingest({ ...snap(), me: null });
    expect(e.version).toBe(0);
  });
});

describe('tutorial: saved progress', () => {
  const mem = (): { store: Record<string, string>; api: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> } => {
    const store: Record<string, string> = {};
    return { store, api: { getItem: (k) => store[k] ?? null, setItem: (k, v) => void (store[k] = v), removeItem: (k) => void delete store[k] } };
  };

  it('round-trips and drops unknown ids / garbage', () => {
    const m = mem();
    saveProgress({ done: ['move', 'cast'], skipped: ['ward'] }, m.api);
    expect(loadProgress(m.api)).toEqual({ done: ['move', 'cast'], skipped: ['ward'] });
    expect(parseProgress('{"done":["move","bogus",3],"skipped":"x"}')).toEqual({ done: ['move'], skipped: [] });
    expect(parseProgress('not json')).toEqual({ done: [], skipped: [] });
    expect(parseProgress('null')).toEqual({ done: [], skipped: [] });
    expect(parseProgress(null)).toEqual({ done: [], skipped: [] });
    expect(STORAGE_KEY).toContain('tutorial');
  });

  it('never throws when the storage is blocked or full', () => {
    const bad: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
    };
    expect(() => saveProgress({ done: ['move'], skipped: [] }, bad)).not.toThrow();
    expect(loadProgress(bad)).toEqual({ done: [], skipped: [] });
    expect(loadProgress(null)).toEqual({ done: [], skipped: [] });
    expect(() => saveProgress({ done: [], skipped: [] }, null)).not.toThrow();
  });

  it('isComplete counts done + skipped', () => {
    expect(isComplete({ done: STEP_IDS.slice(0, 5), skipped: STEP_IDS.slice(5) })).toBe(true);
    expect(isComplete({ done: STEP_IDS.slice(0, 5), skipped: [] })).toBe(false);
  });
});

// ---------------------------------------------------------------- against the real sim

describe('tutorial: scripted walk through the sandbox sim', () => {
  it('the config is recognised and has minions off', () => {
    const c = tutorialConfig(undefined, 'mira', ['sprung', 'heilen'], 3);
    expect(isTutorialConfig(c)).toBe(true);
    expect(c.minionsEnabled).toBe(false);
    expect(isTutorialConfig({ mode: 'sandbox' })).toBe(false);
    expect(isTutorialConfig({ mode: 'laneOnly', trainer: { scenario: 'tutorial' } })).toBe(false);
  });

  it('every step is detected from real snapshots', () => {
    const sim = createSim(tutorialConfig(undefined, 'mira', ['sprung', 'heilen'], 11));
    const ownTower = sim.map.sides[0].towers.mid[0]!;
    const g: Geo = { fountain: sim.map.sides[0].fountain, ownTower, dummy: SANDBOX_DUMMY };
    const queue: TickInput[] = [];
    const engine = new TutorialEngine((cmd) => queue.push({ slot: 0, cmd }), g);
    const act = (cmd: Command): void => {
      engine.onCommand(cmd);
      queue.push({ slot: 0, cmd });
    };
    const finished: StepId[] = [];
    const at: Partial<Record<StepId, number>> = {};
    let acted = new Set<string>();
    let lastStep: StepId | null = null;
    let castN = 0;
    const MAX = 30 * 60 * 5;
    for (let i = 0; i < MAX && engine.phase !== 'finished'; i++) {
      const inputs = queue.splice(0);
      simStep(sim, inputs);
      const s = buildSnapshot(sim, 0, 0);
      engine.ingest(s);
      const cur = engine.phase === 'active' ? engine.step?.id ?? null : null;
      for (const id of engine.done) if (!finished.includes(id)) (finished.push(id), (at[id] = s.tick));
      if (cur !== lastStep) {
        lastStep = cur;
        acted = new Set();
        castN = 0;
      }
      const me = s.me!;
      const mine = s.entities.find((e) => e.id === me.eid)!;
      const once = (k: string, fn: () => void): void => {
        if (!acted.has(k)) (acted.add(k), fn());
      };
      switch (cur) {
        case 'move':
          once('a', () => act({ t: 'move', x: mine.x + 800, y: mine.y }));
          break;
        case 'attackMove':
          once('a', () => act({ t: 'attackMove', x: mine.x + 200, y: mine.y, cursor: true }));
          break;
        case 'levelUp':
          once('a', () => act({ t: 'levelUp', slot: 0 }));
          break;
        case 'cast':
          // let the preparation (level 6, learn, infinite mana, teleport) settle, then one cast per 20 ticks
          if (me.level >= 6 && me.sandbox?.noCd && me.abilities.slice(0, 4).every((a) => a.rank > 0) && i % 20 === 0) act({ t: 'cast', slot: (castN++ % 4) as 0 | 1 | 2 | 3, x: SANDBOX_DUMMY.x, y: SANDBOX_DUMMY.y });
          break;
        case 'shop':
          if (me.gold >= 1000) once('a', () => act({ t: 'buy', item: 'trank' }));
          break;
        case 'ward':
          once('a', () => act({ t: 'ward', x: mine.x + 200, y: mine.y }));
          break;
        case 'recall':
          if (me.recallLeft === 0 && i % 61 === 0 && !me.inFountain) act({ t: 'recall' });
          break;
        case 'lastHit': {
          // attack the weakest enemy minion in reach, otherwise wait at the tower for the wave
          let best: (typeof s.entities)[number] | null = null;
          for (const e of s.entities) {
            if (!isMinion(e.kind) || e.team === 0 || !e.alive) continue;
            if (Math.hypot(e.x - mine.x, e.y - mine.y) > 700 || e.hp > me.stats.ad * 1.05) continue;
            if (!best || e.hp < best.hp) best = e;
          }
          if (best && i % 6 === 0) act({ t: 'attack', target: best.id });
          else if (!best && i % 15 === 0) {
            // walk up to the nearest enemy minion (the waves meet in the middle of the lane), wait at the tower without one
            let near: (typeof s.entities)[number] | null = null;
            for (const e of s.entities) if (isMinion(e.kind) && e.team !== 0 && e.alive && (!near || Math.hypot(e.x - mine.x, e.y - mine.y) < Math.hypot(near.x - mine.x, near.y - mine.y))) near = e;
            if (near && Math.hypot(near.x - mine.x, near.y - mine.y) > 500) act({ t: 'move', x: near.x - 250, y: near.y - 250 });
          }
          break;
        }
        case 'tower':
          // ponytail: the real tower kill needs a minute-long wave walk; detection is covered by the unit test above.
          // Skipping here still checks that skip() hands over to the last step.
          engine.skip();
          break;
        case 'summoners':
          once('a', () => act({ t: 'spell', slot: 0, x: mine.x + 300, y: mine.y }));
          break;
      }
    }
    // report where it got stuck, if anywhere
    expect({ finished, stuckAt: engine.step?.id ?? null, tick: sim.tick, at }).toMatchObject({ finished: STEP_IDS.filter((id) => id !== 'tower'), stuckAt: null });
  }, 120000);
  it('the tower step is killable by one player within 90 s (weakened tower, placed in front of it)', () => {
    const sim = createSim(tutorialConfig(undefined, 'mira', ['sprung', 'heilen'], 11));
    const g: Geo = { fountain: sim.map.sides[0].fountain, ownTower: sim.map.sides[0].towers.mid[0]!, enemyTower: sim.map.sides[1].towers.mid[0]!, dummy: SANDBOX_DUMMY };
    const queue: TickInput[] = [];
    const engine = new TutorialEngine((cmd) => queue.push({ slot: 0, cmd }), g, undefined, STEPS.filter((st) => st.id === 'tower'));
    let t0 = -1;
    for (let i = 0; i < 30 * 150 && engine.phase === 'active'; i++) {
      simStep(sim, queue.splice(0));
      const snap = buildSnapshot(sim, 0, 0);
      engine.ingest(snap);
      const me = snap.me!;
      if (me.level < 9 || me.dead) continue;
      if (t0 < 0) t0 = snap.tick;
      const mine = snap.entities.find((e) => e.id === me.eid)!;
      const tower = snap.entities.find((e) => e.kind === Kind.Tower && e.team === 1 && Math.hypot(e.x - mine.x, e.y - mine.y) < 2500);
      if (tower && i % 10 === 0) queue.push({ slot: 0, cmd: { t: 'attack', target: tower.id } });
    }
    expect(engine.done.has('tower')).toBe(true);
    expect(sim.tick - t0).toBeLessThan(30 * 90);
  }, 120000);
});
