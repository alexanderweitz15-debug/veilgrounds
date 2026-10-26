// Champion voice lines as text (FEATURE-GAP 7.12): short speech bubbles above champions, driven by fog-filtered
// snapshot events (cast / attack / death) plus two own-champion snapshot observations (recall, first steps after
// standing still). Client only, no sim changes. Texts: src/data/voiceLines.json (8 lines x de/en per champion).
// Setting: settings.voiceLines. A rate limiter keeps the screen readable (bots cast and attack constantly).
import './voiceBubbles.css';
import lines from '../data/voiceLines.json';
import { deathKillerChamp, deathVictimChamp, type ClientState } from '../game/state';
import type { World } from '../render/world';
import { REL } from '../render/palette';
import { Kind, type SimEvent } from '../sim/types';
import { settings } from '../settings';

/** The 8 lines of a champion (keys of every voiceLines.json entry). */
export const VOICE_KEYS = ['pick', 'move1', 'move2', 'attack', 'ability', 'kill', 'death', 'recall'] as const;
export type VoiceKey = (typeof VOICE_KEYS)[number];

/** What happened. 'move' picks move1 / move2 in turn, 'ult' shows the ability line (R casts always speak). */
export type VoiceTrigger = 'pick' | 'move' | 'attack' | 'ability' | 'ult' | 'kill' | 'death' | 'recall';

type L10n = { de: string; en: string };
const DATA = lines as unknown as Record<string, Partial<Record<VoiceKey, L10n>>>;

/** Text of one voice line in the given language, undefined for an unknown champion. */
export function voiceLine(champ: string | null | undefined, key: VoiceKey, lang: 'de' | 'en' = settings.lang): string | undefined {
  return champ ? DATA[champ]?.[key]?.[lang] : undefined;
}

/** Rate limit knobs (ms). Routine lines (move / attack / ability) are rare; story lines (kill, death, recall) always speak. */
export const VOICE_RULES = {
  /** Minimum gap between two bubbles of the same champion: routine lines, own champion / others. */
  gapOwnMs: 6000,
  gapOtherMs: 11000,
  /** Minimum gap before a story line (pick / kill / death / recall) of the same champion. */
  gapStoryMs: 2000,
  /** Chance that a routine trigger speaks at all (0..1); ult / story triggers always do. */
  chance: { move: 0.6, attack: 0.1, ability: 0.3 } as Record<string, number>,
  /** Cooldown of one routine trigger per champion. */
  cooldownMs: { move: 20000, attack: 30000, ability: 16000 } as Record<string, number>,
  /** Bubbles of other champions: at most this many routine ones alive at once, and this far apart. */
  maxOthersLive: 3,
  othersSpacingMs: 1500,
  /** Own champion: standing still this long before a move command counts as "leaving" (move line). */
  idleMs: 2500,
} as const;

const STORY = new Set<VoiceTrigger>(['pick', 'kill', 'death', 'recall']);

export interface SpeakCtx {
  /** The speaker is the player's champion. */
  own: boolean;
  now: number;
  /** Uniform random number in [0, 1) (injected so tests are deterministic). */
  rand: number;
  /** Bubbles of other champions currently on screen. */
  othersLive: number;
}

/** Pure rate limiter: decides whether a trigger may produce a bubble and remembers when it did. */
export class VoiceLimiter {
  private readonly last = new Map<number, number>();
  private readonly lastTrigger = new Map<string, number>();
  private lastOther = -Infinity;

  allow(unit: number, trigger: VoiceTrigger, c: SpeakCtx): boolean {
    const story = STORY.has(trigger);
    const sinceUnit = c.now - (this.last.get(unit) ?? -Infinity);
    if (story) {
      if (sinceUnit < VOICE_RULES.gapStoryMs) return false;
    } else {
      const ult = trigger === 'ult';
      if (sinceUnit < (c.own ? VOICE_RULES.gapOwnMs : VOICE_RULES.gapOtherMs)) return false;
      if (!c.own && (c.othersLive >= VOICE_RULES.maxOthersLive || c.now - this.lastOther < VOICE_RULES.othersSpacingMs)) return false;
      if (!ult) {
        if (c.now - (this.lastTrigger.get(`${unit}:${trigger}`) ?? -Infinity) < (VOICE_RULES.cooldownMs[trigger] ?? 0)) return false;
        if (c.rand >= (VOICE_RULES.chance[trigger] ?? 1)) return false;
      }
    }
    this.last.set(unit, c.now);
    this.lastTrigger.set(`${unit}:${trigger}`, c.now);
    if (!c.own && !story) this.lastOther = c.now;
    return true;
  }

  reset(): void {
    this.last.clear();
    this.lastTrigger.clear();
    this.lastOther = -Infinity;
  }
}

interface Bubble {
  eid: number;
  text: string;
  team: number;
  own: boolean;
  /** Fallback position (a dying champion leaves the snapshot, an out-of-sight enemy must not be followed). */
  x: number;
  y: number;
  follow: boolean;
  t0: number;
  dur: number;
}

const FADE_MS = 350;
const RISE_PX = 10;

/** How long a bubble stays: a base plus reading time. */
export const bubbleMs = (text: string): number => 1800 + 55 * text.length;

/** Lines longer than 36 chars break at the space nearest the middle (two rows). */
export function wrapLine(text: string): string[] {
  if (text.length <= 36) return [text];
  const mid = text.length / 2;
  let cut = -1;
  for (let i = 0; i < text.length; i++) if (text[i] === ' ' && (cut < 0 || Math.abs(i - mid) < Math.abs(cut - mid))) cut = i;
  return cut < 0 ? [text] : [text.slice(0, cut), text.slice(cut + 1)];
}

export class VoiceBubbles {
  private bubbles: Bubble[] = [];
  private readonly limiter = new VoiceLimiter();
  private readonly moveFlip = new Map<number, number>();
  // own champion observations (per frame, evaluated once per snapshot tick)
  private seenTick = -1;
  private prevRecall = 0;
  private lastActive = 0;
  private greeted = false;
  private wasDead = false;

  constructor(private readonly rand: () => number = Math.random) {}

  /** Bubbles currently alive (tests / debugging). */
  get count(): number {
    return this.bubbles.length;
  }

  onEvent(ev: SimEvent, state: ClientState, now: number): void {
    if (!settings.voiceLines) return;
    const myEid = state.snap?.me?.eid ?? -1;
    switch (ev.e) {
      case 'cast': {
        if (ev.recast) return;
        const s = state.byId.get(ev.src);
        if (s?.kind === Kind.Champion && s.champ) this.say(s.id, s.champ, ev.slot === 3 ? 'ult' : 'ability', state, now, s.x, s.y, true);
        return;
      }
      case 'attack': {
        const s = state.byId.get(ev.src);
        if (s?.kind === Kind.Champion && s.champ) this.say(s.id, s.champ, 'attack', state, now, s.x, s.y, true);
        return;
      }
      case 'death': {
        if (ev.kind !== Kind.Champion) return;
        const killerChamp = deathKillerChamp(ev, state);
        const k = killerChamp && ev.killer >= 0 ? state.byId.get(ev.killer) : undefined;
        if (k && k.kind === Kind.Champion && k.champ) this.say(k.id, k.champ, 'kill', state, now, k.x, k.y, true);
        const champ = deathVictimChamp(ev, state);
        if (champ) this.say(ev.eid, champ, 'death', state, now, ev.x, ev.y, false, ev.team, ev.eid === myEid);
        return;
      }
      default:
        return;
    }
  }

  /** Own champion: recall start, first steps after standing still, a greeting at the start. Call once per frame. */
  observe(state: ClientState, now: number): void {
    const snap = state.snap;
    if (!snap || snap.tick === this.seenTick) return;
    this.seenTick = snap.tick;
    const me = state.me();
    const hud = snap.me;
    if (!settings.voiceLines || !me || !hud || !me.champ) {
      this.prevRecall = hud?.recallLeft ?? 0;
      return;
    }
    const dead = hud.dead;
    if (dead) {
      this.wasDead = true;
      this.prevRecall = 0;
      return;
    }
    if (hud.recallLeft > 0 && this.prevRecall <= 0) this.say(me.id, me.champ, 'recall', state, now, me.x, me.y, true);
    this.prevRecall = hud.recallLeft;
    if (!this.greeted && snap.tick >= 30) {
      this.greeted = true;
      this.say(me.id, me.champ, 'pick', state, now, me.x, me.y, true);
    }
    const moving = (me.x - me.px) ** 2 + (me.y - me.py) ** 2 > 0.25;
    const busy = me.atkPhase !== 0 || (me.cc ?? 0) !== 0;
    if (moving && !busy && !this.wasDead && now - this.lastActive >= VOICE_RULES.idleMs && snap.tick > 90) this.say(me.id, me.champ, 'move', state, now, me.x, me.y, true);
    if (moving || busy) this.lastActive = now;
    this.wasDead = false;
  }

  private say(eid: number, champ: string, trigger: VoiceTrigger, state: ClientState, now: number, x: number, y: number, follow: boolean, teamOverride?: number, ownOverride?: boolean): void {
    const own = ownOverride ?? eid === (state.snap?.me?.eid ?? -1);
    const ok = this.limiter.allow(eid, trigger, { own, now, rand: this.rand(), othersLive: this.bubbles.filter((b) => !b.own && b.t0 + b.dur > now).length });
    if (!ok) return;
    let key: VoiceKey;
    if (trigger === 'move') {
      const n = this.moveFlip.get(eid) ?? (this.rand() < 0.5 ? 0 : 1);
      this.moveFlip.set(eid, 1 - n);
      key = n === 0 ? 'move1' : 'move2';
    } else key = trigger === 'ult' ? 'ability' : trigger;
    const text = voiceLine(champ, key);
    if (!text) return;
    const team = teamOverride ?? state.byId.get(eid)?.team ?? state.myTeam;
    this.bubbles = this.bubbles.filter((b) => b.eid !== eid);
    this.bubbles.push({ eid, text, team, own, x, y, follow, t0: now, dur: bubbleMs(text) });
  }

  draw(ctx: CanvasRenderingContext2D, state: ClientState, world: World, w: number, h: number, now: number): void {
    this.observe(state, now);
    this.bubbles = this.bubbles.filter((b) => now - b.t0 < b.dur);
    if (!settings.voiceLines || !this.bubbles.length) return;
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const keep: Bubble[] = [];
    for (const b of this.bubbles) {
      const e = b.follow ? state.byId.get(b.eid) : undefined;
      if (b.follow && !e) continue; // left the view (enemy walked into the fog, died): the bubble must not betray the position
      let sx: number;
      let sy: number;
      if (e) {
        const a = world.barAnchor(e, state.x(e), state.y(e));
        if (!a) {
          keep.push(b);
          continue;
        }
        sx = a.sx;
        sy = a.sy - 50;
      } else {
        const p = world.rig.project(b.x, b.y, 170, w, h);
        if (p.behind) continue;
        sx = p.sx;
        sy = p.sy;
      }
      keep.push(b);
      const age = now - b.t0;
      const left = b.dur - age;
      const fadeIn = Math.min(1, age / 120);
      const alpha = Math.min(fadeIn, left < FADE_MS ? left / FADE_MS : 1);
      const rise = settings.reduceMotion ? 0 : RISE_PX * Math.min(1, age / b.dur);
      const rows = wrapLine(b.text);
      const tw = Math.max(...rows.map((r) => ctx.measureText(r).width));
      const bw = tw + 18;
      const bh = 8 + 16 * rows.length;
      const x = Math.max(bw / 2 + 4, Math.min(w - bw / 2 - 4, sx));
      const y = sy - rise;
      const border = b.own ? REL.meBar : b.team === state.myTeam ? REL.allyText : REL.enemyText;
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.beginPath();
      ctx.roundRect(x - bw / 2, y - bh, bw, bh, 7);
      ctx.moveTo(x - 5, y);
      ctx.lineTo(x, y + 6);
      ctx.lineTo(x + 5, y);
      ctx.fillStyle = settings.highContrast ? 'rgba(0,0,0,0.96)' : 'rgba(18,14,10,0.84)';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = border;
      ctx.stroke();
      ctx.fillStyle = '#f6ecd2';
      rows.forEach((r, i) => ctx.fillText(r, x, y - bh + 4 + 8 + 16 * i));
    }
    ctx.globalAlpha = 1;
    this.bubbles = keep;
  }
}

/**
 * Lobby: the pick line of the selected champion as a quote under the showcase (replaced when another champion is
 * picked, because the lobby redraws). Nothing when the setting is off.
 */
export function renderPickLine(parent: HTMLElement, champ: string): HTMLElement | null {
  const text = settings.voiceLines ? voiceLine(champ, 'pick') : undefined;
  if (!text) return null;
  const box = document.createElement('div');
  box.className = 'voice-pick';
  box.textContent = `„${text}“`;
  box.setAttribute('role', 'note');
  parent.appendChild(box);
  return box;
}
