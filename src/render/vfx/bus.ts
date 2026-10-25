// A4 VFX: subscription API. Animation code (A3: sprite `hitFrame`, `release`) and game feel (A8: `impact`, `kill` ...)
// publish named triggers with a position; the bus plays the effects bound to the trigger in bindings.json and calls
// any handler registered with `on`. Nothing here knows the sim or the sprites.
//
//   const off = fx.vfx.on('hitFrame', (ev) => ...);          // subscribe (returns the unsubscribe function)
//   fx.vfx.trigger('release', { x, y, h: 90, dx, dy, hue, team: 'own', slot: 2 });   // publish
//
// Triggers in use (free-form strings are allowed, unbound ones only reach handlers):
//   hitFrame  basic-attack hit frame of the attacker sprite, x/y = target       release  cast release frame, x/y = caster
//   impact    confirmed ability hit (A8)   ultimate  ultimate cast   death   unit died   levelUp   champion levelled
import bindingData from './bindings.json';
import { effectHandle } from './registry';
import type { EmitOpts, VfxSystem, VfxTeam } from './system';
import type { VfxClass } from './schema';

export interface VfxEvent {
  /** Sim position and height of the effect. */
  x: number;
  y: number;
  h?: number;
  /** Direction (unit vector, sim). */
  dx?: number;
  dy?: number;
  hue?: number;
  team?: VfxTeam;
  /** Intensity multiplier (1 = the effect's own count). */
  scale?: number;
  /** Ability slot (0..3, Sev 4..6) for slot filters. */
  slot?: number;
  /** Render clock in ms; default: the latest time the system saw. */
  now?: number;
}

export interface Binding {
  effect: string;
  /** Only for these relations (default: all). */
  team?: VfxTeam[];
  /** Only for ability slots >= minSlot (ultimate effects: 3). */
  minSlot?: number;
  count?: number;
  cls?: VfxClass;
  /** Radius override for disc / ring emitters. */
  radius?: number;
  h?: number;
}

type Handler = (ev: VfxEvent) => void;

export class VfxBus {
  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly bindings = new Map<string, Binding[]>();
  private readonly o: EmitOpts = {};
  /** Latest time seen from the owner (Fx.update), used when an event carries none. */
  clock = 0;

  constructor(private readonly sys: VfxSystem, data: Record<string, Binding[]> = bindingData as unknown as Record<string, Binding[]>) {
    for (const [trigger, list] of Object.entries(data)) {
      if (trigger.startsWith('_')) continue;
      this.bindings.set(
        trigger,
        list.filter((b) => {
          const ok = effectHandle(b.effect) >= 0;
          if (!ok) console.warn(`[vfx] binding ${trigger} -> unknown effect "${b.effect}"`);
          return ok;
        }),
      );
    }
  }

  /** Bound effect ids of a trigger (tests, docs). */
  bound(trigger: string): readonly Binding[] {
    return this.bindings.get(trigger) ?? [];
  }

  /** Subscribe to a trigger; returns the unsubscribe function. */
  on(trigger: string, fn: Handler): () => void {
    let set = this.handlers.get(trigger);
    if (!set) this.handlers.set(trigger, (set = new Set()));
    set.add(fn);
    return () => void set!.delete(fn);
  }

  /** Publish: play the bound effects, then call the handlers. Returns the number of particles spawned. */
  trigger(trigger: string, ev: VfxEvent): number {
    let n = 0;
    const list = this.bindings.get(trigger);
    if (list) {
      const o = this.o;
      const now = ev.now ?? this.clock;
      for (const b of list) {
        if (b.team && !(ev.team && b.team.includes(ev.team))) continue;
        if (b.minSlot !== undefined && (ev.slot ?? -1) < b.minSlot) continue;
        o.count = b.count !== undefined ? b.count * (ev.scale ?? 1) : ev.scale !== undefined ? this.sys.def(effectHandle(b.effect))!.count * ev.scale : undefined;
        o.hue = ev.hue;
        o.team = ev.team;
        o.dx = ev.dx;
        o.dy = ev.dy;
        o.cls = b.cls;
        o.radius = b.radius;
        n += this.sys.emit(b.effect, ev.x, ev.y, ev.h ?? b.h ?? 60, now, o);
      }
    }
    const hs = this.handlers.get(trigger);
    if (hs) for (const h of hs) h(ev);
    return n;
  }
}
