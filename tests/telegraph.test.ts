// Telegraph audit ("Hitbox = sichtbare Fläche"): the drawn shape of every ability equals the sim hitbox.
// 1) geometry from data for all champions / abilities / ranks, 2) the same telegraph vs the live headless sim
// (zone events, line projectiles, cone hits, wind-up ticks), 3) line zones vs the sim's exported lineSegment.
import { describe, expect, it } from 'vitest';
import { query } from 'bitecs';
import { step, type Sim } from '../src/sim/sim';
import { champions } from '../src/data/champions';
import { champAbil, lineSegment, maxRank, rv } from '../src/sim/systems/abilities';
import type { AbilityData } from '../src/sim/champions/schema';
import type { SimEvent } from '../src/sim/types';
import { CHAMPION_HOOKS } from '../src/sim/champions';
import { hasBuff } from '../src/sim/buffs';
import { castTelegraph, emitsZone, hitboxAbility, lineZone, projectileStrip, rankVal, windupTicks, type CircleShape, type ConeShape, type LineShape } from '../src/render/telegraph';
import { CX, CY, makeSim, place } from './combat-helpers';

const ids = Object.keys(champions);
const len = (s: LineShape): number => Math.hypot(s.bx - s.ax, s.by - s.ay);
const simWindup = (ab: AbilityData): number =>
  Math.round((ab.castTime + (ab.type === 'blink' || ab.type === 'cone' || ab.type === 'skillshot_line' ? (ab.delay ?? 0) : 0)) * 30);
const all = ids.flatMap((id) => champions[id]!.abilities.map((ab, slot) => ({ id, slot, ab })));

describe('telegraph geometry from data (all champions)', () => {
  it('covers the full roster', () => {
    expect(ids.length).toBe(27);
  });

  const O = { x: 3000, y: 4000 };
  const cursors = [
    { x: O.x + 300, y: O.y + 400 }, // 500 away
    { x: O.x - 3000, y: O.y + 4000 }, // 5000 away (clamped by range)
  ];
  for (const { id, slot, ab } of all) {
    it(`${id} ${'QWER'[slot]} (${ab.type})`, () => {
      for (let rank = 1; rank <= maxRank(slot); rank++) {
        const range = rv(ab.range, rank);
        expect(rankVal(ab.range, rank)).toBe(range);
        expect(windupTicks(ab)).toBe(simWindup(ab));
        for (const c of cursors) {
          const tel = castTelegraph(ab, rank, O.x, O.y, c.x, c.y, 1, 0);
          const cd = Math.hypot(c.x - O.x, c.y - O.y);
          const ux = (c.x - O.x) / cd;
          const uy = (c.y - O.y) / cd;
          switch (ab.type) {
            case 'skillshot_line': {
              const s = tel!.shapes[0] as LineShape;
              expect(s.k).toBe('line');
              expect(len(s)).toBeCloseTo(range, 6);
              expect(s.width).toBe(ab.width ?? 60);
              expect([s.ax, s.ay]).toEqual([O.x, O.y]);
              expect((s.bx - s.ax) * uy - (s.by - s.ay) * ux).toBeCloseTo(0, 6); // along the cast direction
              expect(tel!.ticks).toBe(simWindup(ab));
              expect(tel!.next).toBe('projectile');
              break;
            }
            case 'skillshot_circle':
            case 'zone':
            case 'summon': {
              const d = Math.min(range, cd);
              const cx = O.x + ux * d;
              const cy = O.y + uy * d;
              const hab = hitboxAbility(ab); // Wren W / Lysa E: hook-owned lines
              if (hab.line) {
                const s = tel!.shapes[0] as LineShape;
                const seg = lineSegment(hab, O.x, O.y, cx, cy, ux, uy);
                expect([s.ax, s.ay, s.bx, s.by].map((v, i) => v - seg[i]!).every((v) => Math.abs(v) < 1e-6)).toBe(true);
                expect(len(s)).toBeCloseTo(2 * (ab.radius ?? 0), 6);
                expect(s.width).toBe(ab.width ?? 0);
              } else if (ab.radius) {
                const s = tel!.shapes[0] as CircleShape;
                expect(s.k).toBe('circle');
                expect(s.r).toBe(ab.radius);
                expect(s.x).toBeCloseTo(cx, 6);
                expect(s.y).toBeCloseTo(cy, 6);
              } else expect(tel).toBeNull();
              if (tel) expect(tel.ticks).toBe(simWindup(ab));
              break;
            }
            case 'cone': {
              const s = tel!.shapes[0] as ConeShape;
              expect(s.k).toBe('cone');
              expect(s.halfAngleDeg * 2).toBe(ab.angle ?? 60);
              expect(s.range).toBe(range);
              expect([s.x, s.y]).toEqual([O.x, O.y]);
              expect(s.dx).toBeCloseTo(ux, 9);
              expect(s.dy).toBeCloseTo(uy, 9);
              expect(tel!.ticks).toBe(simWindup(ab));
              break;
            }
            case 'self':
              if (ab.radius) {
                const s = tel!.shapes[0] as CircleShape;
                expect([s.k, s.x, s.y, s.r]).toEqual(['circle', O.x, O.y, ab.radius]);
                expect(tel!.follow).toBe(true);
              } else expect(tel).toBeNull();
              break;
            case 'targeted':
              expect(tel).toBeNull();
              break;
            case 'blink':
              if (!ab.radius) expect(tel).toBeNull();
              else expect((tel!.shapes[0] as CircleShape).r).toBe(ab.radius);
              break;
            case 'dash': {
              if (!ab.radius && !ab.width) {
                expect(tel).toBeNull();
                break;
              }
              const dist = ab.flags?.includes('ground_target') ? Math.min(ab.distance ?? range, cd) : (ab.distance ?? range);
              for (const s of tel!.shapes) {
                if (s.k === 'circle') {
                  expect(s.r).toBe(ab.radius);
                  expect(Math.hypot(s.x - O.x, s.y - O.y)).toBeCloseTo(dist, 6);
                } else if (s.k === 'line') {
                  expect(s.width).toBe(ab.width);
                  expect(len(s)).toBeCloseTo(dist, 6);
                }
              }
              break;
            }
          }
        }
      }
    });
  }

  it('projectile strip runs from the projectile to the end of its range at the real width', () => {
    const s = projectileStrip(100, 200, 0.6, 0.8, 500, 70);
    expect([s.ax, s.ay, s.bx, s.by, s.width]).toEqual([100, 200, 400, 600, 70]);
  });
});

// ------------------------------------------------------------------ live sim

interface Cast {
  sim: Sim;
  eid: number;
  castTick: number;
  tel: ReturnType<typeof castTelegraph>;
  /** First zone event of the caster and the tick it was pushed. */
  zone: { ev: Extract<SimEvent, { e: 'zone' }>; tick: number } | null;
  /** First own line projectile: tick it appeared, width, max range. */
  proj: { tick: number; width: number; maxDist: number; x: number; y: number; dx: number; dy: number } | null;
  hits: { tick: number; dst: number }[];
}

function castIn(id: string, slot: number, rank: number, cx: number, cy: number, dummies: { x: number; y: number }[] = [], ticks = 120, enemy?: { x: number; y: number }): Cast {
  const sim = makeSim({
    players: [
      { slot: 0, team: 0, champion: id, role: 'mid', summoners: ['sprung', 'heilen'], isHuman: true },
      ...(enemy ? [{ slot: 5, team: 1 as const, champion: 'brom', role: 'top' as const, summoners: ['sprung', 'heilen'] as [string, string], isHuman: true }] : []),
    ],
    dummies: dummies.map((d) => ({ ...d, team: 1 as const })),
  });
  const eid = sim.slots[0]!;
  place(sim, eid, CX, CY);
  if (enemy) place(sim, sim.slots[5]!, enemy.x, enemy.y);
  sim.c.Champ.level[eid] = 18;
  step(sim);
  champAbil(sim, eid).ranks[slot] = rank;
  sim.c.Mana.cur[eid] = sim.c.Mana.max[eid] = 100000;
  const { Pos, Face, Proj } = sim.c;
  const ab = champions[id]!.abilities[slot]!;
  // Aurel's passive (ready at spawn) casts 30 % faster: the cast event's `at` carries it (render prefers `at`)
  const mult = id === 'aurel' ? 0.7 : 1;
  const tel = castTelegraph(ab, rank, Pos.x[eid]!, Pos.y[eid]!, cx, cy, Face.x[eid]!, Face.y[eid]!, mult);
  const castTick = sim.tick;
  const known = new Set(query(sim.world, [Proj]));
  const out: Cast = { sim, eid, castTick, tel, zone: null, proj: null, hits: [] };
  for (let i = 0; i < ticks; i++) {
    const t = sim.tick;
    step(sim, i === 0 ? [{ slot: 0, cmd: { t: 'cast', slot: slot as 0 | 1 | 2 | 3, x: cx, y: cy } }] : []);
    if (i === 0) {
      const ce = sim.events.find((e) => e.e === 'cast' && e.src === eid && e.slot === slot);
      expect(ce).toBeDefined();
      if (ce?.e === 'cast') expect(ce.at! - castTick).toBe(windupTicks(ab, mult));
    }
    for (const e of sim.events) {
      if (e.e === 'zone' && e.src === eid && !out.zone) out.zone = { ev: e, tick: t };
      if (e.e === 'damage' && e.src === eid) out.hits.push({ tick: t, dst: e.dst });
    }
    if (!out.proj) {
      for (const p of query(sim.world, [Proj])) {
        if (known.has(p) || Proj.kind[p] !== 1 || Proj.src[p] !== eid) continue;
        out.proj = { tick: t, width: Proj.width[p]!, maxDist: Proj.maxDist[p]!, x: Pos.px[p]!, y: Pos.py[p]!, dx: Proj.dx[p]!, dy: Proj.dy[p]! };
        break;
      }
    }
  }
  return out;
}

const near = { x: CX + 360, y: CY + 150 };
const far = { x: CX + 1450, y: CY - 380 };

describe('telegraph vs sim', () => {
  const ground = all.filter(({ ab }) => ab.type === 'skillshot_circle' || ab.type === 'zone' || ab.type === 'summon');
  for (const { id, slot, ab } of ground) {
    it(`${id} ${'QWER'[slot]} ${ab.type}: zone event = telegraph (centre, radius/line, ticks)`, () => {
      for (const rank of [1, maxRank(slot)]) {
        for (const c of [near, far]) {
          const r = castIn(id, slot, rank, c.x, c.y);
          expect(!!r.zone).toBe(emitsZone(ab, rank));
          if (!r.zone || !r.tel) continue;
          const ev = r.zone.ev;
          expect(r.zone.tick - r.castTick).toBe(r.tel.ticks);
          expect(r.tel.next).toBe('zone');
          const s = r.tel.shapes[0]!;
          const hab = hitboxAbility(ab);
          if (!ev.line && hab.line) {
            // hook-owned line (Wren W, Lysa E): the sim's zone event still carries the generic circle centre
            const d = Math.hypot(ev.x - CX, ev.y - CY);
            const want = lineZone(hab, CX, CY, ev.x, ev.y, (ev.x - CX) / d, (ev.y - CY) / d);
            for (const k of ['ax', 'ay', 'bx', 'by', 'width'] as const) expect((s as LineShape)[k]).toBeCloseTo(want[k], 6);
          } else if (ev.line) {
            expect(s.k).toBe('line');
            const l = s as LineShape;
            for (const k of ['ax', 'ay', 'bx', 'by', 'width'] as const) expect(l[k]).toBeCloseTo(ev.line[k], 6);
          } else {
            expect(s).toMatchObject({ k: 'circle' });
            const cs = s as CircleShape;
            expect(cs.x).toBeCloseTo(ev.x, 6);
            expect(cs.y).toBeCloseTo(ev.y, 6);
            expect(cs.r).toBe(ev.r);
          }
          const dur = ab.type === 'zone' ? Math.round(rv(ab.duration, rank) * 30) : 0;
          expect(ev.until).toBe(dur > 0 ? ev.at + dur : undefined);
        }
      }
    });
  }

  const lines = all.filter(({ ab }) => ab.type === 'skillshot_line');
  for (const { id, slot, ab } of lines) {
    it(`${id} ${'QWER'[slot]} skillshot_line: projectile = strip (origin, width, range, spawn tick)`, () => {
      for (const rank of [1, maxRank(slot)]) {
        const r = castIn(id, slot, rank, near.x, near.y, [], Math.max(60, windupTicks(ab) + 10));
        const s = r.tel!.shapes[0] as LineShape;
        expect(r.proj).not.toBeNull();
        const p = r.proj!;
        expect(p.tick - r.castTick).toBe(r.tel!.ticks);
        expect(p.width).toBe(s.width);
        expect(p.maxDist).toBeCloseTo(len(s), 6);
        expect(p.x).toBeCloseTo(s.ax, 6);
        expect(p.y).toBeCloseTo(s.ay, 6);
        expect(p.dx).toBeCloseTo((s.bx - s.ax) / len(s), 9);
        expect(p.dy).toBeCloseTo((s.by - s.ay) / len(s), 9);
      }
    });
  }

  it('line zones (Oleth R): telegraph strip = sim lineSegment = zone event line', () => {
    const lineAbs = all.filter(({ ab }) => ab.line);
    expect(lineAbs.length).toBeGreaterThan(0);
    for (const { id, slot, ab } of lineAbs) {
      const r = castIn(id, slot, maxRank(slot), near.x, near.y);
      const s = r.tel!.shapes[0] as LineShape;
      const ox = CX;
      const oy = CY;
      const d = Math.min(rv(ab.range, maxRank(slot)), Math.hypot(near.x - ox, near.y - oy));
      const ux = (near.x - ox) / Math.hypot(near.x - ox, near.y - oy);
      const uy = (near.y - oy) / Math.hypot(near.x - ox, near.y - oy);
      const seg = lineSegment(ab, ox, oy, ox + ux * d, oy + uy * d, ux, uy);
      expect(s.ax).toBeCloseTo(seg[0], 6);
      expect(s.ay).toBeCloseTo(seg[1], 6);
      expect(s.bx).toBeCloseTo(seg[2], 6);
      expect(s.by).toBeCloseTo(seg[3], 6);
      expect(r.zone?.ev.line).toBeDefined();
    }
  });

  it('self AoE with a delay (Brom Q): zone event around the caster after castTime', () => {
    const ab = champions.brom!.abilities[0];
    const r = castIn('brom', 0, 5, near.x, near.y);
    expect(r.tel!.follow).toBe(true);
    expect(r.tel!.next).toBe('zone');
    expect(r.zone!.tick - r.castTick).toBe(r.tel!.ticks);
    expect(r.zone!.ev.r).toBe(ab.radius);
    expect([r.zone!.ev.x, r.zone!.ev.y]).toEqual([CX, CY]);
    expect(r.zone!.ev.follow).toBe(true);
  });

  it('Wren W (hook ash carpet): hits the drawn 900 x 200 forward strip, not the zone circle', () => {
    const ab = champions.wren!.abilities[1];
    const c = { x: CX + 360, y: CY };
    // on strip (lateral 160 <= 100 + 65), off strip but inside the generic circle (lateral 175), strip end (900 + 65)
    const dummies = [{ x: CX + 600, y: CY + 160 }, { x: CX + 600, y: CY - 175 }, { x: CX + 960, y: CY }];
    const r = castIn('wren', 1, 5, c.x, c.y, dummies, windupTicks(ab) + 4);
    const s = r.tel!.shapes[0] as LineShape;
    expect([s.k, s.ax, s.ay, s.bx, s.by, s.width]).toEqual(['line', CX, CY, CX + 900, CY, 200]);
    const ents = [...query(r.sim.world, [r.sim.c.Unit])].filter((e) => r.sim.c.Unit.kind[e] === 9).sort((p, q) => p - q);
    expect(ents.map((e) => hasBuff(r.sim, e, 'slow', 'wren_w'))).toEqual([true, false, true]);
  });

  it('Lysa E (hook tripwire): enemy champion touching the drawn wire is rooted', () => {
    const ab = champions.lysa!.abilities[2];
    const c = { x: CX + 500, y: CY };
    for (const [enemy, rooted] of [
      [{ x: CX + 500 + 80, y: CY + 200 }, true], // 80 <= 20 + 65
      [{ x: CX + 500 + 90, y: CY }, false],
    ] as const) {
      const r = castIn('lysa', 2, 5, c.x, c.y, [], windupTicks(ab) + 5, enemy);
      const s = r.tel!.shapes[0] as LineShape;
      expect([s.k, s.ax, s.ay, s.bx, s.by, s.width]).toEqual(['line', CX + 500, CY - 250, CX + 500, CY + 250, 40]);
      expect(hasBuff(r.sim, r.sim.slots[5]!, 'root', 'lysa_e')).toBe(rooted);
    }
  });

  // cones with generic damage: a dummy inside the sector is hit exactly when the wind-up (castTime + delay) ends;
  // a unit is hit when its hitbox touches the drawn sector (arc: range + radius; sides: circleInCone)
  const cones = all.filter(({ id, ab }) => ab.type === 'cone' && ab.effects.some((e) => e.kind === 'damage') && !CHAMPION_HOOKS[id]?.ownsHits?.includes(ab.id));
  for (const { id, slot, ab } of cones) {
    it(`${id} ${'QWER'[slot]} cone: hit tick = telegraph ticks, hitbox touching the drawn sector is hit`, () => {
      const rank = maxRank(slot);
      const range = rv(ab.range, rank);
      const half = ((ab.angle ?? 60) / 2) * (Math.PI / 180);
      const a = half * 0.8; // inside the angle
      const dIn = Math.min(range * 0.6, 1200);
      const inside = { x: CX + Math.cos(a) * dIn, y: CY + Math.sin(a) * dIn };
      const edge = Math.min(range + 65 - 1, 1450);
      const atEdge = { x: CX + edge, y: CY };
      const beyond = { x: CX + range + 65 + 5, y: CY };
      // just outside a side edge: hitbox (65) overlaps by 15 -> hit; 15 clear -> not hit
      const D = Math.min(range * 0.5, 500);
      const side = (p: number) => ({ x: CX + Math.cos(half) * D - Math.sin(half) * p, y: CY + Math.sin(half) * D + Math.cos(half) * p });
      const dummies = [inside, side(50), side(80), ...(range + 70 <= 1450 ? [atEdge, beyond] : [])];
      const r = castIn(id, slot, rank, CX + 300, CY, dummies, windupTicks(ab) + 6);
      const s = r.tel!.shapes[0] as ConeShape;
      expect(s.range).toBe(range);
      const first = r.hits[0];
      expect(first).toBeDefined();
      expect(first!.tick - r.castTick).toBe(r.tel!.ticks);
      const hitIds = new Set(r.hits.filter((h) => h.tick === first!.tick).map((h) => h.dst));
      const ents = [...query(r.sim.world, [r.sim.c.Unit])].filter((e) => r.sim.c.Unit.kind[e] === 9).sort((p, q) => p - q);
      expect([0, 1, 2].map((i) => hitIds.has(ents[i]!))).toEqual([true, true, false]);
      if (dummies.length === 5) expect([3, 4].map((i) => hitIds.has(ents[i]!))).toEqual([true, false]);
    });
  }
});

// ------------------------------------------------------------------ render smoke (Fx runs headless: THREE without a canvas)

describe('Fx telegraph rendering (smoke)', () => {
  it('previews, zones and flight strips appear and expire without throwing', async () => {
    const { Fx } = await import('../src/render/fx');
    const { ClientState } = await import('../src/game/state');
    const fx = new Fx();
    const state = new ClientState();
    const ent = (id: number, champ: string, team: number, x: number) => ({
      id, serial: 1, kind: 1, team, x, y: 1000, px: x, py: 1000, fx: 1, fy: 0, hp: 500, maxHp: 500, shield: 0, mana: 300, maxMana: 300,
      radius: 65, level: 18, champ, slot: id, atkPhase: 0, atkTarget: -1, moving: false, alive: true,
    });
    const snap = (tick: number, events: SimEvent[], left = 400) => ({
      tick, time: tick / 30, team: 0, me: null, objects: [], players: [], events,
      entities: [ent(1, 'brom', 0, 1000), ent(2, 'oleth', 1, 3000), ent(3, 'ilvane', 1, 5000), ent(4, 'wren', 0, 7000)],
      projectiles: [{ id: 9, kind: 1, team: 1, x: 2000, y: 1000, px: 1950, py: 1000, dx: 1, dy: 0, width: 60, left }, { id: 10, kind: 2, team: 0, x: 0, y: 0, px: 0, py: 0, dx: 0, dy: 1, width: 0 }],
    });
    const visible = (): number => fx.group.children.filter((c) => c.visible).length;
    // ms clock only drives the cast/death pulses; telegraphs run on snapshot ticks
    const frame = (s: ReturnType<typeof snap>, alpha: number): void => {
      const now = s.tick * (1000 / 30);
      for (const ev of state.ingest(s, now)) fx.onEvent(ev, state, now);
      state.alpha = alpha;
      fx.update(state, now, false);
    };
    const casts: SimEvent[] = [
      { e: 'cast', src: 1, slot: 2, x: 1500, y: 1100, rank: 5 }, // brom cone
      { e: 'cast', src: 1, slot: 0, x: 1500, y: 1100, rank: 5 }, // brom self + delay (replaces the cone: one wind-up per caster)
      { e: 'cast', src: 2, slot: 3, x: 3200, y: 1000, rank: 3 }, // oleth line zone
      { e: 'cast', src: 3, slot: 0, x: 6000, y: 1000, rank: 5 }, // ilvane line skillshot
      { e: 'cast', src: 3, slot: 3, x: 6000, y: 1000, rank: 3 }, // ilvane cone
      { e: 'cast', src: 4, slot: 2, x: 7300, y: 1000, rank: 5 }, // wren dash with radius
    ];
    frame(snap(100, casts), 0.5);
    expect(visible()).toBeGreaterThan(10);
    // in-flight strip: interpolated projectile (1975) to the end of its range (2000 + 400), real width 60
    const strip = fx.group.children.find((c) => c.visible && Math.abs(c.scale.x - 425) < 1e-6 && Math.abs(c.scale.z - 60) < 1e-6);
    expect(strip?.position.x).toBeCloseTo(2187.5, 6);
    expect(strip?.position.z).toBeCloseTo(-1000, 6);
    // Ilvane R cone (range 1100) drawn with its real range
    expect(fx.group.children.some((c) => c.visible && (c as { geometry?: { type: string } }).geometry?.type === 'RingGeometry' && c.scale.x === 1100)).toBe(true);
    frame(snap(106, [
      { e: 'zone', src: 1, team: 0, x: 1000, y: 1000, r: 400, start: 105, at: 120 },
      { e: 'zone', src: 2, team: 1, x: 3200, y: 1000, r: 400, start: 105, at: 126, line: { ax: 3200, ay: 600, bx: 3200, by: 1400, width: 100 } },
      { e: 'zone', src: 4, team: 0, x: 8000, y: 1000, r: 300, start: 105, at: 105, until: 200 },
    ]), 0.3);
    expect(visible()).toBeGreaterThan(0);
    frame(snap(150, [], 0), 1);
    frame(snap(400, [], 0), 1);
    expect(visible()).toBe(2); // instanced projectile meshes only
  });
});
