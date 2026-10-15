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
    expect(map.bushes.length).toBe(14);
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
