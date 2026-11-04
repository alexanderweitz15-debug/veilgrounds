// Audio manager + sound table with a mock AudioContext: autoplay, buses, voice caps in practice, node cleanup over a
// 30-minute game, trigger API. Real WebAudio is never touched.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockContext, type MockNode } from './audioMock';
import { AudioManager } from '../src/audio/manager';
import { audioManager, audioUnlock, audioStop, play, playCast, playAnnounce, playFizzle, setListener, applyAudioSettings, emitTrigger, onTrigger, Rel } from '../src/audio/sfx';
import { settings } from '../src/settings';
import { triggerHandlerCount } from '../src/audio/triggers';

const mock = new MockContext();
audioManager.configure({ createContext: () => mock as unknown as AudioContext });

/** Persistent graph: master, compressor, four buses (+ ambient loop nodes once it runs). */
const BASE_NODES = 6;

afterEach(() => {
  audioStop();
  mock.advance(10);
});

describe('autoplay policy', () => {
  it('does nothing and throws nothing before the first user gesture', () => {
    expect(mock.liveNodes()).toBe(0);
    expect(() => {
      play('ui');
      playCast('x', 'skillshot_line', 10, 10);
      playAnnounce('good');
      playFizzle();
    }).not.toThrow();
    expect(audioManager.ctx).toBeNull();
    expect(audioManager.stats().started).toBe(0);
  });

  it('a blocked resume stays silent without errors; the next gesture succeeds', async () => {
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a));
    mock.autoplayBlocked = true;
    audioUnlock();
    await Promise.resolve();
    expect(mock.state).toBe('suspended');
    expect(() => play('ui')).not.toThrow();
    expect(audioManager.stats().started).toBe(0);
    mock.autoplayBlocked = false;
    audioUnlock();
    await Promise.resolve();
    expect(mock.state).toBe('running');
    play('ui');
    expect(audioManager.stats().started).toBe(1);
    expect(errors).toEqual([]);
    spy.mockRestore();
  });

  it('survives a missing AudioContext', () => {
    const m = new AudioManager();
    m.configure({
      createContext: () => {
        throw new Error('no WebAudio');
      },
    });
    expect(() => m.unlock()).not.toThrow();
    expect(m.running).toBe(false);
  });
});

describe('buses and volumes', () => {
  it('creates the four buses and applies master + channel volumes', () => {
    audioUnlock();
    for (const b of ['sfx', 'ui', 'ambient', 'music'] as const) expect(audioManager.bus(b)).not.toBeNull();
    settings.volume = 0.5;
    settings.volumeSfx = 0.25;
    settings.volumeUi = 0.75;
    settings.volumeAmbient = 0.1;
    settings.volumeMusic = 0;
    applyAudioSettings();
    expect(audioManager.bus('sfx')!.gain.value).toBeCloseTo(0.25);
    expect(audioManager.bus('ui')!.gain.value).toBeCloseTo(0.75);
    expect(audioManager.bus('ambient')!.gain.value).toBeCloseTo(0.1);
    expect(audioManager.bus('music')!.gain.value).toBe(0);
    expect(audioManager.volumes.master).toBe(0.5);
  });

  it('clamps and ignores invalid volumes', () => {
    const m = new AudioManager();
    m.setVolumes({ master: 7, sfx: -1, ui: NaN });
    expect(m.volumes.master).toBe(1);
    expect(m.volumes.sfx).toBe(0);
    expect(m.volumes.ui).toBe(1);
  });

  it('routes world sounds to the sfx bus and feedback sounds to the ui bus', () => {
    audioUnlock();
    setListener(0, 0);
    const sfx = audioManager.bus('sfx')!;
    const ui = audioManager.bus('ui')!;
    play('auto', 100, 0, { rel: Rel.Own, src: 1 });
    play('ui');
    const into = (bus: GainNode): number => (bus as unknown as MockNode).inputs.size;
    expect(into(sfx)).toBe(1);
    expect(into(ui)).toBe(1);
  });
});

describe('spatial culling and voice limits through the facade', () => {
  it('drops far sounds, keeps the own champion far from the camera', () => {
    audioUnlock();
    setListener(0, 0);
    const before = audioManager.stats().started;
    play('auto', 9000, 0, { src: 5, rel: Rel.Enemy });
    expect(audioManager.stats().started).toBe(before);
    play('auto', 9000, 0, { src: 6, rel: Rel.Own });
    expect(audioManager.stats().started).toBe(before + 1);
  });

  it('a minion flood stays within the category cap and does not displace the own champion', () => {
    audioUnlock();
    setListener(0, 0);
    mock.advance(5);
    for (let i = 0; i < 200; i++) play('footstep', 50 + (i % 7), 0, { src: 1000 + i });
    const s = audioManager.stats();
    expect(s.activeByCat[2]).toBe(4);
    expect(s.denied).toBeGreaterThan(0);
    expect(s.active).toBeLessThanOrEqual(20);
    const before = audioManager.stats().started;
    playCast('own_q', 'skillshot_line', 0, 0, false, { rel: Rel.Own, src: 1 });
    expect(audioManager.stats().started).toBe(before + 1);
  });

  it('dedupes the same cue from the same source within its cooldown', () => {
    audioUnlock();
    setListener(0, 0);
    mock.advance(5);
    const before = audioManager.stats().started;
    for (let i = 0; i < 10; i++) play('tower', 100, 0, { src: 42 });
    expect(audioManager.stats().started).toBe(before + 1);
    mock.advance(0.2);
    play('tower', 100, 0, { src: 42 });
    expect(audioManager.stats().started).toBe(before + 2);
  });

  it('a cut (stolen) voice is released once its sources end', () => {
    audioUnlock();
    setListener(0, 0);
    mock.advance(5);
    // 8 casts fill the cast category; a ninth with higher priority steals one
    for (let i = 0; i < 8; i++) playCast('c' + i, 'self', 100, 0, false, { rel: Rel.Ally, src: 100 + i });
    const s0 = audioManager.stats();
    expect(s0.activeByCat[0]).toBe(8);
    playCast('own', 'self', 0, 0, true, { rel: Rel.Own, src: 1 });
    const s1 = audioManager.stats();
    expect(s1.stolen).toBe(s0.stolen + 1);
    expect(s1.activeByCat[0]).toBe(8);
    mock.advance(5);
    expect(audioManager.stats().liveNodes).toBe(0);
  });
});

describe('node cleanup', () => {
  it('releases every node after playback (no leak over a simulated 30-minute game)', () => {
    audioUnlock();
    setListener(0, 0);
    mock.advance(10);
    const baseline = mock.liveNodes();
    expect(baseline).toBeGreaterThanOrEqual(BASE_NODES); // buses (+ ambient)
    let seed = 7;
    const rnd = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const cues = ['auto', 'autoHeavy', 'minionAuto', 'tower', 'hit', 'death', 'champDeath', 'plate', 'footstep', 'lastHit', 'gold', 'ping', 'ui', 'levelUp', 'wave'] as const;
    const ticks = 30 * 60 * 30; // 30 min at 30 Hz
    let peakLive = 0;
    let peakActive = 0;
    for (let t = 0; t < ticks; t++) {
      // quiet laning most of the time, a teamfight burst every minute
      const fight = t % 1800 < 300;
      const n = fight ? 6 : 1;
      for (let k = 0; k < n; k++) {
        const x = (rnd() - 0.5) * 3000;
        const y = (rnd() - 0.5) * 3000;
        const r = rnd();
        const rel = r < 0.1 ? Rel.Own : r < 0.4 ? Rel.Enemy : r < 0.6 ? Rel.Ally : Rel.Neutral;
        const src = Math.floor(rnd() * 60);
        if (rnd() < 0.3) playCast('ab' + Math.floor(rnd() * 20), 'skillshot_line', x, y, rnd() < 0.1, { rel, src });
        else play(cues[Math.floor(rnd() * cues.length)]!, x, y, { rel, src });
      }
      if (t % 600 === 0) playAnnounce('epic');
      mock.advance(1 / 30);
      if (t % 100 === 0) {
        peakLive = Math.max(peakLive, mock.liveNodes());
        peakActive = Math.max(peakActive, audioManager.stats().active);
      }
    }
    mock.advance(10);
    const s = audioManager.stats();
    expect(s.active).toBe(0);
    expect(s.liveNodes).toBe(0);
    expect(mock.liveNodes()).toBe(baseline); // nothing but the buses (+ ambient) is left connected
    expect(s.started).toBeGreaterThan(10000);
    expect(s.peak).toBeLessThanOrEqual(20);
    // bounded by the caps: 20 voices x (2 chain nodes + <= 5 sources with their envelopes/filters)
    expect(peakLive).toBeLessThan(baseline + 20 * 22);
    expect(peakActive).toBeLessThanOrEqual(20);
  }, 60000);
});

describe('triggers', () => {
  it('default handlers play footstep, hitFrame, release and killConfirm sounds', () => {
    audioUnlock();
    setListener(0, 0);
    mock.advance(5);
    const before = audioManager.stats().started;
    emitTrigger('footstep', { x: 10, y: 0, src: 1, rel: Rel.Own });
    emitTrigger('hitFrame', { x: 10, y: 0, rel: Rel.Own, src: 1 });
    emitTrigger('release', { x: 10, y: 0, rel: Rel.Own, src: 1, abilityId: 'q', abilityType: 'dash' });
    emitTrigger('killConfirm');
    expect(audioManager.stats().started).toBe(before + 4);
  });

  it('supports extra handlers and unsubscribe, and a throwing handler does not break the emitter', () => {
    const calls: number[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const n0 = triggerHandlerCount('footstep');
    const off1 = onTrigger('footstep', () => {
      throw new Error('boom');
    });
    const off2 = onTrigger('footstep', (p) => void calls.push(p.src ?? -1));
    expect(triggerHandlerCount('footstep')).toBe(n0 + 2);
    expect(() => emitTrigger('footstep', { src: 9 })).not.toThrow();
    expect(calls).toEqual([9]);
    off1();
    off2();
    expect(triggerHandlerCount('footstep')).toBe(n0);
    emitTrigger('footstep', { src: 10 });
    expect(calls).toEqual([9]);
    warn.mockRestore();
  });
});

describe('ambient', () => {
  it('starts on a running context and fades out on audioStop', () => {
    audioUnlock();
    const ambient = audioManager.bus('ambient') as unknown as MockNode;
    expect(ambient.inputs.size).toBe(1); // the ambient bed feeds the bus
    audioStop();
    mock.advance(2);
    expect(ambient.inputs.size).toBe(0);
  });
});
