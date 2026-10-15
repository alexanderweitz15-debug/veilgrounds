// LoL-like announcer: queued centre banners + a procedural (voice-less) cue. Minion spawn countdown, first blood,
// multi-kills (10 s window like LoL, 30 s for the fifth), ace, kills, towers/inhibitors, epic monsters, victory.
// Client-side only: everything is derived from fog-filtered snapshot events.
import type { ClientState } from '../game/state';
import { Kind, type SimEvent } from '../sim/types';
import { FIRST_WAVE_TICK } from '../sim/systems/waves';
import { playAnnounce, type AnnounceTone } from '../audio/sfx';
import { t } from '../i18n';
import { champName } from './names';
import raw from '../data/map.json';

interface Item {
  title: string;
  sub: string;
  tone: AnnounceTone;
  /** 0 = routine (dropped when the queue backs up), 1 = important, 2 = epic/victory. */
  prio: number;
}

const SHOW_MS = 2600;
const MULTI_S = 10;
const PENTA_S = 30;
const MULTI_KEYS = ['', '', 'ann.double', 'ann.triple', 'ann.quadra', 'ann.penta'];
/** Modes with the regular minion schedule (first wave at FIRST_WAVE_TICK). */
const WAVE_MODES = new Set(['classic', 'laneOnly']);
const OBJ = raw.neutral.objectives;

export class Announcer {
  readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly queue: Item[] = [];
  private showUntil = 0;
  private warned = false;
  private spawned = false;
  private firstBlood = false;
  private readonly streak = new Map<number, { n: number; at: number }>();
  private readonly aced = [false, false];

  constructor(parent: HTMLElement, private readonly mode?: string) {
    this.root = document.createElement('div');
    this.root.className = 'announce';
    this.title = document.createElement('div');
    this.title.className = 'ann-title';
    this.sub = document.createElement('div');
    this.sub.className = 'ann-sub';
    this.root.append(this.title, this.sub);
    parent.appendChild(this.root);
  }

  private push(title: string, tone: AnnounceTone, prio: number, sub = ''): void {
    // routine kill callouts are dropped when more important news is waiting
    if (prio === 0 && this.queue.length >= 2) return;
    this.queue.push({ title, sub, tone, prio });
    this.queue.sort((a, b) => b.prio - a.prio);
  }

  onEvent(ev: SimEvent, state: ClientState): void {
    const snap = state.snap;
    if (!snap) return;
    const mine = state.myTeam;
    if (ev.e === 'wave') {
      if (!this.spawned) {
        this.spawned = true;
        this.warned = true;
        this.push(t('ann.minions'), 'neutral', 1);
      }
      return;
    }
    if (ev.e === 'gameOver') {
      this.queue.length = 0;
      this.push(t(ev.winner === mine ? 'ann.victory' : 'ann.defeat'), ev.winner === mine ? 'victory' : 'defeat', 2);
      return;
    }
    if (ev.e !== 'death') return;
    if (ev.kind === Kind.Tower || ev.kind === Kind.Inhibitor) {
      const own = ev.team === mine;
      const key = ev.kind === Kind.Tower ? (own ? 'ann.towerOwn' : 'ann.towerEnemy') : own ? 'ann.inhibOwn' : 'ann.inhibEnemy';
      this.push(t(key), own ? 'bad' : 'good', 1);
      return;
    }
    if (ev.kind === Kind.Monster) {
      const which = this.epic(ev, state);
      if (!which) return;
      const killer = state.known.get(ev.killer);
      const ours = killer ? killer.team === mine : false;
      this.push(t(`ann.${which}${ours ? 'Own' : 'Enemy'}`), ours ? 'epic' : 'bad', 2);
      return;
    }
    if (ev.kind !== Kind.Champion || ev.team > 1) return;
    const victim = state.known.get(ev.eid);
    const killer = state.known.get(ev.killer);
    const vName = champName(victim?.champ ?? null);
    const byChamp = killer?.kind === Kind.Champion && killer.team !== ev.team;
    const kName = byChamp ? champName(killer.champ) : '';
    const sub = byChamp ? t('kill.slain', { a: kName, b: vName }) : t('kill.executed', { b: vName });
    const meId = snap.me?.eid ?? -1;
    const allyDied = ev.team === mine;
    let done = false;
    // first champion kill by a champion (a tower execution before it does not use up first blood)
    if (!this.firstBlood && byChamp) {
      this.firstBlood = true;
      this.push(t('ann.firstBlood'), allyDied ? 'bad' : 'good', 1, sub);
      done = true;
    }
    if (byChamp) {
      const now = snap.time;
      const s = this.streak.get(ev.killer);
      const n = s && now - s.at <= (s.n === 4 ? PENTA_S : MULTI_S) && s.n < 5 ? s.n + 1 : 1;
      this.streak.set(ev.killer, { n, at: now });
      if (n >= 2 && !done) {
        this.push(t(MULTI_KEYS[n]!), allyDied ? 'bad' : 'epic', 1, kName);
        done = true;
      }
    }
    if (!done) {
      if (ev.eid === meId) this.push(t('ann.youDied'), 'bad', 1, sub);
      else if (ev.killer === meId) this.push(t('ann.youSlain'), 'good', 1, sub);
      else this.push(t(allyDied ? 'ann.allySlain' : 'ann.enemySlain'), allyDied ? 'bad' : 'good', 0, sub);
    }
    // ace: the whole (real) team is dead at once
    const rows = snap.players.filter((r) => r.team === ev.team);
    if (rows.length >= 3 && rows.every((r) => r.dead) && !this.aced[ev.team]) {
      this.aced[ev.team] = true;
      this.push(t('ann.ace'), allyDied ? 'bad' : 'epic', 2);
    }
  }

  /** Leviathan / Schleierwächter by last seen radius, else by the death position (epic deaths are always sent). */
  private epic(ev: Extract<SimEvent, { e: 'death' }>, state: ClientState): 'leviathan' | 'schleier' | null {
    const r = state.known.get(ev.eid)?.radius;
    const near = (p: { x: number; y: number }): boolean => (ev.x - p.x) ** 2 + (ev.y - p.y) ** 2 < 1200 * 1200;
    if (r !== undefined && r < 130) return null;
    if (r !== undefined) return r >= 150 ? 'schleier' : 'leviathan';
    return near(OBJ.leviathan) ? 'leviathan' : near(OBJ.schleierwaechter) ? 'schleier' : null;
  }

  update(state: ClientState, now: number): void {
    const snap = state.snap;
    if (snap) {
      const warnAt = FIRST_WAVE_TICK / 30 - 30;
      if (!this.warned && WAVE_MODES.has(this.mode ?? '') && snap.time >= warnAt && snap.time < warnAt + 10) {
        this.warned = true;
        this.push(t('ann.minions30'), 'neutral', 1);
      }
      for (const team of [0, 1]) if (this.aced[team] && snap.players.some((r) => r.team === team && !r.dead)) this.aced[team] = false;
    }
    if (now < this.showUntil) return;
    const next = this.queue.shift();
    if (!next) {
      this.root.classList.remove('open');
      return;
    }
    this.title.textContent = next.title;
    this.sub.textContent = next.sub;
    // restart the entry animation
    this.root.className = 'announce';
    void this.root.offsetWidth;
    this.root.className = `announce open ${next.tone}`;
    this.showUntil = now + SHOW_MS;
    playAnnounce(next.tone);
  }
}
