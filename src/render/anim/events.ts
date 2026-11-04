// Animation event bus (A3): render subsystems (VFX, audio, game feel) subscribe here instead of polling sprite state.
//
//   import { animEvents } from './anim';
//   const off = animEvents.on('hitFrame', (e) => spawnImpact(e.x, e.y));
//   animEvents.on('*', (e) => ...);   // every event
//   off();
//
// Events are raised from inside the render loop (ChampionSprites.push / end), once per occurrence, in render order. The
// event object is reused: copy what you need. With no listener for a name nothing is built, so an unused event is free.
import type { AnimEvent, AnimEventName } from './types';

type Listener = (e: Readonly<AnimEvent>) => void;

export class AnimEventBus {
  private readonly by = new Map<AnimEventName | '*', Listener[]>();
  private readonly ev: AnimEvent = { name: 'hit', eid: -1, id: '', t: 0, x: 0, y: 0, dir: 'S', slot: -1, kind: 'directed', foot: -1 };
  private any = 0;

  /** Subscribes to one event name (or '*' for all). Returns the unsubscribe function. */
  on(name: AnimEventName | '*', fn: Listener): () => void {
    const l = this.by.get(name) ?? [];
    l.push(fn);
    this.by.set(name, l);
    this.any++;
    return () => {
      const cur = this.by.get(name);
      const i = cur ? cur.indexOf(fn) : -1;
      if (i >= 0) {
        cur!.splice(i, 1);
        this.any--;
      }
    };
  }

  /** True if somebody listens to `name` (cheap guard for emitters). */
  wants(name: AnimEventName): boolean {
    return this.any > 0 && ((this.by.get(name)?.length ?? 0) > 0 || (this.by.get('*')?.length ?? 0) > 0);
  }

  /** The reusable event object for the emitter to fill; call `dispatch` right after. */
  get scratch(): AnimEvent {
    return this.ev;
  }

  dispatch(): void {
    const ev = this.ev;
    const a = this.by.get(ev.name);
    if (a) for (let i = 0; i < a.length; i++) a[i]!(ev);
    const b = this.by.get('*');
    if (b) for (let i = 0; i < b.length; i++) b[i]!(ev);
  }

  clear(): void {
    this.by.clear();
    this.any = 0;
  }
}

/** The game's bus: ChampionSprites batches raise their events here. */
export const animEvents = new AnimEventBus();
