// Per-unit sprite state machine (A3). Pure: no three, no canvas, no DOM, so it is unit-tested headless.
//
// The sim decides WHEN things happen (wind-up, damage tick, cast end); this machine only decides how the baked frames
// show it. Render animation never decides a damage moment. Inputs per frame: the snapshot facts of the unit (attack
// phase and ticks, moving, CC mask, recall) and the discrete cast/hit notifications. Outputs: which atlas clip and
// frame to draw, the logical state, a flinch offset, and animation events (hitFrame, release, footstep ...).
//
// Transition rules (no pops):
//  - wind-up frames are spread over the sim's EXACT wind-up (atkEnd - atkStart ticks), held on the last anticipation
//    frame until the sim's damage tick; the strike frame is shown on the first update after atkPhase 1 -> 2;
//  - the backswing is compressed when attack speed leaves less time than its natural length;
//  - a cast cancelled by a hard CC / silence before its release drops back to idle/walk instead of playing the release;
//  - an instant self buff cast while walking does not stop the stride;
//  - run -> idle waits one missed tick (STOP_GRACE_MS) so a single dropped `moving` flag does not flicker;
//  - the run cycle keeps its phase across attacks/casts and its speed follows the real movement speed.
import { AFTER_MS, afterFrame, backswingScale, runSpeedScale } from '../spriteTiming';
import type { Anim, Dir } from '../champions/types';
import type { AnimEventName, CastKind, ClipSet, LogicalState } from './types';

export const TICK_MS = 1000 / 30;
/** CC bits (sim buffs.CC_BIT) that interrupt a cast wind-up: stun 1, silence 8, airborne 16, suppress 64, stasis 128, fear 256. */
export const CC_INTERRUPT = 1 | 8 | 16 | 64 | 128 | 256;
/** run -> idle only after this long without `moving` (one dropped tick is 33 ms) */
export const STOP_GRACE_MS = 50;
/** hit flinch: knock-back distance (world units), duration and minimum gap between two flinches */
export const FLINCH = 9;
export const FLINCH_MS = 150;
export const FLINCH_GAP_MS = 320;
/** a flinch during a wind-up / cast is shown smaller so it does not read as an interrupt that did not happen */
export const FLINCH_BUSY = 0.35;
/** gather time of the recall pose before the flex is held */
/** the backswing may overrun its natural length by this much before it ends (matches the old fixed +60 ms) */
const RELEASE_SLACK_MS = 60;
export const RECALL_GATHER_MS = 220;
/** cast pose lengths after the release (ms): self flex, dash lunge */
export const CAST_AFTER_MS = { self: 300, dash: 280, directed: AFTER_MS * 3.6 } as const;

/** Snapshot facts of one unit for one frame (reused object, filled by the caller). */
export interface AnimInput {
  /** 0 idle, 1 wind-up, 2 backswing */
  atkPhase: number;
  /** sim ticks (snapshot atkStart / atkEnd), undefined when the snapshot has none */
  atkStart?: number;
  atkEnd?: number;
  moving: boolean;
  /** CC bit mask of the snapshot (0 = none) */
  cc: number;
  /** channelling a recall (own champion only until the snapshot carries it for everyone) */
  recalling: boolean;
  /** real movement speed in world units / s, 0 = unknown */
  speed: number;
  /** interpolated feet position */
  x: number;
  y: number;
  dir: Dir;
  /** fallback wind-up (ms) until one was measured / is given by the snapshot */
  windGuess: number;
}

export const newInput = (): AnimInput => ({ atkPhase: 0, moving: false, cc: 0, recalling: false, speed: 0, x: 0, y: 0, dir: 'S', windGuess: 330 });

/** Receives the animation events of a unit; the implementation decides who hears them. */
export type AnimSink = (name: AnimEventName, u: UnitAnim, slot: number, kind: CastKind, foot: number) => void;

interface CastState {
  t0: number;
  /** wind-up until the release (ms) */
  dur: number;
  kind: CastKind;
  slot: number;
  released: boolean;
  /** instant self buff while walking: events only, the body keeps striding */
  quiet: boolean;
}

export class UnitAnim {
  // ---- outputs of the last update
  anim: Anim = 'idle';
  frame = 0;
  state: LogicalState = 'idle';
  /** flinch offset (world units) */
  ox = 0;
  oy = 0;
  // ---- position facts of the last update (for events)
  x = 0;
  y = 0;
  dir: Dir = 'S';

  private t0 = 0;
  private lastNow = 0;
  private phase = 0;
  private atk0 = 0;
  private atkHit = 0;
  private wind = 0;
  private exactWind = 0;
  private back = 1;
  private hitT = -1e9;
  private hx = 0;
  private hy = 0;
  private cast: CastState | null = null;
  private runMs = 0;
  private runRaw = 0;
  private lastMove = -1e9;
  private moving = false;
  private recalling = false;
  private recallT0 = 0;

  constructor(
    readonly eid: number,
    readonly id: string,
    private readonly sink: AnimSink | null = null,
    t0 = 0,
  ) {
    this.t0 = t0;
    this.lastNow = t0;
  }

  private emit(name: AnimEventName, slot = -1, kind: CastKind = 'directed', foot = -1): void {
    this.sink?.(name, this, slot, kind, foot);
  }

  /** A cast started: `durMs` = wind-up until the release (sim cast time), `kind` from the ability type. */
  onCast(now: number, durMs: number, kind: CastKind, slot = -1): void {
    const dur = Math.max(0, Math.min(1500, durMs));
    this.cast = { t0: now, dur, kind, slot, released: false, quiet: kind === 'self' && dur === 0 && this.moving };
    this.emit('castStart', slot, kind);
  }

  /** Took a hit from (sx, sy): short knock-back flinch, rate-limited so damage over time does not jitter. */
  onHit(now: number, sx: number, sy: number): void {
    if (now - this.hitT < FLINCH_GAP_MS) return;
    const dx = this.x - sx;
    const dy = this.y - sy;
    const d = Math.hypot(dx, dy) || 1;
    this.hitT = now;
    this.hx = dx / d;
    this.hy = dy / d;
    this.emit('hit');
  }

  /** Dying: drops every running action (the corpse is a separate ghost sprite). */
  onDeath(): void {
    this.cast = null;
    this.atk0 = 0;
    this.atkHit = 0;
    this.emit('death');
  }

  get casting(): boolean {
    return this.cast !== null;
  }

  private castLen(c: CastState): number {
    return c.dur + CAST_AFTER_MS[c.kind];
  }

  private castFrame(c: CastState, ms: number, cs: ClipSet): number {
    const n = cs.clips.cast.frames;
    if (ms < c.dur) return 0; // gather (castTime 0: skipped)
    const k = ms - c.dur;
    if (c.kind === 'self') return n > cs.flex ? cs.flex : n - 1;
    if (c.kind === 'dash') return Math.min(n - 1, cs.release);
    return Math.min(n - 1, k < AFTER_MS * 1.3 ? cs.release : cs.release + 1);
  }

  update(inp: AnimInput, cs: ClipSet, now: number): void {
    const dt = Math.max(0, Math.min(100, now - this.lastNow));
    this.lastNow = now;
    this.x = inp.x;
    this.y = inp.y;
    this.dir = inp.dir;
    const atkN = cs.clips.attack.frames;
    const hit = cs.hit;

    // ---- attack: the strike frame lands exactly on the sim's hit point (atkPhase 1 -> 2)
    const ph = inp.atkPhase;
    const span = inp.atkStart !== undefined && inp.atkEnd !== undefined ? (inp.atkEnd - inp.atkStart) * TICK_MS : 0;
    if (ph === 1 && this.phase !== 1) {
      this.atk0 = now;
      this.atkHit = 0;
      this.back = 1;
      this.exactWind = span > 0 && span <= 1500 ? span : 0;
      if (this.exactWind) this.wind = this.exactWind;
      this.emit('windup');
    } else if (ph === 2 && this.phase !== 2) {
      if (this.phase === 1 && this.atk0 && !this.exactWind) this.wind = Math.max(80, Math.min(1500, now - this.atk0));
      // attack speed: the backswing gets what is left of the attack cycle after the wind-up
      this.back = span > 0 && this.wind > 0 && atkN > hit ? backswingScale(span - this.wind, atkN - hit) : 1;
      this.atkHit = now;
      this.atk0 = 0;
      if (atkN) this.emit('hitFrame');
    } else if (ph === 0 && this.phase === 1) this.atk0 = 0; // cancelled wind-up
    this.phase = ph;

    // ---- cast: events, CC interrupt, end
    const c = this.cast;
    if (c) {
      const ms = now - c.t0;
      if (!c.released && ms < c.dur && (inp.cc & CC_INTERRUPT) !== 0) {
        this.cast = null;
        this.emit('castCancel', c.slot, c.kind);
      } else {
        if (!c.released && ms >= c.dur) {
          c.released = true;
          this.emit('release', c.slot, c.kind);
        }
        if (ms >= this.castLen(c)) this.cast = null;
      }
    }

    // ---- recall edges
    if (inp.recalling !== this.recalling) {
      this.recalling = inp.recalling;
      this.recallT0 = now;
      this.emit(inp.recalling ? 'recallStart' : 'recallEnd');
    }

    // ---- which clip / frame
    if (inp.moving) this.lastMove = now;
    const walking = inp.moving || (this.state === 'walk' && now - this.lastMove < STOP_GRACE_MS);
    let anim: Anim = 'idle';
    let state: LogicalState = 'idle';
    let frame = -1;
    const cc = this.cast;
    const castN = cs.clips.cast.frames;
    if (cc && !cc.quiet && castN > 0) {
      anim = 'cast';
      state = 'cast';
      frame = this.castFrame(cc, now - cc.t0, cs);
    } else if (ph === 1 && atkN > 0 && this.atk0) {
      // anticipation spread over the sim's wind-up (exact when the snapshot has the ticks)
      anim = 'attack';
      state = 'windup';
      const est = this.exactWind || this.wind || inp.windGuess;
      frame = hit > 0 ? Math.min(hit - 1, Math.floor(((now - this.atk0) / est) * hit)) : 0;
    } else if (this.atkHit && atkN > 0) {
      const el = (now - this.atkHit) / this.back;
      // strike, follow-through, recover (walking during the backswing cancels it: orbwalking)
      if (el < (atkN - hit) * AFTER_MS + RELEASE_SLACK_MS && (!inp.moving || el < AFTER_MS)) {
        anim = 'attack';
        const f = afterFrame(el, atkN - hit);
        frame = hit + f;
        state = f === 0 ? 'release' : 'recovery';
      }
    }
    if (anim === 'idle' && state === 'idle') {
      if (inp.recalling && !inp.moving && castN > 0) {
        anim = 'cast';
        state = 'recall';
        frame = now - this.recallT0 < RECALL_GATHER_MS ? 0 : cs.flex;
      } else if (walking && cs.clips.run.frames > 0) {
        anim = 'run';
        state = 'walk';
      }
    }
    if (anim !== this.anim) {
      this.anim = anim;
      this.t0 = now;
    }
    this.state = state;

    if (anim === 'run') {
      const fps = cs.clips.run.fps;
      this.runMs += dt * runSpeedScale(inp.speed, cs.refSpeed);
      const raw = Math.floor(((this.runMs + this.eid * 97) / 1000) * fps);
      this.footsteps(cs, raw);
      this.runRaw = raw;
      frame = raw;
    } else {
      this.runRaw = -1;
      if (frame < 0) frame = Math.floor(((now - this.t0 + this.eid * 97) / 1000) * cs.clips[anim].fps);
    }
    this.frame = frame;
    this.moving = inp.moving;

    // ---- flinch: a quick knock away from the source
    const fk = (now - this.hitT) / FLINCH_MS;
    if (fk >= 0 && fk < 1) {
      const busy = state === 'windup' || state === 'cast' || state === 'recall';
      const d = Math.sin(fk * Math.PI) * FLINCH * (1 - fk * 0.5) * (busy ? FLINCH_BUSY : 1);
      this.ox = this.hx * d;
      this.oy = this.hy * d;
    } else {
      this.ox = 0;
      this.oy = 0;
    }
  }

  /** Fires `footstep` for every contact frame the run clip passed since the last update. */
  private footsteps(cs: ClipSet, raw: number): void {
    const run = cs.clips.run;
    if (this.runRaw < 0 || raw <= this.runRaw || run.frames <= 0) return; // entering the run clip: no step on entry
    const from = Math.max(this.runRaw + 1, raw - run.frames + 1);
    for (let k = from; k <= raw; k++) {
      const idx = ((k % run.frames) + run.frames) % run.frames;
      let foot = 0;
      for (let i = 0; i < run.events.length; i++) {
        const ev = run.events[i]!;
        if (ev.name !== 'footstep') continue;
        if (ev.frame === idx) {
          this.emit('footstep', -1, 'directed', foot);
          break;
        }
        foot++;
      }
    }
  }
}
