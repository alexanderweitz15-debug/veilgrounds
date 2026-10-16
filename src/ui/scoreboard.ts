// Scoreboard (Tab): objective bar of both teams (towers, inhibitors with respawn, Leviathan stacks / soul, Kesselbrut,
// Schleierwaechter buff), then both teams with portrait (grey + respawn seconds while dead), summoner spells (own:
// cooldown; enemies: click starts a manual timer like LoL), level, K/D/A, CS, gold for the own team / item value for
// enemies (fog-safe), items. Objective values come from src/game/objectives.ts (client-derived, sim fields first).
import './gamePanels.css';
import type { ClientState } from '../game/state';
import type { ScoreRow, Snapshot } from '../sim/snapshot';
import type { PlayerSetup } from '../sim/types';
import type { TeamObjectives } from '../game/objectives';
import { SummonerTimers } from '../game/summonerTimers';
import { LEVIATHAN_MAX_STACKS } from '../sim/systems/jungle';
import { champName, summonerName } from './names';
import { itemAbbr } from './shop';
import { t } from '../i18n';
import { resolvePlaystyle } from '../ai/params';
import { scaleTitle } from './playstyleView';
import { PLAYSTYLE_AXES } from '../ai/contract';
import { setPortrait } from '../render/portraits';
import { itemIcon, kesselbrutIcon, objectiveIcon, setIcon, summonerIcon } from './icons';
import { setTip } from './tooltip';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

export const RANK_KEYS = ['iron', 'bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond', 'master', 'grandmaster', 'challenger'] as const;

/** Display name of a player slot: bot name + rank, or "You". */
export function playerLabel(p: PlayerSetup | undefined): string {
  if (!p) return '';
  if (p.isHuman) return t('score.you');
  return p.bot?.name ? `${p.bot.name} (${t(`rank.${p.bot.rank}`)})` : `Bot (${t(`rank.${p.bot?.rank ?? 'gold'}`)})`;
}

/** m:ss for timers. */
export function mmss(s: number): string {
  const v = Math.max(0, Math.ceil(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
}

interface SumView {
  root: HTMLElement;
  cd: HTMLElement;
  num: HTMLElement;
  id: string;
}

interface RowView {
  tr: HTMLTableRowElement;
  pic: HTMLElement;
  respawn: HTMLElement;
  sums: SumView[];
  level: HTMLElement;
  kda: HTMLElement;
  cs: HTMLElement;
  gold: HTMLElement;
  items: HTMLElement;
  itemKey: string;
}

interface ObjView {
  root: HTMLElement;
  key: string;
}

/** Optional per-row summoner cooldowns from the sim (own team; proposal in docs/agents/shared-changes.md). */
type RowExt = ScoreRow & { summonerCds?: { left: number; total: number }[] };

/** Playstyle of a bot slot as tooltip text (spec-bots §2; same pure roll as the worker, src/ai/params.ts). */
function styleTitle(setup: PlayerSetup | undefined): string {
  if (!setup?.bot || setup.isHuman) return '';
  const ps = resolvePlaystyle(setup).playstyle;
  return [t('score.style'), ...PLAYSTYLE_AXES.map((a) => scaleTitle(a, ps[a]))].join('\n');
}

export class Scoreboard {
  /** Table structure (slots + champions); rows are built once and only their cells are updated. */
  private structKey = '';
  private readonly rows = new Map<number, RowView>();
  private readonly obj: ObjView[] = [];
  private readonly timers = new SummonerTimers();
  private time = 0;

  constructor(private readonly root: HTMLElement, private readonly players: readonly PlayerSetup[]) {
    root.textContent = '';
  }

  update(state: ClientState): void {
    const snap = state.snap;
    if (!snap || !this.root.classList.contains('open')) return;
    this.time = snap.time;
    const rows = snap.players ?? [];
    const struct = `${snap.team}|${rows.map((p) => `${p.slot}:${p.champ}`).join(',')}`;
    if (struct !== this.structKey) this.build(snap, struct);
    const enemy = snap.team === 0 ? 1 : 0;
    this.drawObjectives(this.obj[0], snap.team as 0 | 1, state);
    this.drawObjectives(this.obj[1], enemy as 0 | 1, state);
    const meSlot = this.players.find((x) => x.isHuman)?.slot;
    for (const p of rows) {
      const v = this.rows.get(p.slot);
      if (!v) continue;
      const cls = `${p.dead ? 'dead' : ''}${snap.me && p.slot === meSlot ? ' me' : ''}`;
      if (v.tr.className !== cls) v.tr.className = cls;
      const left = state.objectives.respawnIn(p);
      set(v.respawn, p.dead && left !== null ? String(Math.ceil(left)) : '');
      set(v.level, String(p.level));
      set(v.kda, `${p.kills} / ${p.deaths} / ${p.assists}`);
      set(v.cs, String(p.cs));
      set(v.gold, String(p.gold ?? p.itemValue));
      this.drawSummoners(v, p, snap, p.slot === meSlot);
      const ik = (p.items ?? []).join(',');
      if (ik !== v.itemKey) {
        v.itemKey = ik;
        v.items.textContent = '';
        for (const id of p.items ?? []) {
          const icon = id ? itemIcon(id) : null;
          const s = el('span', `mini-item${id ? '' : ' empty'}`, v.items, id && !icon ? itemAbbr(id) : '');
          setIcon(s, icon);
          if (id) setTip(s, `item:${id}`);
        }
      }
    }
  }

  /** Own champion: live cooldowns from the HUD; allies: sim field when present; enemies: the manual timer. */
  private drawSummoners(v: RowView, p: ScoreRow, snap: Snapshot, isMe: boolean): void {
    const own = p.team === snap.team;
    v.sums.forEach((s, i) => {
      let cd: { left: number; total: number } | null = null;
      if (isMe && snap.me) {
        const a = snap.me.abilities[4 + i];
        if (a && a.cdLeft > 0.05) cd = { left: a.cdLeft, total: a.cdTotal };
      } else if (own) {
        const c = (p as RowExt).summonerCds?.[i];
        if (c && c.left > 0.05) cd = c;
      } else cd = this.timers.left(p.slot, i, this.time);
      const pct = cd ? String(Math.min(1, cd.left / Math.max(1, cd.total))) : '0';
      if (s.cd.style.getPropertyValue('--p') !== pct) s.cd.style.setProperty('--p', pct);
      set(s.num, cd ? (cd.left >= 60 ? mmss(cd.left) : String(Math.ceil(cd.left))) : '');
      s.root.classList.toggle('cooling', !!cd);
    });
  }

  /** One team's objective strip; rebuilt only when its visible values change. */
  private drawObjectives(v: ObjView | undefined, team: 0 | 1, state: ClientState): void {
    if (!v) return;
    const o: TeamObjectives = state.objectives.team(team);
    const other = state.objectives.team(team === 0 ? 1 : 0);
    const towers = state.towers[team];
    const key = [towers, other.inhibRespawn.map((s) => Math.ceil(s)).join('/'), o.leviathan, o.kesselbrut, Math.ceil(o.schleierLeft)].join('|');
    if (key === v.key) return;
    v.key = key;
    const r = v.root;
    r.textContent = '';
    el('span', 'sb-team-name', r, t(`team.${team}`));
    // towers and inhibitors this team destroyed (the inhibitors with their respawn timers)
    const tw = el('span', 'sb-obj-item', r);
    setIcon(el('span', 'sb-ico tower', tw), objectiveIcon('tower'));
    el('b', '', tw, String(towers));
    setTip(tw, `text:${t('score.obj.towers', { n: towers })}`);
    const ih = el('span', 'sb-obj-item', r);
    setIcon(el('span', 'sb-ico inhib', ih), objectiveIcon('inhib'));
    el('b', '', ih, String(other.inhibRespawn.length));
    for (const s of other.inhibRespawn) el('span', 'sb-timer', ih, mmss(s));
    setTip(ih, `text:${t('score.obj.inhibs', { n: other.inhibRespawn.length })}`);
    // Leviathan: one badge per stack, empty pips up to the soul; at the maximum the soul badge
    const lev = el('span', 'sb-obj-item sb-lev', r);
    if (o.soul) {
      setIcon(el('span', 'sb-ico soul', lev), objectiveIcon('soul'));
      el('b', 'soul-lbl', lev, t('score.obj.soulShort'));
    } else
      for (let i = 0; i < LEVIATHAN_MAX_STACKS; i++) {
        const b = el('span', `sb-ico lev${i < o.leviathan ? '' : ' empty'}`, lev);
        if (i < o.leviathan) setIcon(b, objectiveIcon('leviathan'));
      }
    setTip(lev, `text:${o.soul ? t('score.obj.soul') : t('score.obj.leviathan', { n: o.leviathan, max: LEVIATHAN_MAX_STACKS })}`);
    const kb = el('span', 'sb-obj-item', r);
    setIcon(el('span', 'sb-ico kessel', kb), kesselbrutIcon());
    el('b', '', kb, o.kesselbrut === null ? '?' : String(o.kesselbrut));
    setTip(kb, `text:${o.kesselbrut === null ? t('score.obj.kesselbrutUnknown') : t('score.obj.kesselbrut', { n: o.kesselbrut })}`);
    if (o.schleierLeft > 0) {
      const sw = el('span', 'sb-obj-item sb-schleier', r);
      setIcon(el('span', 'sb-ico', sw), objectiveIcon('schleier'));
      el('span', 'sb-timer', sw, mmss(o.schleierLeft));
      setTip(sw, `text:${t('score.obj.schleier', { s: mmss(o.schleierLeft) })}`);
    }
  }

  private build(snap: Snapshot, struct: string): void {
    this.structKey = struct;
    this.rows.clear();
    this.obj.length = 0;
    const r = this.root;
    r.textContent = '';
    el('div', 'ttl', r, t('hud.scoreboardTitle'));
    const bar = el('div', 'sb-objectives', r);
    this.obj.push({ root: el('div', 'sb-team ally', bar), key: '' }, { root: el('div', 'sb-team enemy', bar), key: '' });
    const rows = snap.players ?? [];
    for (const team of [snap.team, snap.team === 0 ? 1 : 0]) {
      const own = team === snap.team;
      const tab = el('table', `score-table ${own ? 'ally' : 'enemy'}`, r);
      const hr = el('tr', '', el('thead', '', tab));
      for (const h of ['score.champ', 'score.player', 'score.summoners', 'score.level', 'score.kda', 'score.cs', own ? 'score.gold' : 'score.itemValue', 'score.items'])
        el('th', '', hr, t(h));
      const body = el('tbody', '', tab);
      for (const p of rows.filter((x) => x.team === team).sort((a, b) => a.slot - b.slot)) {
        const tr = el('tr', '', body);
        const ct = el('td', 'champ', tr);
        // every row gets a portrait (built once, so the lazy portrait queue can finish)
        const picWrap = el('span', 'score-pic', ct);
        const pic = el('span', 'score-portrait', picWrap, champName(p.champ).charAt(0));
        if (p.champ) setPortrait(pic, p.champ);
        const respawn = el('span', 'score-respawn', picWrap);
        ct.append(champName(p.champ));
        const setup = this.players.find((x) => x.slot === p.slot);
        const name = el('td', 'name', tr, playerLabel(setup));
        name.title = styleTitle(setup);
        const sumCell = el('td', 'sums', tr);
        const sums = (setup?.summoners ?? []).map((id, i): SumView => {
          const root = el('span', `sb-sum${own ? '' : ' enemy'}`, sumCell);
          setIcon(root, summonerIcon(id));
          const cd = el('span', 'cd', root);
          const num = el('span', 'num', root);
          if (own) setTip(root, `summoner:${id}`);
          else {
            setTip(root, `text:${summonerName(id)} – ${t('score.sumTimerTip')}`);
            root.addEventListener('mousedown', (e) => {
              e.stopPropagation();
              e.preventDefault();
              this.timers.toggle(p.slot, i, id, this.time);
            });
          }
          return { root, cd, num, id };
        });
        const level = el('td', '', tr);
        const kda = el('td', 'kda', tr);
        const cs = el('td', '', tr);
        const gold = el('td', 'gold-cell', tr);
        const items = el('td', 'items-cell', tr);
        this.rows.set(p.slot, { tr, pic, respawn, sums, level, kda, cs, gold, items, itemKey: '-' });
      }
    }
  }
}

function set(e: HTMLElement, s: string): void {
  if (e.textContent !== s) e.textContent = s;
}
