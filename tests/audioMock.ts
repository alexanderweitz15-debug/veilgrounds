// Minimal deterministic WebAudio mock for the audio tests: a node graph with connect/disconnect, a manual clock and
// scheduled sources that fire `onended` when the clock passes their stop time. Counts nodes that still reach the
// destination (the "live" graph), which is what a leak would grow.

class Param {
  value = 0;
  readonly inputs = new Set<MockNode>();
  setValueAtTime(v: number): this {
    this.value = v;
    return this;
  }
  exponentialRampToValueAtTime(v: number): this {
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number): this {
    this.value = v;
    return this;
  }
  setTargetAtTime(v: number): this {
    this.value = v;
    return this;
  }
  cancelScheduledValues(): this {
    return this;
  }
}

export class MockNode {
  readonly outputs = new Set<MockNode | Param>();
  readonly inputs = new Set<MockNode>();
  readonly gain = new Param();
  readonly pan = new Param();
  readonly frequency = new Param();
  readonly Q = new Param();
  type = '';
  buffer: unknown = null;
  loop = false;
  loopEnd = 0;
  onended: (() => void) | null = null;
  stopAt = Infinity;
  started = false;
  ended = false;
  constructor(readonly kind: string, readonly ctx: MockContext) {}
  connect(n: MockNode | Param): MockNode | Param {
    this.outputs.add(n);
    n.inputs.add(this);
    return n;
  }
  disconnect(): void {
    for (const o of this.outputs) o.inputs.delete(this);
    this.outputs.clear();
  }
  start(): void {
    this.started = true;
    if (this.kind === 'osc' || this.kind === 'bufsrc') this.ctx.sources.add(this);
  }
  stop(t: number): void {
    this.stopAt = t;
  }
}

export class MockContext {
  currentTime = 0;
  state: 'suspended' | 'running' = 'suspended';
  sampleRate = 8000;
  readonly sources = new Set<MockNode>();
  readonly destination = new MockNode('destination', this);
  resumeCalls = 0;

  /** Simulates the autoplay policy: resume() rejects and the state stays suspended until a gesture. */
  autoplayBlocked = false;

  resume(): Promise<void> {
    this.resumeCalls++;
    if (this.autoplayBlocked) return Promise.reject(new Error('NotAllowedError'));
    this.state = 'running';
    return Promise.resolve();
  }
  createGain = (): MockNode => new MockNode('gain', this);
  createStereoPanner = (): MockNode => new MockNode('panner', this);
  createBiquadFilter = (): MockNode => new MockNode('filter', this);
  createDynamicsCompressor = (): MockNode => new MockNode('comp', this);
  createOscillator = (): MockNode => new MockNode('osc', this);
  createBufferSource = (): MockNode => new MockNode('bufsrc', this);
  createBuffer(_ch: number, len: number): { getChannelData(): Float32Array } {
    const d = new Float32Array(len);
    return { getChannelData: () => d };
  }

  /** Advance the clock and end every source whose stop time has passed. */
  advance(seconds: number): void {
    this.currentTime += seconds;
    for (const n of [...this.sources]) {
      if (n.stopAt <= this.currentTime) {
        n.ended = true;
        this.sources.delete(n);
        n.onended?.();
      }
    }
  }

  /** Nodes (excluding the destination) from which the destination can still be reached. */
  liveNodes(): number {
    const seen = new Set<MockNode>();
    const stack = [this.destination];
    while (stack.length) {
      const n = stack.pop()!;
      for (const p of n.inputs) {
        if (!seen.has(p)) {
          seen.add(p);
          stack.push(p);
        }
      }
    }
    return seen.size;
  }
}
