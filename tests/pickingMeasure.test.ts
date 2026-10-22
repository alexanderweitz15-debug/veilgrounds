// C8 before/after measurement: clicks at random points inside the visible minion bodies of a recorded mid-lane wave
// clash (tests/fixtures/pickWave.json, tools/recordPickWave.ts), legacy picker vs src/input/picking.ts.
// What the player sees and means at a point: an HP bar drawn there (bars are drawn over the sprites, last drawn on
// top), else the front-most "visible body" (an ellipse over the sprite: centre half way up, half-width 0.22 x sprite
// height; where bodies overlap the unit standing in front, feet lower on screen, covers the others).
import { describe, expect, it } from 'vitest';
import { pickUnit, type PickState, type PickView } from '../src/input/picking';
import { barLayout, type Rect } from '../src/ui/hpBarGeom';
import { Kind, isMinion } from '../src/sim/types';
import type { SnapEntity } from '../src/sim/snapshot';
import { legacyPick, makeView, rigAt, stateOf, unit } from './pickingHelpers';
import wave from './fixtures/pickWave.json';

type Picker = (st: PickState, v: PickView, sx: number, sy: number, accept: (e: SnapEntity) => boolean) => SnapEntity | null;
const any = (): boolean => true;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

interface Body { e: SnapEntity; cx: number; cy: number; hw: number; hh: number; foot: number; bar: Rect | null }

function bodies(ents: SnapEntity[], view: PickView): Body[] {
  return ents.map((e) => {
    const foot = view.project(e.x, e.y, 0);
    const head = view.barAnchor(e, e.x, e.y)!;
    const h = foot.sy - head.sy;
    const l = barLayout(e, head.sx, head.sy);
    // the drawn dark frame of the bar (overlay.ts), without the picker's padding
    const bar = l ? { x0: l.x - (l.champ ? 24 : 2), y0: l.y - (l.champ ? 4 : 2), x1: l.x + l.bw + 2, y1: l.y + l.bh + 2 + (l.champ ? 5 : 0) } : null;
    return { e, cx: foot.sx, cy: foot.sy - h / 2, hw: 0.22 * h, hh: h / 2, foot: foot.sy, bar };
  });
}

const inside = (b: Body, x: number, y: number): boolean => ((x - b.cx) / b.hw) ** 2 + ((y - b.cy) / b.hh) ** 2 <= 1;
const onBar = (b: Body, x: number, y: number): boolean => !!b.bar && x >= b.bar.x0 && x <= b.bar.x1 && y >= b.bar.y0 && y <= b.bar.y1;

/** The unit the player sees at (x, y): top-most bar, else the front-most body. */
function visibleAt(bs: Body[], x: number, y: number): Body | null {
  let bar: Body | null = null;
  for (const o of bs) if (onBar(o, x, y)) bar = o; // later bars are drawn on top
  if (bar) return bar;
  let front: Body | null = null;
  for (const o of bs) if (inside(o, x, y) && (!front || o.foot > front.foot)) front = o;
  return front;
}

interface Score { n: number; hit: number; miss: number; champ: number }

function measure(picker: Picker, withChamps: boolean, onlyEnemy: boolean): Score {
  const r = rng(42);
  const s: Score = { n: 0, hit: 0, miss: 0, champ: 0 };
  const seen = new Set<string>();
  for (const fr of wave) {
    const key = JSON.stringify(fr.units);
    if (seen.has(key)) continue; // the clash freezes once the minions stand (no combat systems in the recorder)
    seen.add(key);
    const ents = fr.units.map((u) => unit(u.kind, u.team, u.x, u.y, { radius: u.radius }));
    const cx = ents.reduce((a, e) => a + e.x, 0) / ents.length;
    const cy = ents.reduce((a, e) => a + e.y, 0) / ents.length;
    if (withChamps) {
      // own champion (blue, team 0) last-hitting just south-west of the clash, enemy champion behind its wave
      ents.push(unit(Kind.Champion, 0, cx - 260, cy - 260), unit(Kind.Champion, 1, cx + 230, cy + 260));
    }
    const view = makeView(rigAt(cx, cy));
    const st = stateOf(ents, 0);
    const bs = bodies(ents, view);
    for (const b of bs) {
      if (!isMinion(b.e.kind) || (onlyEnemy && b.e.team === 0)) continue;
      for (let i = 0; i < 300; i++) {
        const a = r() * Math.PI * 2;
        const d = Math.sqrt(r());
        const x = b.cx + Math.cos(a) * d * b.hw;
        const y = b.cy + Math.sin(a) * d * b.hh;
        if (visibleAt(bs, x, y) !== b) continue;
        s.n++;
        const got = picker(st, view, x, y, any);
        if (got === b.e) s.hit++;
        else if (!got) s.miss++;
        else if (got.kind === Kind.Champion) s.champ++;
      }
    }
  }
  return s;
}

const pct = (k: number, n: number): string => `${((100 * k) / n).toFixed(1)} %`;
const line = (name: string, s: Score): string =>
  `${name}: ${pct(s.hit, s.n)} hit (${s.hit}/${s.n}), ${pct(s.miss, s.n)} nothing, ${pct(s.champ, s.n)} champion`;

describe('C8 picking measurement (recorded wave)', () => {
  it('clicks inside visible enemy minion bodies hit that minion far more often than before', () => {
    const rows: string[] = [];
    const res: Record<string, Score> = {};
    for (const [label, champs, enemy] of [
      ['enemy minions, champions near', true, true],
      ['enemy minions, wave only', false, true],
      ['all minions, champions near', true, false],
    ] as const) {
      res[`${label} legacy`] = measure(legacyPick, champs, enemy);
      res[`${label} new`] = measure(pickUnit, champs, enemy);
      rows.push(line(`${label}, before`, res[`${label} legacy`]!), line(`${label}, after `, res[`${label} new`]!));
    }
    console.log(rows.join('\n'));
    const before = res['enemy minions, champions near legacy']!;
    const after = res['enemy minions, champions near new']!;
    expect(after.n).toBeGreaterThan(500);
    expect(after.hit / after.n).toBeGreaterThan(0.95);
    expect(after.hit / after.n).toBeGreaterThan(before.hit / before.n);
    expect(after.champ).toBe(0);
  });
});
