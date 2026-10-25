// D1b ability particle language, A4: now a thin facade over the data-driven GPU particle system in src/render/vfx/.
// The six kinds (ember / spark / drip / mote / shard / blackflame) are effect definitions of the same name
// (src/render/vfx/effects/<kind>.json); their emission rates (trail / burst / ambient) stay in abilityMotifs.json.
// The call signature is unchanged for fx.ts and groundObjects.ts. Purely visual, no sim access.
import { PARTICLE_KINDS, PARTICLE_KIND_IDS, type ParticleKind, type ParticleKindId } from './abilityTheme';
import { VfxSystem, type EmitOpts } from './vfx/system';
import type { VfxClass } from './vfx/schema';

export class Particles {
  /** The GPU particle system (new effects are emitted on it directly). */
  readonly vfx = new VfxSystem();
  readonly group = this.vfx.group;
  private readonly handles = new Map<ParticleKindId, number>();
  private readonly o: EmitOpts = {};

  constructor() {
    for (const id of PARTICLE_KIND_IDS) {
      const h = this.vfx.handle(id);
      if (h < 0) console.warn(`[vfx] particle kind "${id}" has no effect definition`);
      else this.handles.set(id, h);
    }
  }

  /** Global emission scale (reduce motion: fewer particles). */
  get scale(): number {
    return this.vfx.scale;
  }
  set scale(v: number) {
    this.vfx.scale = v;
  }

  kind(id: ParticleKindId): ParticleKind {
    return PARTICLE_KINDS[id];
  }

  /** Live particle count (all effects). */
  get live(): number {
    return this.vfx.live;
  }

  /**
   * Emit `count` particles of `id` at sim (x, y), height h, element hue. `dir` = flight direction (sim units, unit
   * vector) for trails: shards spray backwards along it. `cls`: effect class pool (default: projectile trails).
   */
  emit(id: ParticleKindId, x: number, y: number, h: number, hue: number, count: number, now: number, dir?: { dx: number; dy: number }, spread = 1, cls?: VfxClass): void {
    const handle = this.handles.get(id);
    if (handle === undefined) return;
    const o = this.o;
    o.count = count;
    o.hue = hue;
    o.dx = dir?.dx;
    o.dy = dir?.dy;
    o.spread = spread;
    o.cls = cls;
    this.vfx.emit(handle, x, y, h, now, o);
  }

  update(now: number, _dt?: number): void {
    this.vfx.update(now);
  }
}
