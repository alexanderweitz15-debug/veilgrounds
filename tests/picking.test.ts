// C8 picking (src/input/picking.ts, used by render/world.ts pick()): real camera at the default zoom, 1280x720.
import { describe, expect, it } from 'vitest';
import { bodyDistance, pickBody, pickUnit, PICK_MARGIN_PX } from '../src/input/picking';
import { Kind } from '../src/sim/types';
import type { SnapEntity } from '../src/sim/snapshot';
import { legacyPick, makeView, rigAt, stateOf, unit } from './pickingHelpers';

const any = (): boolean => true;
const champsOnly = (e: SnapEntity): boolean => e.kind === Kind.Champion;
const rig = rigAt(8000, 8000);
const view = makeView(rig);

/** Screen point at fraction `f` of a unit's sprite height above its feet (0 = feet, 1 = sprite top). */
function onBody(e: SnapEntity, f: number, dx = 0): { sx: number; sy: number } {
  const foot = view.project(e.x, e.y, 0);
  const head = view.barAnchor(e, e.x, e.y)!;
  return { sx: foot.sx + dx, sy: foot.sy - (foot.sy - head.sy) * f };
}

describe('C8 picking: body area', () => {
  it('a minion is clickable at least ~24-30 px around its body at the default zoom', () => {
    const m = unit(Kind.MinionMelee, 1, 8000, 8000);
    const b = pickBody(stateOf([m]), view, m)!;
    expect(b.core).toBeGreaterThan(18); // 48 sim radius projected
    expect(b.reach).toBeGreaterThanOrEqual(24);
    expect(b.reach).toBeLessThanOrEqual(32);
    expect(b.reach - b.core).toBe(PICK_MARGIN_PX);
  });

  it('edge of the margin: just inside picks, just outside misses (sideways and below the feet)', () => {
    const m = unit(Kind.MinionCaster, 1, 8000, 8000);
    const st = stateOf([m]);
    const b = pickBody(st, view, m)!;
    const mid = onBody(m, 0.4);
    expect(pickUnit(st, view, mid.sx + b.reach - 1, mid.sy, any)).toBe(m);
    expect(pickUnit(st, view, mid.sx - b.reach + 1, mid.sy, any)).toBe(m);
    expect(pickUnit(st, view, mid.sx + b.reach + 1, mid.sy, any)).toBeNull();
    // below the feet the ground ellipse is squashed (pitched camera)
    const below = (b.reach - 1) / b.squash;
    expect(pickUnit(st, view, b.foot.sx, b.foot.sy + below, any)).toBe(m);
    expect(pickUnit(st, view, b.foot.sx, b.foot.sy + (b.reach + 1) / b.squash, any)).toBeNull();
    // the empty sprite corners of the old rect no longer count, the head does
    expect(pickUnit(st, view, mid.sx, onBody(m, 0.95).sy, any)).toBe(m);
  });

  it('distance is measured to the body axis, not to the sprite rect centre', () => {
    const m = unit(Kind.MinionMelee, 1, 8000, 8000);
    const b = pickBody(stateOf([m]), view, m)!;
    const p = onBody(m, 0.3);
    expect(bodyDistance(b, p.sx, p.sy)).toBeLessThan(0.01);
    expect(bodyDistance(b, p.sx + 10, p.sy)).toBeCloseTo(10, 5);
  });
});

describe('C8 picking: crowded wave with a champion behind it', () => {
  // three enemy melee minions in front, two casters behind them, the enemy champion right behind the middle melee
  const front = [unit(Kind.MinionMelee, 1, 7900, 8000), unit(Kind.MinionMelee, 1, 8000, 8000), unit(Kind.MinionMelee, 1, 8100, 8000)];
  const back = [unit(Kind.MinionCaster, 1, 7950, 8120), unit(Kind.MinionCaster, 1, 8050, 8120)];
  const champ = unit(Kind.Champion, 1, 8000, 8170);
  const ally = unit(Kind.MinionMelee, 0, 8040, 7920);
  const me = unit(Kind.Champion, 0, 8000, 7700);
  const st = stateOf([champ, ...back, ...front, ally, me]);

  it('the upper body of the front minion picks the minion, not the champion (legacy: the champion stole it)', () => {
    const m = front[1]!;
    let stolen = 0;
    for (let f = 0.5; f <= 1; f += 0.05) {
      const p = onBody(m, f);
      if (legacyPick(st, view, p.sx, p.sy, any) === champ) stolen++;
      expect(pickUnit(st, view, p.sx, p.sy, any)).toBe(m);
    }
    expect(stolen).toBeGreaterThan(0);
  });

  it('every point on each front minion axis picks that minion', () => {
    for (const m of front) for (let f = 0; f <= 1; f += 0.1) {
      const p = onBody(m, f);
      expect(pickUnit(st, view, p.sx, p.sy, any)).toBe(m);
    }
  });

  it('the champion is still picked on its own body above the wave', () => {
    const p = onBody(champ, 0.75);
    expect(pickUnit(st, view, p.sx, p.sy, any)).toBe(champ);
  });

  it('"target champions only" ignores the minions: champion near its body, nothing far away', () => {
    const near = onBody(champ, 0.1, 12);
    expect(pickUnit(st, view, near.sx, near.sy, champsOnly)).toBe(champ);
    const far = onBody(front[0]!, 0.6, -10);
    expect(pickUnit(st, view, far.sx, far.sy, champsOnly)).toBeNull();
  });

  it('an ally minion inside the enemy wave does not swallow the click (hostile first)', () => {
    const p = onBody(ally, 0.5);
    const hit = pickUnit(st, view, p.sx, p.sy, any)!;
    expect(hit.team).toBe(1);
    // alone, the ally is clickable (left-click select)
    expect(pickUnit(stateOf([ally]), view, p.sx, p.sy, any)).toBe(ally);
  });

  it('where two bodies overlap, the unit standing in front wins', () => {
    // caster behind the front-left melee: a point inside both cores
    const m = front[0]!;
    const c = back[0]!;
    const bm = pickBody(st, view, m)!;
    const bc = pickBody(st, view, c)!;
    const sx = (bm.foot.sx + bc.foot.sx) / 2;
    const sy = bc.foot.sy + 4;
    expect(bodyDistance(bm, sx, sy)).toBeLessThanOrEqual(bm.core);
    expect(bodyDistance(bc, sx, sy)).toBeLessThanOrEqual(bc.core);
    expect(pickUnit(st, view, sx, sy, any)).toBe(m);
  });
});

describe('C8 picking: HP bars', () => {
  it('clicking a minion bar targets that minion, even over another body', () => {
    const m = unit(Kind.MinionCaster, 1, 8000, 8000);
    const b = pickBody(stateOf([m]), view, m)!;
    const bar = b.bar!;
    const st = stateOf([m]);
    expect(pickUnit(st, view, bar.x0 + 1, (bar.y0 + bar.y1) / 2, any)).toBe(m);
    expect(pickUnit(st, view, bar.x1 - 1, bar.y0 + 1, any)).toBe(m);
    // a minion standing right behind: its body lies under the bar of the front one
    const behind = unit(Kind.MinionMelee, 1, 8000, 8190);
    const bb = pickBody(stateOf([behind]), view, behind)!;
    const p = { sx: bar.x0 + 4, sy: (bar.y0 + bar.y1) / 2 };
    expect(bodyDistance(bb, p.sx, p.sy)).toBeLessThanOrEqual(bb.reach);
    expect(pickUnit(stateOf([behind, m]), view, p.sx, p.sy, any)).toBe(m);
  });

  it('the champion bar includes its level box', () => {
    const c = unit(Kind.Champion, 1, 8000, 8000);
    const b = pickBody(stateOf([c]), view, c)!;
    expect(pickUnit(stateOf([c]), view, b.bar!.x0 + 3, b.bar!.y0 + 3, any)).toBe(c);
    expect(pickUnit(stateOf([c]), view, b.bar!.x0 - 3, b.bar!.y0 + 3, any)).toBeNull();
  });

  it('dead units and units without a bar (plants) are handled', () => {
    const dead = unit(Kind.MinionMelee, 1, 8000, 8000, { alive: false });
    const p = onBody(dead, 0.5);
    expect(pickUnit(stateOf([dead]), view, p.sx, p.sy, any)).toBeNull();
    const plant = unit(Kind.Plant, 2, 8000, 8000, { radius: 40, maxHp: 1, hp: 1 });
    const bp = pickBody(stateOf([plant]), view, plant)!;
    expect(bp.bar).toBeNull();
    expect(pickUnit(stateOf([plant]), view, bp.foot.sx, bp.foot.sy - 5, any)).toBe(plant);
  });
});
