// Behaviour tree runtime: compiles a JSON tree against a leaf registry and ticks it once per bot decision.
//   selector   children in priority order; first non-failure wins (remembers + logs the running branch)
//   sequence   children in order; stops at the first non-success
//   parallel   ticks every child; result by policy (all / one / always)
//   condition  registry boolean -> success/failure
//   action     registry function -> success/failure/running
//   cooldown   after the child succeeded (or ran at all, on:'any') it is skipped (failure) for s seconds
//   reaction   once the child turns true, waits a sampled reaction time (rank profile, log-normal) before passing
//   gate       hysteresis on a utility score: on at score >= threshold; the running state gets the BotParams
//              hysteresis bonus (score x (1 + h)) and no switch happens within dwellS (default 2 s) of the last one
//   inverter   swaps success/failure
// Reaction time ownership: perceive() delays noticing enemy champions; 'reaction' delays acting on a new
// situation (trade window, objective call). Dodges sample their own reaction (they need projectile timing).

import { sampleReactionMs } from '../profiles';
import { reactionPenaltyMs } from '../humanize/attention';
import type { NodeCtx, NodeDef, NodeResult, NodeState, Registry } from './types';

export interface BtNode {
  id: string;
  tick(n: NodeCtx): NodeResult;
}

const stateOf = (n: NodeCtx, id: string): NodeState => {
  let s = n.mem.bt.get(id);
  if (!s) n.mem.bt.set(id, (s = {}));
  return s;
};

const knobOr = (n: NodeCtx, v: number | string | undefined, dflt: number): number =>
  typeof v === 'number' ? v : typeof v === 'string' ? (n.p.knobs as Record<string, number>)[v] ?? dflt : dflt;

/** Compile a JSON tree. Throws on unknown node types, leaf names or duplicate ids. */
export function compile(def: NodeDef, reg: Registry, ids = new Set<string>(), path = 'root'): BtNode {
  const id = def.id ?? def.name ?? path;
  if (def.id) {
    if (ids.has(def.id)) throw new Error(`bt: duplicate node id '${def.id}'`);
    ids.add(def.id);
  }
  const kids = (): BtNode[] => (def.children ?? []).map((c, i) => compile(c, reg, ids, `${id}.${i}`));
  const only = (): BtNode => {
    if (!def.child) throw new Error(`bt: ${def.type} '${id}' needs a child`);
    return compile(def.child, reg, ids, `${id}.c`);
  };
  switch (def.type) {
    case 'selector': {
      const cs = kids();
      return {
        id,
        tick(n) {
          for (const c of cs) {
            const r = c.tick(n);
            if (r === 'failure') continue;
            const st = stateOf(n, id);
            if (st.running !== c.id) {
              if (def.id) n.log(id, c.id, `switch from ${st.running ?? 'none'}`);
              st.running = c.id;
            }
            return r;
          }
          stateOf(n, id).running = undefined;
          return 'failure';
        },
      };
    }
    case 'sequence': {
      const cs = kids();
      return {
        id,
        tick(n) {
          for (const c of cs) {
            const r = c.tick(n);
            if (r !== 'success') return r;
          }
          return 'success';
        },
      };
    }
    case 'parallel': {
      const cs = kids();
      const policy = def.policy ?? 'all';
      return {
        id,
        tick(n) {
          let ok = 0;
          let running = false;
          for (const c of cs) {
            const r = c.tick(n);
            if (r === 'success') ok++;
            else if (r === 'running') running = true;
          }
          if (policy === 'always') return 'success';
          if (policy === 'one') return ok > 0 ? 'success' : running ? 'running' : 'failure';
          return ok === cs.length ? 'success' : running ? 'running' : 'failure';
        },
      };
    }
    case 'condition': {
      const f = reg.conditions[def.name ?? ''];
      if (!f) throw new Error(`bt: unknown condition '${def.name}'`);
      return { id, tick: (n) => (f(n) ? 'success' : 'failure') };
    }
    case 'action': {
      const f = reg.actions[def.name ?? ''];
      if (!f) throw new Error(`bt: unknown action '${def.name}'`);
      return { id, tick: f };
    }
    case 'inverter': {
      const c = only();
      return {
        id,
        tick(n) {
          const r = c.tick(n);
          return r === 'success' ? 'failure' : r === 'failure' ? 'success' : r;
        },
      };
    }
    case 'cooldown': {
      if (!def.id) throw new Error('bt: cooldown needs an id');
      const c = only();
      const on = def.on ?? 'success';
      return {
        id,
        tick(n) {
          const st = stateOf(n, id);
          if (n.v.tick < (st.until ?? -1)) return 'failure';
          const r = c.tick(n);
          if (r === 'success' || on === 'any') {
            const mult = def.scale ? knobOr(n, def.scale, 1) : 1;
            st.until = n.v.tick + Math.round((def.s ?? 1) * mult * 30);
          }
          return r;
        },
      };
    }
    case 'reaction': {
      if (!def.id) throw new Error('bt: reaction needs an id');
      const c = only();
      return {
        id,
        tick(n) {
          const st = stateOf(n, id);
          const r = c.tick(n);
          if (r === 'failure') {
            st.readyAt = undefined;
            return r;
          }
          if (st.readyAt === undefined) st.readyAt = n.v.tick + Math.round(((sampleReactionMs(n.ctx.profile.behavior, n.rng) + reactionPenaltyMs(n.mem, n.v.tick)) * 30) / 1000);
          return n.v.tick >= st.readyAt ? r : 'failure';
        },
      };
    }
    case 'gate': {
      if (!def.id) throw new Error('bt: gate needs an id');
      const f = reg.scores[def.name ?? ''];
      if (!f) throw new Error(`bt: unknown score '${def.name}'`);
      const dwell = Math.round((def.dwellS ?? 2) * 30);
      return {
        id,
        tick(n) {
          const st = stateOf(n, id);
          const thr = knobOr(n, def.threshold, 0.5);
          const raw = f(n);
          const on = !!st.on;
          const eff = on ? raw * (1 + n.p.hysteresis) : raw;
          const want = eff >= thr;
          if (want !== on && n.v.tick - (st.since ?? -1e9) >= dwell) {
            st.on = want;
            st.since = n.v.tick;
            n.log(id, want ? 'on' : 'off', want ? 'score above threshold' : 'score below threshold (with running bonus)', {}, { score: raw, threshold: thr, hysteresis: n.p.hysteresis });
          }
          return st.on ? 'success' : 'failure';
        },
      };
    }
    default:
      throw new Error(`bt: unknown node type '${(def as NodeDef).type}'`);
  }
}
