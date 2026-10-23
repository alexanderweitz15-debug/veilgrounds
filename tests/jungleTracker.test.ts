// combat-helpers first: it imports sim.ts before any system module (systems <-> sim import cycle).
import { makeSim, mira, place, steps } from './combat-helpers';
import { describe, expect, it } from 'vitest';
import { JungleTracker, campLabel, campSites, inVision, ESTIMATE_CLEAR_S } from '../src/game/jungleTracker';
import { buildSnapshot, type SnapEntity, type Snapshot } from '../src/sim/snapshot';
import { kill } from '../src/sim/damage';
import { Kind, sec, type SimEvent } from '../src/sim/types';
import { CAMPS, jungleState } from '../src/sim/systems/jungle';

const T = 30;
const BLUE = campSites().find((c) => c.key === '0:moosrudel')!;
const RED = campSites().find((c) => c.key === '1:moosrudel')!;

function ent(id: number, kind: number, team: number, x: number, y: number, more: Partial<SnapEntity> = {}): SnapEntity {
  return { id, serial: 0, kind, team, x, y, px: x, py: y, fx: 1, fy: 0, hp: 100, maxHp: 100, shield: 0, mana: 0, maxMana: 0, radius: 50, level: 1, champ: null, slot: id, atkPhase: 0, atkTarget: -1, moving: false, alive: true, ...more } as SnapEntity;
}
const champ = (id: number, team: number, x: number, y: number, slot = id): SnapEntity => ent(id, Kind.Champion, team, x, y, { champ: 'mira', slot });
const mon = (id: number, variant: string, x: number, y: number): SnapEntity => ent(id, Kind.Monster, 2, x, y, { variant } as Partial<SnapEntity>);
const snap = (tick: number, entities: SnapEntity[] = [], events: SimEvent[] = []): Snapshot => ({ tick, time: tick / T, team: 0, entities, projectiles: [], objects: [], me: null, events, players: [] });
const death = (eid: number, x: number, y: number): SimEvent => ({ e: 'death', eid, kind: Kind.Monster, team: 2, killer: 0, x, y });
const camp = (tr: JungleTracker, key: string) => tr.camps().find((c) => c.key === key)!;
const units = (m: Record<number, string>) => (eid: number) => (m[eid] ? { variant: m[eid], kind: Kind.Monster } : undefined);

describe('jungle tracker', () => {
  it('tracks 6 camps per side and both river scuttlers, red side mirrored', () => {
    expect(campSites()).toHaveLength(14);
    expect(RED.x).toBe(16000 - BLUE.x);
    expect(RED.y).toBe(16000 - BLUE.y);
  });

  it('counts down to the first spawn from the public schedule, unseen camps show "?" afterwards', () => {
    const tr = new JungleTracker();
    tr.ingest(snap(60 * T));
    expect(camp(tr, '1:moosrudel')).toMatchObject({ state: 'pending', left: 30 });
    expect(campLabel(camp(tr, '1:moosrudel'))).toBe('0:30');
    tr.ingest(snap(100 * T));
    expect(camp(tr, '1:moosrudel').state).toBe('unknown');
    expect(campLabel(camp(tr, '1:moosrudel'))).toBe('?');
  });

  it('kill seen in vision (all members): exact timer from the death tick, then "?" once it ran out unseen', () => {
    const tr = new JungleTracker();
    const me = champ(1, 0, BLUE.x + 500, BLUE.y);
    const u = units({ 10: 'mooswolf', 11: 'mooswelpe', 12: 'mooswelpe' });
    tr.ingest(snap(100 * T, [me, mon(10, 'mooswolf', BLUE.x, BLUE.y), mon(11, 'mooswelpe', BLUE.x + 170, BLUE.y), mon(12, 'mooswelpe', BLUE.x - 120, BLUE.y - 150)]), u);
    expect(camp(tr, '0:moosrudel').state).toBe('up');
    // wolf and one pup die: not cleared yet
    tr.ingest(snap(110 * T, [me, mon(12, 'mooswelpe', BLUE.x, BLUE.y)], [death(10, BLUE.x, BLUE.y), death(11, BLUE.x, BLUE.y)]), u);
    expect(camp(tr, '0:moosrudel').state).toBe('up');
    // last pup dies at tick 120*30 - 1 (events belong to the tick before the snapshot)
    tr.ingest(snap(120 * T, [me], [death(12, BLUE.x, BLUE.y)]), u);
    const c = camp(tr, '0:moosrudel');
    expect(c.state).toBe('cleared');
    expect(c.approx).toBe(false);
    expect(c.left).toBeCloseTo((120 * T - 1 + CAMPS.moosrudel.respawn * T - 120 * T) / T, 5);
    expect(campLabel(c)).toBe('2:15');
    // walks away, timer keeps counting without any new observation
    tr.ingest(snap(150 * T, [champ(1, 0, 3000, 3000)]));
    expect(camp(tr, '0:moosrudel').left).toBeCloseTo(CAMPS.moosrudel.respawn - 30, 1);
    tr.ingest(snap(300 * T, [champ(1, 0, 3000, 3000)]));
    expect(camp(tr, '0:moosrudel').state).toBe('unknown');
  });

  it('fog: a kill the team did not see starts NO timer (no event, no monsters, no vision)', () => {
    const tr = new JungleTracker();
    // enemy jungler clears the red moosrudel far from every own unit: the snapshot carries nothing about it
    tr.ingest(snap(100 * T, [champ(1, 0, 3000, 3000)]));
    tr.ingest(snap(130 * T, [champ(1, 0, 3000, 3000)]));
    const c = camp(tr, '1:moosrudel');
    expect(c.state).toBe('unknown');
    expect(c.left).toBeNull();
    expect(c.visible).toBe(false);
    expect(campLabel(c)).toBe('?');
  });

  it('fog: a partial clear (2 of 3 seen dying), then no vision, starts no timer', () => {
    const tr = new JungleTracker();
    const u = units({ 10: 'mooswolf', 11: 'mooswelpe', 12: 'mooswelpe' });
    // death events with the camp centre out of own vision (e.g. ally ward gone) must not clear the camp
    tr.ingest(snap(120 * T, [champ(1, 0, BLUE.x + 1400, BLUE.y)], [death(10, BLUE.x, BLUE.y), death(11, BLUE.x, BLUE.y)]), u);
    expect(['up', 'unknown']).toContain(camp(tr, '0:moosrudel').state);
    expect(camp(tr, '0:moosrudel').left).toBeNull();
  });

  it('camp centre in vision, empty, no kill seen: only an upper bound "~", never an exact timer', () => {
    const tr = new JungleTracker();
    tr.ingest(snap(200 * T, [champ(1, 0, RED.x + 400, RED.y)]));
    const c = camp(tr, '1:moosrudel');
    expect(c).toMatchObject({ state: 'empty', approx: true, visible: true });
    expect(c.left).toBeCloseTo(CAMPS.moosrudel.respawn, 5);
    expect(campLabel(c)).toBe('~2:15');
    // upper bound passed -> it must be back, unseen
    tr.ingest(snap(200 * T + (CAMPS.moosrudel.respawn + 1) * T, [champ(1, 0, 3000, 3000)]));
    expect(camp(tr, '1:moosrudel').state).toBe('unknown');
  });

  it('seeing the camp empty before its first spawn says nothing', () => {
    const tr = new JungleTracker();
    tr.ingest(snap(40 * T, [champ(1, 0, RED.x + 400, RED.y)]));
    expect(camp(tr, '1:moosrudel').state).toBe('pending');
  });

  it('wards and minions count as vision with their own radius; a disabled ward (vision 0) does not', () => {
    const ward = ent(5, Kind.Ward, 0, RED.x, RED.y, { vision: 900 } as Partial<SnapEntity>);
    expect(inVision([ward], RED.x + 400, RED.y)).toBe(true);
    expect(inVision([{ ...ward, vision: 0 }], RED.x, RED.y)).toBe(false);
    expect(inVision([champ(1, 0, RED.x + 1100, RED.y)], RED.x, RED.y)).toBe(false); // inside the 300 margin of 1200
  });

  it('two river scuttlers are independent', () => {
    const tr = new JungleTracker();
    const [a, b] = campSites().filter((c) => c.id === 'nebelschleicher');
    const u = units({ 20: 'nebelschleicher' });
    tr.ingest(snap(250 * T, [champ(1, 0, a!.x + 300, a!.y), mon(20, 'nebelschleicher', a!.x, a!.y)]), u);
    tr.ingest(snap(260 * T, [champ(1, 0, a!.x + 300, a!.y)], [death(20, a!.x, a!.y)]), u);
    expect(camp(tr, a!.key).state).toBe('cleared');
    expect(camp(tr, a!.key).left).toBeCloseTo(CAMPS.nebelschleicher.respawn, 1);
    expect(camp(tr, b!.key).state).toBe('unknown');
  });

  it('estimate: off by default, shown only as marked estimate with the option on, observation wins', () => {
    const tr = new JungleTracker();
    tr.setJunglers([6]);
    const jg = champ(2, 1, RED.x + 600, RED.y, 6);
    // own champion 2500 away: camp not visible, enemy jungler visible next to it
    tr.ingest(snap(200 * T, [champ(1, 0, RED.x + 2900, RED.y), jg]));
    expect(camp(tr, '1:moosrudel').state).toBe('unknown'); // option off
    tr.estimate = true;
    const c = camp(tr, '1:moosrudel');
    expect(c.state).toBe('estimate');
    expect(c.approx).toBe(true);
    expect(c.left).toBeCloseTo(ESTIMATE_CLEAR_S + CAMPS.moosrudel.respawn, 5);
    expect(campLabel(c)).toBe('~2:40?');
    // a non-jungler enemy does not trigger it
    const tr2 = new JungleTracker();
    tr2.setJunglers([6]);
    tr2.estimate = true;
    tr2.ingest(snap(200 * T, [champ(1, 0, RED.x + 2900, RED.y), champ(3, 1, RED.x + 600, RED.y, 7)]));
    expect(camp(tr2, '1:moosrudel').state).toBe('unknown');
    // monsters seen alive afterwards: the guess is gone
    tr.ingest(snap(210 * T, [champ(1, 0, RED.x + 500, RED.y), mon(30, 'mooswolf', RED.x, RED.y)]));
    expect(camp(tr, '1:moosrudel').state).toBe('up');
  });
});

describe('jungle tracker against the real sim', () => {
  it('timer matches the sim respawn tick; a kill in the fog produces no event and no timer', () => {
    const sim = makeSim();
    steps(sim, sec(95));
    const me = mira(sim);
    const js = jungleState(sim);
    const blue = js.camps.find((c) => c.id === 'moosrudel' && c.side === 0)!;
    const red = js.camps.find((c) => c.id === 'moosrudel' && c.side === 1)!;
    const tr = new JungleTracker();
    const known = new Map<number, { variant?: string; kind?: number }>();
    const feed = (): void => {
      const s = buildSnapshot(sim, 0, 0);
      for (const e of s.entities) known.set(e.id, e);
      tr.ingest(s, (eid) => known.get(eid));
    };
    place(sim, me, blue.x + 300, blue.y);
    steps(sim, 3);
    feed();
    expect(tr.camps().find((c) => c.key === '0:moosrudel')!.state).toBe('up');
    // enemy camp is dropped far from every own unit: kill it, nothing may reach the snapshot
    for (const m of red.members) kill(sim, m.eid, -1);
    sim.tick++;
    feed();
    expect(tr.camps().find((c) => c.key === '1:moosrudel')!.state).toBe('unknown');
    // own camp: kill all members in vision
    for (const m of blue.members) kill(sim, m.eid, me);
    sim.tick++;
    feed();
    const view = tr.camps().find((c) => c.key === '0:moosrudel')!;
    expect(view.state).toBe('cleared');
    expect(sim.tick + view.left! * T).toBeCloseTo(blue.spawnAt, 0);
  });
});
