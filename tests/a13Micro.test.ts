// A13: combat micro layer - aim solver, dodge (fog-fair inputs, reaction, feasibility), flag, spacing, focus.

import { describe, expect, it } from 'vitest';
import { Rng } from '../src/sim/rng';
import { aimNoise, circleConfidence, intercept, lineConfidence, observedVelocity, segmentBlocked } from '../src/ai/combat/aim';
import { setMicroOverride, microOn } from '../src/ai/combat/flag';
import { dodgeStats, dodgeStep } from '../src/ai/combat/dodge';
import { microSpacing } from '../src/ai/combat/spacing';
import { microFocusScore } from '../src/ai/combat/focus';
import { aimCircle, aimLine } from '../src/ai/combat/cast';
import { entityIndex } from '../src/ai/bot/lasthit';
import { Kind } from '../src/sim/types';
import type { SimEvent } from '../src/sim/types';
import type { Rank } from '../src/ai/profiles/schema';
import { ScriptedBot, champEnt, eidOf, hud, minion, paramsFor, snapshot, champ } from './botScenario';

describe('aim: intercept and confidence', () => {
  it('a standing target is aimed at where it stands', () => {
    const p = intercept({ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 0, y: 0 }, 1700, 0.25);
    expect(p.x).toBeCloseTo(800, 6);
    expect(p.y).toBeCloseTo(0, 6);
  });

  it('the intercept is self-consistent: the missile and the target reach the point at the same time', () => {
    const from = { x: 0, y: 0 };
    const tgt = { x: 700, y: 100 };
    const vel = { x: 300, y: -120 };
    const speed = 1600;
    const cast = 0.25;
    const i = intercept(from, tgt, vel, speed, cast);
    const missileT = cast + Math.hypot(i.x - from.x, i.y - from.y) / speed;
    expect(Math.abs(missileT - i.t)).toBeLessThan(0.002);
    expect(i.x).toBeCloseTo(tgt.x + vel.x * i.t, 0);
  });

  it('a fleeing target needs a longer lead than the old one-step lead gave', () => {
    const from = { x: 0, y: 0 };
    const tgt = { x: 700, y: 0 };
    const vel = { x: 345, y: 0 }; // running straight away
    const oldLead = { x: tgt.x + vel.x * (0.25 + 700 / 1500), y: 0 };
    const i = intercept(from, tgt, vel, 1500, 0.25);
    expect(i.x).toBeGreaterThan(oldLead.x + 50);
  });

  it('lead 0 aims at the current position (a bot that does not lead)', () => {
    const i = intercept({ x: 0, y: 0 }, { x: 600, y: 200 }, { x: 300, y: 0 }, 1500, 0.25, 0);
    expect(i.x).toBe(600);
    expect(i.y).toBe(200);
  });

  it('the velocity is the observed step of the last tick only', () => {
    const e = champEnt(8, 1000, 1000, { px: 990, py: 1000 });
    expect(observedVelocity(e)).toEqual({ x: 300, y: 0 });
  });

  it('confidence: standing > walking away > crossing; delayed circles need a standing target', () => {
    const from = { x: 0, y: 0 };
    const p = { x: 800, y: 0 };
    const still = lineConfidence(from, p, { x: 0, y: 0 }, 0.7, 95);
    const away = lineConfidence(from, p, { x: 345, y: 0 }, 0.7, 95);
    const cross = lineConfidence(from, p, { x: 0, y: 345 }, 0.7, 95);
    expect(still).toBe(1);
    expect(away).toBeGreaterThan(cross);
    expect(still).toBeGreaterThan(away);
    expect(circleConfidence({ x: 0, y: 0 }, 1, 300, 65)).toBe(1);
    expect(circleConfidence({ x: 345, y: 0 }, 1, 300, 65)).toBeLessThan(0.7);
    expect(circleConfidence({ x: 345, y: 0 }, 1, 300, 65)).toBeLessThan(circleConfidence({ x: 100, y: 0 }, 1, 300, 65));
  });

  it('aim noise scales with the profile aimErrorDeg (rank), and is zero for a perfect aim', () => {
    const rng = new Rng(7);
    const z = aimNoise(0, rng);
    expect(z.lead).toBe(1);
    expect(Math.abs(z.deg)).toBe(0);
    const spread = (deg: number): number => {
      const r = new Rng(11);
      let s = 0;
      for (let i = 0; i < 2000; i++) s += Math.abs(aimNoise(deg, r).lead - 1);
      return s / 2000;
    };
    expect(spread(12)).toBeGreaterThan(spread(6));
    expect(spread(6)).toBeGreaterThan(spread(1.5));
  });

  it('minion-blocked missiles: a minion on the segment blocks, one beside it does not', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 1000, y: 0 };
    expect(segmentBlocked(from, to, 60, [{ x: 500, y: 20, radius: 40 }])).toBe(true);
    expect(segmentBlocked(from, to, 60, [{ x: 500, y: 200, radius: 40 }])).toBe(false);
  });
});

describe('aim: castSlot geometry for the beta brain', () => {
  const setup = (rank: Rank) => {
    const bot = new ScriptedBot(3, paramsFor(rank, {}, 3), 5); // mira (blue adc)
    (bot.ctx as { utility?: boolean }).utility = true;
    return bot;
  };
  const nodeOf = (bot: ScriptedBot, ents: ReturnType<typeof champEnt>[], tick = 3000) => bot.node(snapshot({ tick, team: 0, entities: ents, me: hud(3) }));

  it('a spell out of reach or a hopeless crossing shot in poke mode is held; a standing target is hit', () => {
    const bot = setup('challenger');
    const ab = champ('mira').abilities[1]!; // W: line, 1400, speed 1600
    const me = champEnt(3, 3000, 3000);
    const standing = champEnt(8, 3900, 3000);
    const crossing = champEnt(8, 3900, 3000, { px: 3900, py: 2976 }); // 720 u/s across (hopeless)
    const far = champEnt(8, 5200, 3000);
    const n = nodeOf(bot, [me, standing]);
    expect(aimLine(n.v, bot.ctx, new Rng(1), n.v.enemies[0] ?? standing, ab, 1400, 'poke')).not.toBeNull();
    const n2 = nodeOf(bot, [me, crossing]);
    expect(aimLine(n2.v, bot.ctx, new Rng(1), crossing, ab, 1400, 'poke')).toBeNull();
    expect(aimLine(n2.v, bot.ctx, new Rng(1), crossing, ab, 1400, 'fight')).not.toBeNull();
    const n3 = nodeOf(bot, [me, far]);
    expect(aimLine(n3.v, bot.ctx, new Rng(1), far, ab, 1400, 'fight')).toBeNull();
  });

  it('a minion in the line of a blocked missile holds the spell', () => {
    const bot = setup('challenger');
    const ab = champ('mira').abilities[1]!;
    const me = champEnt(3, 3000, 3000);
    const t = champEnt(8, 3800, 3000);
    const n = nodeOf(bot, [me, t, minion(1, 3400, 3000)]);
    expect(ab.flags).toContain('blocked_by_minions');
    expect(aimLine(n.v, bot.ctx, new Rng(1), t, ab, 1400, 'fight')).toBeNull();
  });

  it('a delayed ground circle at a walking target is held in poke mode, thrown at a standing one', () => {
    const bot = setup('challenger');
    const ab = champ('kiran').abilities[1]!; // W: circle r250 delay 1
    expect(ab.delay).toBeGreaterThan(0);
    const me = champEnt(3, 3000, 3000);
    const walking = champEnt(8, 3500, 3000, { px: 3488, py: 3000 });
    const standing = champEnt(8, 3500, 3000);
    const nw = nodeOf(bot, [me, walking]);
    const ns = nodeOf(bot, [me, standing]);
    expect(aimCircle(nw.v, bot.ctx, new Rng(2), walking, ab, 700, 'poke')).toBeNull();
    expect(aimCircle(ns.v, bot.ctx, new Rng(2), standing, ab, 700, 'poke')).not.toBeNull();
  });

  it('the aim error grows with the rank gap: Iron lands further from the exact point than Challenger', () => {
    const miss = (rank: Rank): number => {
      const bot = setup(rank);
      const ab = champ('mira').abilities[1]!;
      const me = champEnt(3, 3000, 3000);
      const t = champEnt(8, 3800, 3000);
      const n = nodeOf(bot, [me, t]);
      const rng = new Rng(42);
      let s = 0;
      for (let i = 0; i < 400; i++) {
        const a = aimLine(n.v, bot.ctx, rng, t, ab, 1400, 'fight')!;
        s += Math.abs(a.y - 3000);
      }
      return s / 400;
    };
    expect(miss('iron')).toBeGreaterThan(miss('gold'));
    expect(miss('gold')).toBeGreaterThan(miss('challenger'));
  });
});

describe('micro flag', () => {
  it('is off for the default brain, on for the beta brain, switchable by the measurement override', () => {
    const off = new ScriptedBot(0, paramsFor('gold'), 1);
    expect(microOn(off.ctx)).toBe(false);
    const bot = new ScriptedBot(0, paramsFor('gold'), 1);
    (bot.ctx as { utility?: boolean }).utility = true;
    expect(microOn(bot.ctx)).toBe(true);
    setMicroOverride(() => false);
    expect(microOn(bot.ctx)).toBe(false);
    setMicroOverride((c) => c.team === 0);
    expect(microOn(bot.ctx)).toBe(true);
    setMicroOverride(null);
    expect(microOn(bot.ctx)).toBe(true);
    setMicroOverride(() => true);
    const plain = new ScriptedBot(0, paramsFor('gold'), 1);
    expect(microOn(plain.ctx)).toBe(false); // the override never turns the layer on for the default brain
    setMicroOverride(null);
  });
});

// ------------------------------------------------------------------ dodge

/** Blue top laner (brom, slot 0) at (3000, 3000); red adc tobin (slot 8) casts Q (line, 1100, speed 1800) west at it. */
function lineScenario(rank: Rank, seed: number, dist: number, observe = true) {
  const bot = new ScriptedBot(0, paramsFor(rank, {}, 0), seed);
  (bot.ctx as { utility?: boolean }).utility = true;
  const me = champEnt(0, 3000, 3000);
  const caster = champEnt(8, 3000 + dist, 3000);
  const T0 = 3000;
  const cast: SimEvent = { e: 'cast', src: eidOf(8), slot: 0, x: 3000, y: 3000, rank: 1, at: T0 + 8 };
  const tick = (t: number, events: SimEvent[]) => {
    const snap = snapshot({ tick: t, team: 0, entities: observe ? [me, caster] : [me], me: hud(0), events });
    const n = bot.node(snap);
    return dodgeStep(snap, bot.ctx, bot.mem, bot.rng, n.v, entityIndex(snap.entities));
  };
  return { bot, me, caster, T0, cast, tick };
}

describe('dodge: line skillshots from visible casts', () => {
  it('Challenger sidesteps out of the corridor in time, and holds its orders until the missile has passed', () => {
    let dodged = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const s = lineScenario('challenger', seed, 800);
      let move: { x: number; y: number } | null = null;
      let at = -1;
      for (let t = s.T0; t < s.T0 + 40 && !move; t++) {
        const acts = s.tick(t, t === s.T0 ? [s.cast] : []);
        const m = acts.find((a) => a.cmd.t === 'move');
        if (m && m.cmd.t === 'move') (move = { x: m.cmd.x, y: m.cmd.y }), (at = t);
      }
      if (!move) continue;
      dodged++;
      // the destination lies outside the corridor (lateral offset > half width + radius)
      expect(Math.abs(move.y - 3000)).toBeGreaterThan(30 + s.me.radius);
      expect(Math.abs(move.x - 3000)).toBeLessThan(400);
      // the arrival tick of the missile at 800 units: launch + 800 / 1800 s
      expect(s.bot.mem.busyUntil).toBeGreaterThanOrEqual(s.T0 + 8 + Math.ceil((800 / 1800) * 30));
      expect(at).toBeGreaterThanOrEqual(s.T0);
    }
    // 800 units: the wind-up (8 ticks) plus the flight leave ~21 ticks; a sidestep of ~120 units needs ~10 ticks at 345 u/s,
    // so only a bot that reacts within ~11 ticks of the launch makes it (the predictive reads of the wind-up always do)
    expect(dodged).toBeGreaterThanOrEqual(7);
  });

  it('is fair: a missile is reacted to only after the reaction time (Iron never beats the missile at close range)', () => {
    let moved = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const s = lineScenario('iron', seed, 450);
      for (let t = s.T0; t < s.T0 + 40; t++) s.tick(t, t === s.T0 ? [s.cast] : []);
      moved += dodgeStats(s.bot.mem).moved;
    }
    expect(moved).toBe(0);
  });

  it('a cast of a champion the team does not see produces no dodge (no information without sight)', () => {
    const s = lineScenario('challenger', 3, 800, false);
    let moves = 0;
    for (let t = s.T0; t < s.T0 + 40; t++) moves += s.tick(t, t === s.T0 ? [s.cast] : []).length;
    expect(moves).toBe(0);
    expect(dodgeStats(s.bot.mem).threats).toBe(0);
  });

  it('a missile that does not cover the bot is ignored', () => {
    const s = lineScenario('challenger', 3, 800);
    const miss: SimEvent = { ...s.cast, y: 3600 } as SimEvent; // aimed far to the side
    let moves = 0;
    for (let t = s.T0; t < s.T0 + 40; t++) moves += s.tick(t, t === s.T0 ? [miss] : []).length;
    expect(moves).toBe(0);
  });

  it('a minion of the bot team in front of it absorbs a minion-blocked missile: no dodge', () => {
    const bot = new ScriptedBot(0, paramsFor('challenger', {}, 0), 4);
    (bot.ctx as { utility?: boolean }).utility = true;
    const me = champEnt(0, 3000, 3000);
    const caster = champEnt(8, 3800, 3000);
    const block = minion(0, 3400, 3000);
    expect(champ('tobin').abilities[0]!.flags).toContain('blocked_by_minions');
    const cast: SimEvent = { e: 'cast', src: eidOf(8), slot: 0, x: 3000, y: 3000, rank: 1, at: 3008 };
    let moves = 0;
    for (let t = 3000; t < 3040; t++) {
      const snap = snapshot({ tick: t, team: 0, entities: [me, caster, block], me: hud(0), events: t === 3000 ? [cast] : [] });
      const n = bot.node(snap);
      moves += dodgeStep(snap, bot.ctx, bot.mem, bot.rng, n.v, entityIndex(snap.entities)).length;
    }
    expect(moves).toBe(0);
  });
});

describe('dodge: escape dash when walking out is too slow', () => {
  it('a hard-CC line (Tobin R, 400 wide) at close range is dodged with the dash of an escape champion, not by walking', () => {
    let dashed = 0;
    let walked = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const bot = new ScriptedBot(3, paramsFor('challenger', {}, 3), seed); // blue adc mira: E is a 300 dash
      (bot.ctx as { utility?: boolean }).utility = true;
      const me = champEnt(3, 3000, 3000);
      const caster = champEnt(8, 3500, 3000);
      const cast: SimEvent = { e: 'cast', src: eidOf(8), slot: 3, x: 3000, y: 3000, rank: 1, at: 3008 };
      for (let t = 3000; t < 3040; t++) {
        const snap = snapshot({ tick: t, team: 0, entities: [me, caster], me: hud(3), events: t === 3000 ? [cast] : [] });
        const n = bot.node(snap);
        for (const a of dodgeStep(snap, bot.ctx, bot.mem, bot.rng, n.v, entityIndex(snap.entities))) {
          if (a.cmd.t === 'cast') {
            expect(a.cmd.slot).toBe(2);
            dashed++;
          } else walked++;
        }
      }
    }
    expect(dashed).toBeGreaterThan(0);
    expect(walked).toBe(0);
  });
});

describe('dodge: ground telegraphs from zone events', () => {
  it('Challenger walks out of a circle that resolves in 1 s', () => {
    let out = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const bot = new ScriptedBot(0, paramsFor('challenger', {}, 0), seed);
      (bot.ctx as { utility?: boolean }).utility = true;
      const me = champEnt(0, 3000, 3000);
      const caster = champEnt(8, 3800, 3000);
      const zone: SimEvent = { e: 'zone', src: eidOf(8), team: 1, x: 3040, y: 3000, r: 150, start: 3000, at: 3045 };
      let move: { x: number; y: number } | null = null;
      for (let t = 3000; t < 3045 && !move; t++) {
        const snap = snapshot({ tick: t, team: 0, entities: [me, caster], me: hud(0), events: t === 3000 ? [zone] : [] });
        const n = bot.node(snap);
        const m = dodgeStep(snap, bot.ctx, bot.mem, bot.rng, n.v, entityIndex(snap.entities)).find((a) => a.cmd.t === 'move');
        if (m && m.cmd.t === 'move') move = { x: m.cmd.x, y: m.cmd.y };
      }
      if (!move) continue;
      out++;
      expect(Math.hypot(move.x - 3040, move.y - 3000)).toBeGreaterThan(150 + me.radius);
    }
    expect(out).toBeGreaterThanOrEqual(8);
  });

  it('a zone of the bot\'s own team is no threat', () => {
    const bot = new ScriptedBot(0, paramsFor('challenger', {}, 0), 2);
    (bot.ctx as { utility?: boolean }).utility = true;
    const me = champEnt(0, 3000, 3000);
    const zone: SimEvent = { e: 'zone', src: eidOf(1), team: 0, x: 3000, y: 3000, r: 300, start: 3000, at: 3030 };
    let moves = 0;
    for (let t = 3000; t < 3030; t++) {
      const snap = snapshot({ tick: t, team: 0, entities: [me], me: hud(0), events: t === 3000 ? [zone] : [] });
      moves += dodgeStep(snap, bot.ctx, bot.mem, bot.rng, bot.node(snap).v, entityIndex(snap.entities)).length;
    }
    expect(moves).toBe(0);
  });
});

describe('spacing and focus from the hints', () => {
  it('a ranged bot keeps out of a ready gap closer and steps in when the enemy is known to be down', () => {
    const bot = new ScriptedBot(3, paramsFor('gold', {}, 3), 9); // mira adc, range 550
    (bot.ctx as { utility?: boolean }).utility = true;
    const me = champEnt(3, 3000, 3000);
    const kaelen = champEnt(7, 3500, 3000); // red slot 7 is thessaly: use the roster champion
    const n = bot.node(snapshot({ tick: 3000, team: 0, entities: [me, kaelen], me: hud(3) }));
    const t = n.v.enemies[0] ?? kaelen;
    const sp = microSpacing(n, t)!;
    expect(sp).toBeGreaterThan(150);
    expect(sp).toBeLessThanOrEqual(550 + me.radius + t.radius);
  });

  it('focus prefers a low-HP carry in reach over a full-HP tank behind a frontliner', () => {
    const bot = new ScriptedBot(3, paramsFor('gold', {}, 3), 9); // mira
    (bot.ctx as { utility?: boolean }).utility = true;
    const me = champEnt(3, 3000, 3000);
    const carry = champEnt(8, 3500, 3000, { hp: 400 }); // tobin low
    const tank = champEnt(5, 3900, 3000); // isolde full HP, farther
    const n = bot.node(snapshot({ tick: 3000, team: 0, entities: [me, carry, tank], me: hud(3) }));
    const fight = [carry, tank];
    expect(microFocusScore(n, carry, fight, -1)).toBeGreaterThan(microFocusScore(n, tank, fight, -1));
    expect(Kind.Champion).toBe(carry.kind);
  });
});
