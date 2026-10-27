// Interactive tutorial, logic part (no DOM): the step list, the detection of "the player did it" from the snapshot and
// the observed player commands, the sandbox preparation of every step (teleport, level, gold, minions) and the saved
// progress. The tutorial runs in the sandbox sim (cheats allowed); src/ui/tutorial.ts draws the cards and highlights.
import type { PlayerHud, Snapshot } from '../sim/snapshot';
import { Kind, type Command } from '../sim/types';

export type StepId = 'move' | 'attackMove' | 'levelUp' | 'cast' | 'shop' | 'ward' | 'recall' | 'lastHit' | 'tower' | 'summoners';

export interface Pt {
  x: number;
  y: number;
}

/** Map points the preparation of a step teleports to (client side, from the loaded map). */
export interface Geo {
  fountain: Pt;
  /** Own outer mid tower. */
  ownTower: Pt;
  /** Enemy outer mid tower (tower step starts in front of it); falls back to the own tower. */
  enemyTower?: Pt;
  /** Practice dummy (sandbox). */
  dummy: Pt;
}

/** Saved progress (localStorage). */
export interface Progress {
  done: StepId[];
  skipped: StepId[];
}

export const STORAGE_KEY = 'veilgrounds.tutorial.v1';

/** Snapshot ticks the "done" check mark stays before the next step starts (1.5 s). */
export const FLASH_TICKS = 45;
/** Ticks after which a step shows its extra tip (25 s). */
export const TIP_TICKS = 25 * 30;
/** Last hits the last-hit step asks for. */
export const LAST_HITS = 5;
/** Walk distance of the move step. */
export const MOVE_DIST = 300;

/** What a step needs from the sandbox while it runs. */
interface Needs {
  /** Teleport here when the step starts. */
  place?: 'fountain' | 'ownTower' | 'enemyTower' | 'dummy';
  /** Raise to at least this level (cheat). */
  level?: number;
  /** Give this much gold once (cheat) when the player has less. */
  gold?: number;
  /** Learn every unlearned ability the player can (cast step: nothing may stand between key press and cast). */
  learnAll?: boolean;
  /** Infinite mana + no cooldowns on/off (cheat toggle, read back from Snapshot.me.sandbox). */
  noCd: boolean;
  /** Lane minions on and a wave sent now. */
  minions?: boolean;
}

/** Per step baselines and counters, taken when the step starts. */
interface Mem {
  t0: number;
  x0: number;
  y0: number;
  ranks0: number;
  cs0: number;
  items0: number;
  charges0: number;
  wards0: Set<number>;
  casts: boolean[];
  recallStarted: boolean;
  /** Player commands seen since the step started (own preparation commands excluded). */
  seen: { move: number; attackMove: number; spell: number; ward: number; buy: number };
  /** One-shot preparation marks and the tick of the last throttled send. */
  flags: Set<string>;
  last: Map<string, number>;
}

interface View {
  snap: Snapshot;
  me: PlayerHud;
  x: number;
  y: number;
}

export interface StepDef {
  id: StepId;
  /** CSS selectors (inside the game root) the tutorial rings. */
  highlight: string[];
  /** Key bindings the texts mention: placeholders {action} in tutorial.step.<id>.text. */
  keys: string[];
  /** Counted steps show "n / total". */
  total?: number;
  needs: Needs;
  /** Called with every snapshot while the step is active; true = done. */
  check(v: View, m: Mem): boolean;
  progress?(m: Mem, v: View): number;
}

const ranksSum = (me: PlayerHud): number => me.abilities.slice(0, 4).reduce((a, b) => a + b.rank, 0);
const itemCount = (me: PlayerHud): number => me.items.filter((i) => i).length;
const ownWards = (s: Snapshot): number[] => s.entities.filter((e) => e.kind === Kind.Ward && e.team === s.team).map((e) => e.id);

export const STEPS: StepDef[] = [
  {
    id: 'move',
    highlight: [],
    keys: [],
    needs: { noCd: false },
    check: (v, m) => m.seen.move > 0 && Math.hypot(v.x - m.x0, v.y - m.y0) >= MOVE_DIST,
  },
  {
    id: 'attackMove',
    highlight: [],
    keys: ['attackMove'],
    needs: { noCd: false },
    check: (_v, m) => m.seen.attackMove > 0,
  },
  {
    id: 'levelUp',
    highlight: ['.hud-center .abilities .slot.abil'],
    keys: [],
    // two skill points, so the second one is left over for the next step
    needs: { noCd: false, level: 2 },
    check: (v, m) => ranksSum(v.me) > m.ranks0,
  },
  {
    id: 'cast',
    highlight: ['.hud-center .abilities .slot.abil'],
    keys: ['q', 'w', 'e', 'r'],
    total: 4,
    needs: { noCd: true, level: 6, learnAll: true, place: 'dummy' },
    check: (v, m) => {
      for (const ev of v.snap.events) if (ev.e === 'cast' && ev.src === v.me.eid && !ev.recast && ev.slot >= 0 && ev.slot < 4) m.casts[ev.slot] = true;
      return m.casts.every(Boolean);
    },
    progress: (m) => m.casts.filter(Boolean).length,
  },
  {
    id: 'shop',
    highlight: ['.hud-bottom .inventory .gold', '.hud-bottom .inventory .items'],
    keys: ['shop'],
    needs: { noCd: false, gold: 1500, place: 'fountain' },
    check: (v, m) => itemCount(v.me) > m.items0,
  },
  {
    id: 'ward',
    highlight: ['.hud-bottom .inventory .item.trinket'],
    keys: ['trinket'],
    needs: { noCd: false, place: 'ownTower' },
    check: (v, m) => {
      const charges = v.me.trinket?.charges ?? m.charges0;
      return charges < m.charges0 || ownWards(v.snap).some((id) => !m.wards0.has(id));
    },
  },
  {
    id: 'recall',
    highlight: [],
    keys: ['recall'],
    needs: { noCd: false, place: 'ownTower' },
    check: (v, m) => {
      // started = the channel bar ran. It ran out (last bar value <= 0.2 s) = the teleport follows one tick later, done once
      // the player is in the fountain; a bar that ends earlier was interrupted and the step starts over.
      if (v.me.recallLeft > 0) {
        m.recallStarted = true;
        m.last.set('left', v.me.recallLeft);
        return false;
      }
      if (!m.recallStarted) return false;
      if ((m.last.get('left') ?? 99) > 0.2) m.recallStarted = false;
      else return v.me.inFountain;
      return false;
    },
  },
  {
    id: 'lastHit',
    highlight: ['.hud-top .cs'],
    keys: [],
    total: LAST_HITS,
    needs: { noCd: false, place: 'ownTower', minions: true },
    check: (v, m) => v.me.cs - m.cs0 >= LAST_HITS,
    progress: (m, v) => Math.max(0, Math.min(LAST_HITS, v.me.cs - m.cs0)),
  },
  {
    id: 'tower',
    highlight: ['.hud-top .towers'],
    keys: [],
    needs: { noCd: false, place: 'enemyTower', minions: true, level: 9 },
    check: (v) => v.snap.events.some((ev) => ev.e === 'death' && ev.kind === Kind.Tower && ev.team !== v.snap.team),
  },
  {
    id: 'summoners',
    highlight: ['.hud-center .abilities .slot.summ'],
    keys: ['d', 'f'],
    needs: { noCd: false },
    check: (v, m) => m.seen.spell > 0 || v.me.abilities.slice(4, 6).some((a) => a.cdLeft > 0),
  },
];

export const STEP_IDS: StepId[] = STEPS.map((s) => s.id);

// ---------------------------------------------------------------- saved progress

export function parseProgress(raw: string | null | undefined): Progress {
  const empty: Progress = { done: [], skipped: [] };
  if (!raw) return empty;
  try {
    const o = JSON.parse(raw) as Partial<Progress> | null;
    const ids = (a: unknown): StepId[] => (Array.isArray(a) ? a.filter((x): x is StepId => STEP_IDS.includes(x as StepId)) : []);
    return o && typeof o === 'object' ? { done: ids(o.done), skipped: ids(o.skipped) } : empty;
  } catch {
    return empty;
  }
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const defaultStore = (): Store | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // blocked storage (private mode, sandboxed frame) throws on access
  }
};

export function loadProgress(store: Store | null = defaultStore()): Progress {
  try {
    return parseProgress(store?.getItem(STORAGE_KEY));
  } catch {
    return { done: [], skipped: [] };
  }
}

export function saveProgress(p: Progress, store: Store | null = defaultStore()): void {
  try {
    store?.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* storage full or blocked: the tutorial simply does not remember */
  }
}

/** Has the player been through every step (done or skipped)? */
export const isComplete = (p: Progress): boolean => STEP_IDS.every((id) => p.done.includes(id) || p.skipped.includes(id));

// ---------------------------------------------------------------- engine

const placePoint = (geo: Geo, where: NonNullable<Needs['place']>): Pt => {
  if (where === 'fountain') return geo.fountain;
  if (where === 'ownTower') return { x: geo.ownTower.x - 100, y: geo.ownTower.y - 100 };
  if (where === 'enemyTower') {
    if (!geo.enemyTower) return { x: geo.ownTower.x - 100, y: geo.ownTower.y - 100 };
    // 1200 in front of the enemy tower (range 750), on the line from our tower
    const dx = geo.enemyTower.x - geo.ownTower.x;
    const dy = geo.enemyTower.y - geo.ownTower.y;
    const l = Math.hypot(dx, dy) || 1;
    return { x: geo.enemyTower.x - (dx / l) * 1200, y: geo.enemyTower.y - (dy / l) * 1200 };
  }
  // 450 in front of the dummy, on the line from the fountain
  const dx = geo.dummy.x - geo.fountain.x;
  const dy = geo.dummy.y - geo.fountain.y;
  const l = Math.hypot(dx, dy) || 1;
  return { x: geo.dummy.x - (dx / l) * 450, y: geo.dummy.y - (dy / l) * 450 };
};

export type Phase = 'active' | 'flash' | 'finished';

/** Throttle of repeated preparation sends (snapshot ticks): the sim needs a tick or two to show the result. */
const SEND_GAP = 12;

export class TutorialEngine {
  readonly steps: StepDef[];
  index = 0;
  phase: Phase = 'active';
  /** Bumped on every change the UI should redraw (step, phase, counters). */
  version = 0;
  readonly done = new Set<StepId>();
  readonly skipped = new Set<StepId>();
  onChange: (() => void) | null = null;

  private mem: Mem | null = null;
  private view: View | null = null;
  private flashUntil = 0;
  private tick = 0;
  private selfSend = false;
  private minionsOn = false;
  private minionsAt = 0;
  private lastCount = -1;

  constructor(
    private readonly send: (cmd: Command) => void,
    private readonly geo: Geo,
    progress: Progress = { done: [], skipped: [] },
    steps: StepDef[] = STEPS,
  ) {
    this.steps = steps;
    // everything done before: start over; otherwise resume at the first step not done / skipped
    const ids = steps.map((s) => s.id);
    if (!ids.every((id) => progress.done.includes(id) || progress.skipped.includes(id))) {
      for (const id of progress.done) this.done.add(id);
      for (const id of progress.skipped) this.skipped.add(id);
    }
    this.index = Math.max(0, this.nextFrom(0));
  }

  get step(): StepDef | null {
    return this.phase === 'finished' ? null : (this.steps[this.index] ?? null);
  }

  get progress(): Progress {
    return { done: this.steps.map((s) => s.id).filter((id) => this.done.has(id)), skipped: this.steps.map((s) => s.id).filter((id) => this.skipped.has(id)) };
  }

  /** Steps passed (done or skipped). */
  get passed(): number {
    return this.steps.filter((s) => this.done.has(s.id) || this.skipped.has(s.id)).length;
  }

  /** n of a counted step (0 for others). */
  get count(): number {
    const s = this.step;
    return s?.progress && this.mem && this.view ? s.progress(this.mem, this.view) : 0;
  }

  /** Seconds in the current step shown the extra tip? */
  get showTip(): boolean {
    return this.phase === 'active' && !!this.mem && this.tick - this.mem.t0 >= TIP_TICKS;
  }

  /** The step the engine would start after `from` (first one not passed); steps.length when none is left. */
  private nextFrom(from: number): number {
    for (let i = from; i < this.steps.length; i++) {
      const id = this.steps[i]!.id;
      if (!this.done.has(id) && !this.skipped.has(id)) return i;
    }
    return this.steps.length;
  }

  private changed(): void {
    this.version++;
    this.onChange?.();
  }

  /** Every command the player's input sends (wrap SimLink.send); the tutorial's own commands are ignored. */
  onCommand(cmd: Command): void {
    if (this.selfSend || !this.mem || this.phase !== 'active') return;
    const s = this.mem.seen;
    switch (cmd.t) {
      case 'move':
        s.move++;
        break;
      case 'attackMove':
        s.attackMove++;
        break;
      case 'spell':
        s.spell++;
        break;
      case 'ward':
        s.ward++;
        break;
      case 'buy':
        s.buy++;
        break;
    }
  }

  /** Every snapshot (several per frame; events must not be missed). */
  ingest(snap: Snapshot): void {
    const me = snap.me;
    this.tick = snap.tick;
    if (!me || this.phase === 'finished') return;
    const pos = snap.entities.find((e) => e.id === me.eid);
    const v: View = { snap, me, x: pos?.x ?? 0, y: pos?.y ?? 0 };
    this.view = v;
    if (this.phase === 'flash') {
      if (snap.tick >= this.flashUntil) this.advance();
      return;
    }
    const step = this.steps[this.index];
    if (!step) return this.finish();
    if (!this.mem) this.begin(step, v);
    const m = this.mem!;
    this.prepare(step, v, m);
    if (me.dead) return;
    if (step.check(v, m)) return this.complete(step);
    // counters change the card
    const c = step.progress ? step.progress(m, v) : 0;
    if (c !== this.lastCount) {
      this.lastCount = c;
      this.changed();
    }
  }

  skip(): void {
    const step = this.steps[this.index];
    if (!step || this.phase === 'finished') return;
    this.skipped.add(step.id);
    this.advance();
  }

  restart(): void {
    this.done.clear();
    this.skipped.clear();
    this.index = 0;
    this.phase = 'active';
    this.mem = null;
    this.lastCount = -1;
    this.changed();
  }

  private emit(cmd: Command): void {
    this.selfSend = true;
    try {
      this.send(cmd);
    } finally {
      this.selfSend = false;
    }
  }

  private ready(m: Mem, key: string, gap = SEND_GAP): boolean {
    const l = m.last.get(key);
    if (l !== undefined && this.tick - l < gap) return false;
    m.last.set(key, this.tick);
    return true;
  }

  private begin(step: StepDef, v: View): void {
    this.mem = {
      t0: v.snap.tick,
      x0: v.x,
      y0: v.y,
      ranks0: ranksSum(v.me),
      cs0: v.me.cs,
      items0: itemCount(v.me),
      charges0: v.me.trinket?.charges ?? 0,
      wards0: new Set(ownWards(v.snap)),
      casts: [false, false, false, false],
      recallStarted: false,
      seen: { move: 0, attackMove: 0, spell: 0, ward: 0, buy: 0 },
      flags: new Set(),
      last: new Map(),
    };
    this.lastCount = -1;
    if (step.needs.place) {
      const p = placePoint(this.geo, step.needs.place);
      this.emit({ t: 'cheat', op: 'teleport', x: p.x, y: p.y });
      // the move step's baseline is the place the step starts; teleporting steps measure from the new spot later
      this.mem.x0 = p.x;
      this.mem.y0 = p.y;
    }
    this.changed();
  }

  /** State driven preparation: sends what the snapshot shows is still missing (throttled, idempotent). */
  private prepare(step: StepDef, v: View, m: Mem): void {
    const n = step.needs;
    const me = v.me;
    if (n.level !== undefined && me.level < n.level && this.ready(m, 'level')) this.emit({ t: 'cheat', op: 'setLevel', value: n.level });
    if (n.gold !== undefined && !m.flags.has('gold') && me.gold < n.gold) {
      m.flags.add('gold');
      this.emit({ t: 'cheat', op: 'gold', value: n.gold });
    }
    if (n.learnAll) {
      for (let i = 0; i < 4; i++) {
        const a = me.abilities[i];
        if (a && a.rank === 0 && a.canLevel && this.ready(m, `learn${i}`, 6)) this.emit({ t: 'levelUp', slot: i as 0 | 1 | 2 | 3 });
      }
    }
    if (!!me.sandbox?.noCd !== n.noCd && this.ready(m, 'noCd', 15)) this.emit({ t: 'cheat', op: 'noCooldowns' });
    if (n.minions) {
      if (!this.minionsOn) {
        this.minionsOn = true;
        this.minionsAt = this.tick;
        this.emit({ t: 'cheat', op: 'toggleMinions' });
      } else if (!m.flags.has('wave') && this.tick >= this.minionsAt + 6) {
        m.flags.add('wave');
        this.emit({ t: 'cheat', op: 'spawnWave' });
      }
    }
  }

  private complete(step: StepDef): void {
    this.done.add(step.id);
    this.phase = 'flash';
    this.flashUntil = this.tick + FLASH_TICKS;
    this.changed();
  }

  private advance(): void {
    this.mem = null;
    this.phase = 'active';
    this.index = this.nextFrom(this.index + 1);
    const next = this.steps[this.index];
    if (!next) this.finish();
    // start the step right away, from the last snapshot: what the player does before the next snapshot still counts
    else if (this.view) this.begin(next, this.view);
    else this.changed();
  }

  private finish(): void {
    this.phase = 'finished';
    this.mem = null;
    this.changed();
  }
}
