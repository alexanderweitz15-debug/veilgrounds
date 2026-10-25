// Animation event bus: subscribe per name or '*', unsubscribe, free when nobody listens.
import { describe, expect, it } from 'vitest';
import { AnimEventBus } from '../src/render/anim/events';

function fire(bus: AnimEventBus, name: 'hitFrame' | 'footstep', eid = 1): void {
  const e = bus.scratch;
  e.name = name;
  e.eid = eid;
  bus.dispatch();
}

describe('AnimEventBus', () => {
  it('delivers by name and to wildcard listeners', () => {
    const bus = new AnimEventBus();
    const hit: number[] = [];
    const all: string[] = [];
    bus.on('hitFrame', (e) => hit.push(e.eid));
    bus.on('*', (e) => all.push(e.name));
    fire(bus, 'hitFrame', 7);
    fire(bus, 'footstep');
    expect(hit).toEqual([7]);
    expect(all).toEqual(['hitFrame', 'footstep']);
  });

  it('wants() is false without listeners and after unsubscribe', () => {
    const bus = new AnimEventBus();
    expect(bus.wants('hitFrame')).toBe(false);
    const off = bus.on('hitFrame', () => undefined);
    expect(bus.wants('hitFrame')).toBe(true);
    expect(bus.wants('footstep')).toBe(false);
    off();
    expect(bus.wants('hitFrame')).toBe(false);
    off(); // idempotent
    expect(bus.wants('hitFrame')).toBe(false);
  });

  it('a wildcard listener wants every name', () => {
    const bus = new AnimEventBus();
    bus.on('*', () => undefined);
    expect(bus.wants('land')).toBe(true);
  });
});
