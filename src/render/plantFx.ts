// Jungle plant effects (render only): sprout scale from SnapEntity.grow, ripe sparkle when a plant finished growing,
// idle glow on ripe fruits and honey pieces, pop burst on the death event and the pickup glow of an eaten honey piece.
// All of it goes through the shared ability particles; nothing here reads or changes the sim.
import type { SnapEntity } from '../sim/snapshot';
import { Kind, type SimEvent } from '../sim/types';
import type { Particles } from './particles';
import type { ClientState } from '../game/state';

/** Fruit colour (hue in degrees) for the particles. */
const HUE: Record<string, number> = { sprungfrucht: 28, honigfrucht: 46, honigstueck: 46, spaehfrucht: 212, manafrucht: 262, windfrucht: 150, schildfrucht: 196 };
const hueOf = (variant?: string): number => (variant ? HUE[variant] : undefined) ?? 48;

/** Sprout steps per growth (the sprite batch keeps one scale per unit state, see sproutEntity). */
const STEPS = 10;
/** Sprite scale of a plant that has grown `g` (0..1) of the way: starts at 20 %, overshoots a little, settles at 1. */
export function growScale(g: number | undefined): number {
  if (g === undefined || g >= 1) return 1;
  const t = Math.max(0, g) - 1;
  const back = 1 + 2.2 * t * t * t + 1.2 * t * t; // easeOutBack
  return 0.2 + 0.8 * back;
}

/**
 * The sprite batch (championSprites.ts) reads an entity's scale once, when it first sees the unit. A sprouting plant is
 * therefore handed over as a stand-in unit with its own serial per growth step: every step starts a fresh state with
 * the scale of that step (MONSTER_BATCH.scaleFor reads `grow`). Ceiling: 10 scale steps over 1.2 s; an optional scale
 * argument of ChampionSprites.push would make it continuous.
 */
export function sproutEntity(e: SnapEntity): SnapEntity {
  if (e.grow === undefined) return e;
  const step = Math.min(STEPS, Math.ceil(Math.max(0, e.grow) * STEPS));
  return { ...e, grow: step / STEPS, serial: e.serial + 10_000_000 * (step + 1) };
}

/** Ambient glow rate (particles per second) of a ripe fruit / honey piece. */
const GLOW_RATE = 1.6;

interface Seen {
  x: number;
  y: number;
  variant: string;
}

export class PlantFx {
  private last = 0;
  /** Serials that were still sprouting last frame (ripe sparkle when they stop) and honey pieces on the ground. */
  private readonly sprouting = new Map<number, Seen>();
  private readonly pieces = new Map<number, Seen>();

  constructor(private readonly particles: Particles) {}

  /** Plant death event: the pop burst in the fruit's colours. */
  onEvent(ev: SimEvent, now: number): void {
    if (ev.e !== 'death' || ev.kind !== Kind.Plant || !ev.variant) return;
    const hue = hueOf(ev.variant);
    this.particles.emit('spark', ev.x, ev.y, 46, hue, 22, now, undefined, 1.3);
    this.particles.emit('mote', ev.x, ev.y, 56, hue, 16, now, undefined, 1.1);
  }

  update(state: ClientState, now: number): void {
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const snap = state.snap;
    if (!snap) return;
    const sprouting = new Set<number>();
    const pieces = new Set<number>();
    for (const e of snap.entities) {
      if (e.kind !== Kind.Plant || !e.alive || !e.variant) continue;
      const hue = hueOf(e.variant);
      const x = state.x(e);
      const y = state.y(e);
      if (e.grow !== undefined) {
        sprouting.add(e.serial);
        this.sprouting.set(e.serial, { x, y, variant: e.variant });
        continue;
      }
      if (e.variant === 'honigstueck') {
        pieces.add(e.serial);
        this.pieces.set(e.serial, { x, y, variant: e.variant });
        this.particles.emit('mote', x, y, 26, hue, GLOW_RATE * 1.5 * dt, now, undefined, 0.5);
      } else this.particles.emit('mote', x, y, 70, hue, GLOW_RATE * dt, now, undefined, 0.5);
    }
    // ripe: no longer sprouting and still standing
    for (const [serial, s] of this.sprouting) {
      if (sprouting.has(serial)) continue;
      this.sprouting.delete(serial);
      if (snap.entities.some((e) => e.serial === serial && e.alive)) this.particles.emit('mote', s.x, s.y, 60, hueOf(s.variant), 7, now, undefined, 0.9);
    }
    // pickup: a honey piece that vanished with a champion standing on it was eaten (rotting pieces vanish alone)
    for (const [serial, s] of this.pieces) {
      if (pieces.has(serial)) continue;
      this.pieces.delete(serial);
      const eater = snap.entities.some((c) => c.kind === Kind.Champion && c.alive && Math.hypot(state.x(c) - s.x, state.y(c) - s.y) < 150);
      if (eater) {
        this.particles.emit('mote', s.x, s.y, 34, hueOf(s.variant), 12, now, undefined, 1);
        this.particles.emit('spark', s.x, s.y, 40, hueOf(s.variant), 6, now, undefined, 0.8);
      }
    }
  }
}
