import { describe, expect, it } from 'vitest';
import { findPath, lineWalkable, loadMap, walkable } from '../src/sim/map';
import { cosDeg, sinRad } from '../src/sim/vec';

const map = loadMap();

describe('map', () => {
  it('is point symmetric', () => {
    const [b, r] = map.sides;
    expect(r.nexus).toEqual({ x: 16000 - b.nexus.x, y: 16000 - b.nexus.y });
    // red top lane is the physical top lane (y high) and mirrors blue's bot lane
    expect(r.towers.top[0]!.y).toBeGreaterThan(14000);
    expect(b.towers.top[0]!.x).toBeLessThan(2000);
    expect(map.bushes.length).toBe(26);
  });

  it('nexus-to-nexus distance along mid is about 17000', () => {
    const [b, r] = map.sides;
    const d = Math.hypot(r.nexus.x - b.nexus.x, r.nexus.y - b.nexus.y);
    expect(d).toBeGreaterThan(16500);
    expect(d).toBeLessThan(18000);
  });

  it('lanes, structures and camps are walkable / reachable', () => {
    for (const side of map.sides) {
      for (const lane of Object.values(side.lanes)) {
        for (let i = 1; i < lane.length; i++) {
          expect(lineWalkable(map.nav, lane[i - 1]!.x, lane[i - 1]!.y, lane[i]!.x, lane[i]!.y)).toBe(true);
        }
      }
      for (const c of side.camps) expect(walkable(map.nav, c.x, c.y)).toBe(true);
      expect(side.camps).toHaveLength(6);
    }
  });

  it('every camp, plant and objective is reachable from both fountains (organic walls keep their corridors)', () => {
    const goals = [
      ...map.sides.flatMap((s) => [...s.camps, ...s.plants]),
      map.objectives.leviathan,
      map.objectives.kesselbrut,
      map.objectives.schleierwaechter,
      ...map.objectives.nebelschleicher,
    ];
    for (const side of map.sides) {
      for (const g of goals) {
        const path = findPath(map.nav, side.fountain.x, side.fountain.y, g.x, g.y);
        let x = side.fountain.x;
        let y = side.fountain.y;
        for (const p of path) {
          expect(lineWalkable(map.nav, x, y, p.x, p.y)).toBe(true);
          x = p.x;
          y = p.y;
        }
        expect(Math.hypot(x - g.x, y - g.y)).toBeLessThan(120);
      }
    }
  });

  it('finds a path around walls', () => {
    // blue fountain to blue buff camp
    const [b] = map.sides;
    const camp = b.camps.find((c) => c.id === 'dornenbock')!;
    const path = findPath(map.nav, b.fountain.x, b.fountain.y, camp.x, camp.y);
    expect(path.length).toBeGreaterThan(0);
    let x = b.fountain.x;
    let y = b.fountain.y;
    for (const p of path) {
      expect(lineWalkable(map.nav, x, y, p.x, p.y)).toBe(true);
      x = p.x;
      y = p.y;
    }
    expect(Math.hypot(x - camp.x, y - camp.y)).toBeLessThan(80);
  });

  it('deterministic trig matches Math within 1e-12', () => {
    for (let d = -720; d <= 720; d += 7.5) {
      expect(Math.abs(cosDeg(d) - Math.cos((d * Math.PI) / 180))).toBeLessThan(1e-12);
      expect(Math.abs(sinRad(d / 57.3) - Math.sin(d / 57.3))).toBeLessThan(1e-12);
    }
  });
});

describe('wall corners', () => {
  it('a unit walking from the blue base to Hohlkaefer never gets stuck (agent H repro)', async () => {
    const { createSim, step } = await import('../src/sim/sim');
    const sim = createSim({ seed: 3, mode: 'sandbox', minionsEnabled: false, players: [{ slot: 0, team: 0, champion: 'mira', role: 'jungle', summoners: ['sprung', 'heilen'], isHuman: true }] });
    const me = sim.slots[0]!;
    step(sim, [{ slot: 0, cmd: { t: 'cheat', op: 'teleport', x: 3846, y: 2742 } }]);
    step(sim, [{ slot: 0, cmd: { t: 'move', x: 8800, y: 2900 } }]);
    for (let i = 0; i < 30 * 25; i++) step(sim);
    expect(Math.hypot(sim.c.Pos.x[me]! - 8800, sim.c.Pos.y[me]! - 2900)).toBeLessThan(120);
  });

  it('lineWalkable rejects segments that clip a blocked cell corner', () => {
    // find a blocked cell with free diagonal neighbours and test the diagonal through its corner region
    const { w, walk } = map.nav;
    let found = false;
    for (let i = w + 1; i < walk.length - w - 1 && !found; i++) {
      if (walk[i] !== 0 || walk[i - w - 1] !== 1 || walk[i + w + 1] !== 1) continue;
      const cx = i % w;
      const cy = (i - cx) / w;
      // segment from lower-left free cell to upper-right free cell passes through the blocked cell
      expect(lineWalkable(map.nav, (cx - 0.5) * 50, (cy - 0.5) * 50, (cx + 1.5) * 50, (cy + 1.5) * 50)).toBe(false);
      found = true;
    }
    expect(found).toBe(true);
  });
});
