// Behaviour tree runtime (src/ai/bt): standard nodes, decorators, the JSON tree compiles against the leaf
// registry, and spec-bots test 8 (hysteresis: a score pendulum around a threshold switches the mode at most once
// per 2 s).
import { describe, expect, it } from 'vitest';
import { compile } from '../src/ai/bt/runtime';
import { registry } from '../src/ai/bt/leaves';
import type { NodeCtx, NodeDef, NodeResult, Registry } from '../src/ai/bt/types';
import treeData from '../src/data/bots/tree.json';
import { profileOf } from '../src/ai/profiles';
import { Rng } from '../src/sim/rng';
import { RANKS } from '../src/ai/profiles/schema';

/** Minimal NodeCtx for runtime tests: tick, per-bot node state, hysteresis, reaction profile, rng, log sink. */
function fakeCtx(rank: (typeof RANKS)[number] = 'gold', seed = 1): NodeCtx & { logs: string[]; setTick(t: number): void } {
  const profile = profileOf(rank);
  const logs: string[] = [];
  const v = { tick: 0 };
  const n = {
    v,
    snap: { tick: 0 },
    ctx: { profile },
    mem: { bt: new Map() },
    rng: new Rng(seed),
    p: { hysteresis: profile.behavior.hysteresis, knobs: { tradeWinThreshold: 0.5, macroIntervalMult: 2 } },
    out: [],
    log: (node: string, chosen: string) => (logs.push(`${node}:${chosen}`), 0),
    logs,
    setTick(t: number) {
      v.tick = t;
    },
  };
  return n as unknown as NodeCtx & { logs: string[]; setTick(t: number): void };
}

const reg = (over: Partial<Registry> = {}): Registry => ({ actions: {}, conditions: {}, scores: {}, ...over });

describe('bt runtime nodes', () => {
  it('selector picks the first non-failure child; sequence stops at the first non-success; parallel policies', () => {
    const calls: string[] = [];
    const act = (name: string, r: NodeResult) => () => (calls.push(name), r);
    const r = reg({ actions: { a: act('a', 'failure'), b: act('b', 'running'), c: act('c', 'success'), d: act('d', 'success') } });
    const sel = compile({ type: 'selector', id: 'sel', children: [{ type: 'action', name: 'a' }, { type: 'action', name: 'b' }, { type: 'action', name: 'c' }] }, r);
    const n = fakeCtx();
    expect(sel.tick(n)).toBe('running');
    expect(calls).toEqual(['a', 'b']);
    expect(n.logs).toContain('sel:b'); // running branch switch is logged
    calls.length = 0;
    const seq = compile({ type: 'sequence', children: [{ type: 'action', name: 'c' }, { type: 'action', name: 'a' }, { type: 'action', name: 'd' }] }, r);
    expect(seq.tick(n)).toBe('failure');
    expect(calls).toEqual(['c', 'a']);
    const par = (policy: 'all' | 'one' | 'always'): NodeResult => compile({ type: 'parallel', policy, children: [{ type: 'action', name: 'a' }, { type: 'action', name: 'c' }] }, r).tick(n);
    expect([par('all'), par('one'), par('always')]).toEqual(['failure', 'success', 'success']);
    expect(compile({ type: 'inverter', child: { type: 'action', name: 'a' } }, r).tick(n)).toBe('success');
  });

  it('cooldown decorator skips its child for s x knob seconds after a success', () => {
    let runs = 0;
    const r = reg({ actions: { x: () => (runs++, 'success') } });
    const cd = compile({ type: 'cooldown', id: 'cd', s: 5, scale: 'macroIntervalMult', child: { type: 'action', name: 'x' } }, r);
    const n = fakeCtx();
    for (let t = 0; t < 30 * 30; t += 10) {
      n.setTick(t);
      cd.tick(n);
    }
    expect(runs).toBe(3); // every 10 s (5 s x knob 2) over 30 s
  });

  it('reaction decorator delays a newly true condition by a sampled reaction time (rank profile)', () => {
    const delays: Record<string, number> = {};
    for (const rank of ['iron', 'challenger'] as const) {
      let sum = 0;
      for (let s = 0; s < 40; s++) {
        const r = reg({ conditions: { on: () => true } });
        const node = compile({ type: 'reaction', id: 'react', child: { type: 'condition', name: 'on' } }, r);
        const n = fakeCtx(rank, s + 1);
        let t = 0;
        for (; t < 300; t++) {
          n.setTick(t);
          if (node.tick(n) === 'success') break;
        }
        sum += t;
      }
      delays[rank] = ((sum / 40) * 1000) / 30;
    }
    expect(delays.challenger!).toBeLessThan(delays.iron!);
    expect(delays.iron!).toBeGreaterThan(profileOf('iron').behavior.reactionMedianMs * 0.6);
  });

  it('unknown leaves and node types fail at load time', () => {
    expect(() => compile({ type: 'action', name: 'nope' }, reg())).toThrow(/unknown action/);
    expect(() => compile({ type: 'bogus' } as unknown as NodeDef, reg())).toThrow(/unknown node type/);
  });

  it('src/data/bots/tree.json compiles against the leaf registry (root priority order)', () => {
    const root = treeData.root as NodeDef;
    expect(() => compile(root, registry())).not.toThrow();
    const main = root.children!.find((c) => c.id === 'main')!;
    const order = main.children!.map((c) => c.id ?? c.name ?? c.children?.map((x) => x.name ?? x.id).join('+'));
    // survive > dodge > fight > objective > recall > role (laning/jungle/roam) > vision > idle
    const idx = (s: string): number => order.findIndex((o) => (o ?? '').split('+').includes(s));
    expect(idx('survive')).toBeLessThan(idx('dodge'));
    expect(idx('dodge')).toBeLessThan(idx('combat'));
    expect(idx('combat')).toBeLessThan(idx('objective'));
    expect(idx('objective')).toBeLessThan(idx('recall'));
    expect(idx('objective')).toBeLessThan(idx('role'));
    expect(idx('role')).toBeLessThan(idx('vision'));
    expect(idx('vision')).toBeLessThan(idx('idle'));
  });
});

describe('spec test 8: hysteresis', () => {
  /** Gate over a score that pendulums around the threshold; returns the ticks of every mode switch. */
  function pendulum(rank: (typeof RANKS)[number], amp: number, periodTicks: number, decision: number): number[] {
    let score = 0;
    const r = reg({ scores: { s: () => score } });
    const gate = compile({ type: 'gate', id: 'g', name: 's', threshold: 0.5, dwellS: 2 }, r);
    const n = fakeCtx(rank);
    const switches: number[] = [];
    let prev: NodeResult = 'failure';
    for (let t = 0; t < 120 * 30; t += decision) {
      n.setTick(t);
      score = 0.5 + amp * Math.sin((2 * Math.PI * t) / periodTicks);
      const res = gate.tick(n);
      if (res !== prev) switches.push(t);
      prev = res;
    }
    return switches;
  }

  it('mode switches at most once per 2 s for every rank, small and large pendulums', () => {
    for (const rank of RANKS) {
      const decision = Math.max(1, Math.round(30 / profileOf(rank).behavior.microHz));
      for (const [amp, period] of [[0.03, 9], [0.03, 40], [0.2, 20], [0.4, 7]] as const) {
        const sw = pendulum(rank, amp, period, decision);
        expect(sw.length, `${rank} amp ${amp}`).toBeGreaterThan(0);
        for (let i = 1; i < sw.length; i++) expect(sw[i]! - sw[i - 1]!, `${rank} amp ${amp} period ${period}`).toBeGreaterThanOrEqual(60);
      }
    }
  });

  it('a pendulum inside the running bonus does not switch back at all', () => {
    // amplitude 0.02 around 0.5: once on, score x (1 + h) stays above 0.5 for h >= 0.10
    const sw = pendulum('gold', 0.02, 13, 9);
    expect(sw.length).toBe(1);
  });
});
