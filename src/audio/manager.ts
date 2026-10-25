// Audio manager: one AudioContext, four buses (SFX, UI, Ambient, Music) under a master + compressor, spatial mix,
// voice limiting and node cleanup. The synthesis itself lives in sfx.ts; this file knows nothing about cues.
//
// Autoplay: the context is only created in `unlock()` (call it from a user gesture). While it is suspended, `begin`
// returns null, so nothing is scheduled and the console stays clean.
import { VoiceAllocator, DEFAULT_LIMITS, PRIORITY_OWN, type VoiceLimits, type VoiceStats, CAT_COUNT } from './voices';
import { createListener, spatialize, priorityOf, Rel, type Listener, type RelValue, type Spatial } from './spatial';

export type BusName = 'sfx' | 'ui' | 'ambient' | 'music';
export const BUS_NAMES: readonly BusName[] = ['sfx', 'ui', 'ambient', 'music'];

export interface Volumes {
  master: number;
  sfx: number;
  ui: number;
  ambient: number;
  music: number;
}

/** Static description of one sound (see the table in sfx.ts). */
export interface CueDef {
  /** Unique small integer >= 1 (dedupe key space). */
  id: number;
  cat: number;
  bus: BusName;
  /** Base priority 0..99, see spatial.priorityOf. */
  priority: number;
  /** Seconds: the same key may not restart within this time. */
  cooldown: number;
  /** Cooldown per source entity (true) or per cue (false). */
  perSource: boolean;
  /** Base gain before the spatial mix. */
  gain: number;
  /** False: heard everywhere at `gain` (UI, announcer, pings). */
  spatial: boolean;
}

export interface PlayOpts {
  /** Relation of a champion source to the local player; omit for minions, towers and the world. */
  rel?: RelValue;
  /** Source entity id (dedupe per source). */
  src?: number;
  /** Added to the base priority (e.g. ultimates). */
  boost?: number;
}

/** One playing sound: a gain + panner chain on a bus, plus the sources feeding it. Released when the last source ends. */
export class Voice {
  /** Where sources connect. */
  out!: GainNode;
  /** Context time at which the sound starts. */
  t = 0;
  /** Latest end of any source. */
  end = 0;
  pending = 0;
  nodes = 2;
  slot = -1;
  cut = false;
  closed = false;
  pan!: StereoPannerNode;
}

export interface AudioStats extends VoiceStats {
  active: number;
  activeByCat: number[];
  /** WebAudio nodes created by voices that are not released yet. */
  liveNodes: number;
  peakLiveNodes: number;
  running: boolean;
}

export class AudioManager {
  ctx: AudioContext | null = null;
  readonly listener: Listener = createListener();
  readonly volumes: Volumes = { master: 0.6, sfx: 1, ui: 1, ambient: 0.5, music: 0.5 };
  alloc: VoiceAllocator;

  private createContext: () => AudioContext = () => new AudioContext();
  private master: GainNode | null = null;
  private buses: Partial<Record<BusName, GainNode>> = {};
  private readonly chains: (Voice | null)[];
  private readonly sp: Spatial = { gain: 1, pan: 0, nearness: 0 };
  private noiseBuf: AudioBuffer | null = null;
  private liveNodes = 0;
  private peakLiveNodes = 0;
  private failed = false;
  private readonly onRunning: (() => void)[] = [];

  constructor(limits: VoiceLimits = DEFAULT_LIMITS) {
    this.alloc = new VoiceAllocator(limits);
    this.chains = new Array<Voice | null>(limits.global + 1).fill(null);
  }

  /** Tests and tools: replace the context factory / limits. Only valid before `unlock`. */
  configure(opts: { createContext?: () => AudioContext; limits?: VoiceLimits }): void {
    if (opts.createContext) this.createContext = opts.createContext;
    if (opts.limits) {
      this.alloc = new VoiceAllocator(opts.limits);
      this.chains.length = 0;
      for (let i = 0; i <= opts.limits.global; i++) this.chains.push(null);
    }
  }

  /** Create the context on the first call (needs a user gesture) and resume it when the browser suspended it. */
  unlock(): void {
    if (!this.ctx && !this.failed) {
      try {
        const ctx = this.createContext();
        const master = ctx.createGain();
        const comp = ctx.createDynamicsCompressor();
        master.connect(comp);
        comp.connect(ctx.destination);
        for (const b of BUS_NAMES) {
          const g = ctx.createGain();
          g.connect(master);
          this.buses[b] = g;
        }
        this.ctx = ctx;
        this.master = master;
        this.applyVolumes();
      } catch {
        this.failed = true; // no WebAudio: stay silent
        return;
      }
    }
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state !== 'running') {
      try {
        void ctx.resume().then(() => this.fireRunning(), () => undefined);
      } catch {
        /* blocked: the next gesture tries again */
      }
    } else {
      this.fireRunning();
    }
  }

  get running(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** Called (once each) when the context is running, e.g. to start the ambient loop. */
  whenRunning(fn: () => void): void {
    if (this.running) fn();
    else this.onRunning.push(fn);
  }

  private fireRunning(): void {
    if (!this.running) return;
    while (this.onRunning.length) this.onRunning.shift()!();
  }

  setVolumes(v: Partial<Volumes>): void {
    for (const k of Object.keys(v) as (keyof Volumes)[]) {
      const x = v[k];
      if (typeof x === 'number' && Number.isFinite(x)) this.volumes[k] = Math.min(1, Math.max(0, x));
    }
    this.applyVolumes();
  }

  private applyVolumes(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, t, 0.015);
    for (const b of BUS_NAMES) this.buses[b]!.gain.setTargetAtTime(this.volumes[b], t, 0.015);
  }

  bus(name: BusName): GainNode | null {
    return this.buses[name] ?? null;
  }

  setListener(x: number, y: number): void {
    this.listener.x = x;
    this.listener.y = y;
  }

  /**
   * Start a voice, or null when the sound is not heard (context not running, out of range, deduped, voice caps).
   * The caller adds sources with `tone` / `noise` and then calls `finish`.
   */
  begin(def: CueDef, x?: number, y?: number, opts?: PlayOpts): Voice | null {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return null;
    const rel = opts?.rel ?? Rel.Neutral;
    const sp = this.sp;
    let gain = def.gain;
    let pan = 0;
    let nearness = 0;
    if (def.spatial && x !== undefined && y !== undefined) {
      if (!spatialize(this.listener, x, y, rel, sp)) return null;
      gain *= sp.gain;
      pan = sp.pan;
      nearness = sp.nearness;
    } else if (rel === Rel.Own) {
      nearness = 0;
    }
    const priority = priorityOf(def.priority + (opts?.boost ?? 0), rel, nearness, PRIORITY_OWN);
    const key = def.id * 0x100000 + (def.perSource ? (opts?.src ?? 0) & 0xfffff : 0);
    const now = ctx.currentTime;
    const slot = this.alloc.request(def.cat, priority, key, def.cooldown, now);
    const stolen = this.alloc.lastStolen;
    if (stolen >= 0) {
      const old = this.chains[stolen];
      if (old) this.cutVoice(old, now);
      this.chains[stolen] = null;
    }
    if (slot < 0) return null;
    const v = new Voice();
    const vol = ctx.createGain();
    vol.gain.value = gain;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    vol.connect(p);
    p.connect(this.buses[def.bus]!);
    v.out = vol;
    v.pan = p;
    v.t = now;
    v.end = now;
    v.slot = slot;
    this.chains[slot] = v;
    this.addNodes(2);
    return v;
  }

  /** Call after all sources of a voice were added. */
  finish(v: Voice): void {
    if (v.pending === 0) this.closeVoice(v);
    else if (!v.cut) this.alloc.setEnd(v.slot, v.end + 0.05);
  }

  /** Oscillator through an attack/decay envelope. `delay` shifts the start inside the voice (seconds). */
  tone(v: Voice, type: OscillatorType, f0: number, f1: number, dur: number, peak = 0.3, attack = 0.005, delay = 0): void {
    const ctx = this.ctx!;
    const t = v.t + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this.envelope(v, t, peak, attack, dur);
    o.connect(g);
    const stop = t + attack + dur + 0.02;
    o.start(t);
    o.stop(stop);
    this.track(v, o, stop, 2);
  }

  /** Filtered noise burst through an envelope. */
  noise(v: Voice, dur: number, freq: number, q: number, peak = 0.3, type: BiquadFilterType = 'bandpass', delay = 0): void {
    const ctx = this.ctx!;
    const t = v.t + delay;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuffer();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    s.connect(f);
    f.connect(this.envelope(v, t, peak, 0.004, dur));
    const stop = t + dur + 0.05;
    s.start(t);
    s.stop(stop);
    this.track(v, s, stop, 3);
  }

  /** One second of white noise, shared by all noise bursts. */
  noiseBuffer(): AudioBuffer {
    if (!this.noiseBuf) {
      const ctx = this.ctx!;
      const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = b;
    }
    return this.noiseBuf;
  }

  private envelope(v: Voice, t: number, peak: number, attack: number, decay: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(v.out);
    return g;
  }

  /** Register a started source: counts its nodes and releases the voice once the last source has ended. */
  private track(v: Voice, src: AudioScheduledSourceNode, stop: number, nodes: number): void {
    v.pending++;
    v.nodes += nodes;
    this.addNodes(nodes);
    if (stop > v.end) v.end = stop;
    src.onended = () => {
      src.disconnect();
      if (--v.pending <= 0) this.closeVoice(v);
    };
  }

  /** Fade out a voice that lost its slot to a higher-priority sound. Its nodes are freed when its sources end. */
  private cutVoice(v: Voice, now: number): void {
    v.cut = true;
    v.out.gain.cancelScheduledValues(now);
    v.out.gain.setTargetAtTime(0, now, 0.008);
  }

  private closeVoice(v: Voice): void {
    if (v.closed) return;
    v.closed = true;
    v.out.disconnect();
    v.pan.disconnect();
    this.liveNodes -= v.nodes;
    // the slot may already belong to a newer voice (time-based prune or steal): only release our own
    if (!v.cut && this.chains[v.slot] === v) {
      this.alloc.release(v.slot);
      this.chains[v.slot] = null;
    }
  }

  private addNodes(n: number): void {
    this.liveNodes += n;
    if (this.liveNodes > this.peakLiveNodes) this.peakLiveNodes = this.liveNodes;
  }

  stats(): AudioStats {
    const by: number[] = [];
    for (let c = 0; c < CAT_COUNT; c++) by.push(this.alloc.activeIn(c));
    return { ...this.alloc.stats, active: this.alloc.active, activeByCat: by, liveNodes: this.liveNodes, peakLiveNodes: this.peakLiveNodes, running: this.running };
  }
}
