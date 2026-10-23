// Ping system: context texts, spam limit (client + sim), wheel picking, per-kind animation, camp/objective labels.
import { describe, expect, it } from 'vitest';
import { abilityPingText, clock, cooldownPingText, itemPingText, laneNear, missingPingText, objectivePingText } from '../src/game/pingText';
import { CLIENT_PING_MAX, LOCKOUT_MS, MIN_GAP_MS, PingLimiter } from '../src/game/pingLimiter';
import { PingSender } from '../src/game/pingSender';
import { CampTimers, defaultCamps } from '../src/game/campTimers';
import { missingAt, objectiveAt, type PingCtx } from '../src/game/contextPing';
import { PING_STYLE, pingFrame } from '../src/render/pingAnim';
import { PING_ICON, WHEEL, pickWheel } from '../src/ui/pingWheel';
import { PING_MAX, PING_WINDOW, cleanPingLabel, pingAllowed } from '../src/sim/pingRules';
import { PING_KINDS, Kind, type Command } from '../src/sim/types';
import { loadMap } from '../src/sim/map';
import { CAMPS } from '../src/sim/systems/jungle';
import { createSim, step } from '../src/sim/sim';
import { buildSnapshot } from '../src/sim/snapshot';
import de from '../src/i18n/de.json';

describe('ping texts (de)', () => {
  it('objective timer', () => {
    expect(objectivePingText('Flussleviathan', 83)).toBe('Flussleviathan in 1:23');
    expect(objectivePingText('Flussleviathan', 0.2)).toBe('Flussleviathan in 0:01');
    expect(objectivePingText('Flussleviathan', null)).toBe('Flussleviathan ist da!');
    expect(objectivePingText('Flussleviathan', 0)).toBe('Flussleviathan ist da!');
  });
  it('enemy summoner / item cooldown', () => {
    expect(cooldownPingText('Blitz', 130)).toBe('Blitz nicht bereit (2:10)');
    expect(cooldownPingText('Blitz', null)).toBe('Blitz bereit');
    expect(itemPingText('Wren', 'Sturmklinge')).toBe('Wren hat Sturmklinge');
  });
  it('own ability', () => {
    expect(abilityPingText('Q', 3.2)).toBe('Q bereit in 4 s');
    expect(abilityPingText('Q', 0)).toBe('Q bereit');
    expect(abilityPingText('R', 0, false)).toBe('R nicht gelernt');
    expect(abilityPingText('R', 95)).toBe('R bereit in 1:35');
  });
  it('missing, clock, label length', () => {
    expect(missingPingText('Wren')).toBe('Wren vermisst');
    expect(clock(-5)).toBe('0:00');
    expect(clock(600)).toBe('10:00');
    expect(objectivePingText('X'.repeat(80), 5).length).toBeLessThanOrEqual(40);
  });
  it('every PingKind has name, colour glyph and animation style', () => {
    for (const k of PING_KINDS) {
      expect(de).toHaveProperty([`ping.${k}`]);
      expect(PING_ICON[k]).toBeTruthy();
      expect(PING_STYLE[k]).toBeTruthy();
    }
  });
});

describe('spam limit', () => {
  it('client limiter: burst, then lock-out, then free again', () => {
    const l = new PingLimiter();
    let t = 0;
    for (let i = 0; i < CLIENT_PING_MAX; i++) {
      expect(l.try(t)).toBe('ok');
      t += MIN_GAP_MS + 10;
    }
    expect(l.try(t)).toBe('limited');
    expect(l.waitS(t)).toBeGreaterThan(0);
    expect(l.try(t + LOCKOUT_MS - 1)).toBe('limited');
    expect(l.try(t + 4100)).toBe('ok'); // window slid on
  });
  it('double click inside MIN_GAP_MS is one ping', () => {
    const l = new PingLimiter();
    expect(l.try(1000)).toBe('ok');
    expect(l.try(1000 + MIN_GAP_MS - 1)).toBe('tooFast');
  });
  it('sender: sends labelled commands, reports the limit', () => {
    const sent: Command[] = [];
    let limited = 0;
    let now = 0;
    const s = new PingSender((c) => sent.push(c), () => limited++, () => now);
    expect(s.ping({ kind: 'objective', x: 1, y: 2, target: 7, label: 'Flussleviathan in 1:23' })).toBe(true);
    expect(sent[0]).toEqual({ t: 'ping', kind: 'objective', x: 1, y: 2, target: 7, label: 'Flussleviathan in 1:23' });
    for (let i = 0; i < 12; i++) {
      now += 200;
      s.ping({ kind: 'danger', x: i, y: 0 });
    }
    expect(sent.length).toBe(CLIENT_PING_MAX);
    expect(limited).toBeGreaterThan(0);
  });
  it('sim rule: PING_MAX per window, window slides', () => {
    const recent = Array.from({ length: PING_MAX }, (_, i) => 100 + i);
    expect(pingAllowed(recent, 100 + PING_MAX)).toBe(false);
    expect(pingAllowed(recent, 100 + PING_WINDOW)).toBe(true);
    expect(pingAllowed([], 0)).toBe(true);
  });
  it('sim: label is cleaned and delivered, spam is dropped', () => {
    expect(cleanPingLabel('  Q\nbereit \t in 4 s ')).toBe('Q bereit in 4 s');
    expect(cleanPingLabel('x'.repeat(90))!.length).toBe(40);
    expect(cleanPingLabel('   ')).toBeUndefined();
    expect(cleanPingLabel(42)).toBeUndefined();
    const sim = createSim({ seed: 4, mode: 'sandbox', minionsEnabled: false, players: [
      { slot: 0, team: 0, champion: 'mira', role: 'adc', summoners: ['sprung', 'heilen'], isHuman: true },
      { slot: 5, team: 1, champion: 'brom', role: 'top', summoners: ['sprung', 'entflammen'], isHuman: false },
    ] });
    step(sim);
    step(sim, [{ slot: 0, cmd: { t: 'ping', kind: 'alert', x: 500, y: 500, label: 'Q bereit in 4 s' } }]);
    const ev = buildSnapshot(sim, 0, 0).events.filter((e) => e.e === 'ping');
    expect(ev.length).toBe(1);
    expect(ev[0]!.e === 'ping' && ev[0]!.label).toBe('Q bereit in 4 s');
    let n = 1;
    for (let i = 0; i < 12; i++) {
      step(sim, [{ slot: 0, cmd: { t: 'ping', kind: 'danger', x: 1000 + i, y: 1000 } }]);
      n += sim.events.filter((e) => e.e === 'ping').length;
    }
    expect(n).toBe(PING_MAX);
  });
});

describe('wheel and animation', () => {
  it('wheel: centre = alert, eight directions, clockwise from the top', () => {
    expect(pickWheel(0, 0)).toBe('alert');
    expect(pickWheel(0, -80)).toBe(WHEEL[0]);
    expect(pickWheel(80, 0)).toBe(WHEEL[2]);
    expect(pickWheel(0, 80)).toBe(WHEEL[4]);
    expect(pickWheel(-80, 0)).toBe(WHEEL[6]);
    // the seven LoL pings are on the wheel (+ "Alles OK"/"Gruppieren"), alert is the centre
    for (const k of ['danger', 'onMyWay', 'back', 'missing', 'vision', 'help'] as const) expect(WHEEL).toContain(k);
  });
  it('kinds animate differently: back pulls rings inwards, danger pushes outwards, calm mode is still', () => {
    const early = 120;
    expect(pingFrame('back', early, false).waveR).toBeLessThan(500);
    expect(pingFrame('back', 0, false).waveR).toBeGreaterThan(pingFrame('back', 400, false).waveR);
    expect(pingFrame('danger', 0, false).waveR).toBeLessThan(pingFrame('danger', 300, false).waveR);
    expect(pingFrame('danger', 500, false).iconRot).not.toBe(pingFrame('help', 500, false).iconRot);
    const calm = pingFrame('danger', 700, true);
    expect(calm.waveOn).toBe(false);
    expect(calm.iconRot).toBe(0);
    expect(calm.iconDy).toBe(0);
    expect(pingFrame('ok', 2900, false).fade).toBeLessThan(0.5);
    expect(pingFrame('ok', 100, false).fade).toBe(1);
  });
});

describe('context labels', () => {
  const map = loadMap();
  const camps = new CampTimers();
  const ctx = (over: Partial<PingCtx> = {}): PingCtx => ({
    epics: [{ kind: 'leviathan', left: 83 }, { kind: 'schleier', left: 600 }],
    camps,
    tick: 3000,
    pits: { leviathan: map.objectives.leviathan, kesselbrut: map.objectives.kesselbrut },
    lanes: map.sides[0].lanes,
    myTeam: 0,
    ...over,
  });

  it('pit carries its timer; epic monster says it is up', () => {
    const p = map.objectives.leviathan;
    expect(objectiveAt(ctx(), p.x + 200, p.y)).toMatchObject({ kind: 'objective', x: p.x, y: p.y, label: 'Flussleviathan in 1:23' });
    const k = map.objectives.kesselbrut;
    expect(objectiveAt(ctx(), k.x, k.y)?.label).toBe('Schleierwächter in 10:00'); // no Kesselbrut timer left -> pit holds the Wächter
    const hover = { id: 9, kind: Kind.Monster, team: 2, x: p.x, y: p.y, radius: 130, variant: 'leviathan' };
    expect(objectiveAt(ctx(), 0, 0, hover)).toMatchObject({ kind: 'objective', target: 9, label: 'Flussleviathan ist da!' });
    expect(objectiveAt(ctx(), 8000, 8000)).toBeNull();
  });

  it('camp timer starts when the last monster was seen to die', () => {
    const spot = defaultCamps().find((c) => c.key === 'moosrudel:0')!;
    const n = CAMPS.moosrudel.monsters.length;
    const t0 = new CampTimers();
    for (let i = 0; i < n - 1; i++) t0.noteDeath(spot.x + 40, spot.y, 1000);
    expect(t0.left(spot, 1000)).toBeNull(); // pack not cleared yet
    t0.noteDeath(spot.x, spot.y + 30, 1030);
    expect(t0.left(spot, 1030)).toBeCloseTo(CAMPS.moosrudel.respawn, 5);
    expect(t0.left(spot, 1030 + 30 * CAMPS.moosrudel.respawn)).toBeNull();
    const c = ctx({ camps: t0, tick: 1030 + 30 * 100 });
    expect(objectiveAt(c, spot.x, spot.y)).toMatchObject({ kind: 'alert' });
    expect(objectiveAt(c, spot.x, spot.y)?.label).toMatch(/ in \d:\d\d$/);
    // the red mirror camp is a separate spot
    expect(t0.left(defaultCamps().find((x) => x.key === 'moosrudel:1')!, 1030)).toBeNull();
  });

  it('missing: enemy champion by name, else the lane', () => {
    const enemy = { id: 3, kind: Kind.Champion, team: 1, x: 900, y: 800, radius: 40, champ: 'wren' };
    expect(missingAt(ctx(), 0, 0, enemy)).toMatchObject({ kind: 'missing', target: 3, x: 900, y: 800 });
    expect(missingAt(ctx(), 0, 0, enemy).label).toMatch(/ vermisst$/);
    const mid = map.sides[0].lanes.mid[Math.floor(map.sides[0].lanes.mid.length / 2)]!;
    expect(laneNear(mid.x, mid.y, ctx().lanes)).toBe('mid');
    expect(missingAt(ctx(), mid.x, mid.y).label).toBe('Mid vermisst');
    expect(missingAt(ctx(), 200, 15800).label).toBeUndefined();
  });
});
