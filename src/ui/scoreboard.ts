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
import { cooldownPingText } from '../game/pingText';
import { LEVIATHAN_MAX_STACKS } from '../sim/systems/jungle';
import { champName, summonerName } from './names';
import { itemAbbr } from './shop';
import { t } from '../i18n';
import { AXIS_LABELS, resolvePlaystyle, signed } from '../ai/params';
import { scaleTitle } from './playstyleView';
import { PLAYSTYLE_AXES } from '../ai/contract';
import { tendencyText } from './botTendency';
import { settings, updateSettings } from '../settings';
import { setPortrait } from '../render/portraits';
import { itemIcon, kesselbrutIcon, objectiveIcon, rankIcon, setIcon, summonerIcon } from './icons';
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
  vision: HTMLElement;
  damage: HTMLElement;
  gold: HTMLElement;
  items: HTMLElement;
  itemKey: string;
}

interface ObjView {
  root: HTMLElement;
  key: string;
}


/** Playstyle of a bot slot as tooltip text (spec-bots §2; same pure roll as the worker, src/ai/params.ts). */
function styleTitle(setup: PlayerSetup | undefined): string {
  if (!setup?.bot || setup.isHuman) return '';
  const ps = resolvePlaystyle(setup).playstyle;
  return [t('score.style'), ...PLAYSTYLE_AXES.map((a) => scaleTitle(a, ps[a]))].join('\n');
}

/** Bot-Info cell (FEATURE-GAP 1.7): ten compact bars (2 x 5), marker = axis value -5..+5; tooltip = axis + tendency in words. */
function botInfoCell(parent: HTMLElement, setup: PlayerSetup | undefined): void {
  if (!setup?.bot || setup.isHuman) return;
  const ps = resolvePlaystyle(setup).playstyle;
  const grid = el('span', 'sb-ps', parent);
  for (const a of PLAYSTYLE_AXES) {
    const bar = el('span', `sb-ps-bar${ps[a] === 0 ? ' zero' : ''}`, grid);
    bar.style.setProperty('--v', String((ps[a] + 5) / 10));
    el('span', 'sb-ps-mark', bar);
    setTip(bar, `text:${t('score.botInfoAxis', { axis: AXIS_LABELS[a].name[settings.lang], text: tendencyText(a, ps[a], settings.lang), v: signed(ps[a]) })}`);
  }
}

export class Scoreboard {
  /** Table structure (slots + champions); rows are built once and only their cells are updated. */
  private structKey = '';
  private readonly rows = new Map<number, RowView>();
  private readonly obj: ObjView[] = [];
  private readonly timers = new SummonerTimers();
  private time = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly players: readonly PlayerSetup[],
    /** Team chat line (enemy summoner timer started: "Wren Sprung 12:34", like LoL). */
    private readonly say: (text: string) => void = () => {},
    /** Alt+click on an enemy summoner spell: "Blitz nicht bereit (2:10)" as a labelled ping (src/game/pingText.ts). */
    private readonly ctxPing: (label: string) => void = () => {},
  ) {
    root.textContent = '';
  }

  update(state: ClientState): void {
    const snap = state.snap;
    if (!snap || !this.root.classList.contains('open')) return;
    this.time = snap.time;
    const rows = snap.players ?? [];
    const struct = `${snap.team}|${settings.scoreBotInfo ? 1 : 0}|${rows.map((p) => `${p.slot}:${p.champ}`).join(',')}`;
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
      set(v.vision, p.visionScore !== undefined ? String(Math.round(p.visionScore)) : '–');
      set(v.damage, p.champDamage !== undefined ? String(p.champDamage) : '–');
      set(v.gold, String(p.gold ?? p.itemValue));
      this.drawSummoners(v, p, snap, p.slot === meSlot);
      // enemies: items as last seen (B); older than a few seconds -> dimmed with the age in the tooltip
      const seenAgo = p.itemsSeen !== undefined ? Math.max(0, (snap.tick - p.itemsSeen) / 30) : 0;
      v.items.classList.toggle('stale', seenAgo > 3);
      v.items.title = seenAgo > 3 ? t('score.itemsSeen', { s: mmss(seenAgo) }) : '';
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
      // third slot: Teleport unlocked for the top laner (B4) - own champion from the HUD, allies from summonerCds
      if (i === 2) {
        const has = isMe && snap.me ? !!snap.me.abilities[6] : (p.summonerCds?.length ?? 0) > 2;
        s.root.classList.toggle('hidden', !has);
        if (!has) return;
      }
      let cd: { left: number; total: number } | null = null;
      if (isMe && snap.me) {
        const a = snap.me.abilities[4 + i];
        if (a && a.cdLeft > 0.05) cd = { left: a.cdLeft, total: a.cdTotal };
      } else if (own) {
        const c = p.summonerCds?.[i];
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
    el('b', '', kb, String(o.kesselbrut));
    setTip(kb, `text:${t('score.obj.kesselbrut', { n: o.kesselbrut })}`);
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
    const ttl = el('div', 'ttl', r, t('hud.scoreboardTitle'));
    // Bot-Info column toggle (off by default so the table stays compact)
    const toggle = el('button', `sb-botinfo-toggle${settings.scoreBotInfo ? ' on' : ''}`, ttl, t('score.botInfo'));
    toggle.type = 'button';
    setTip(toggle, `text:${t('score.botInfoToggleTip')}`);
    toggle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      updateSettings({ scoreBotInfo: !settings.scoreBotInfo });
    });
    const bar = el('div', 'sb-objectives', r);
    this.obj.push({ root: el('div', 'sb-team ally', bar), key: '' }, { root: el('div', 'sb-team enemy', bar), key: '' });
    const rows = snap.players ?? [];
    for (const team of [snap.team, snap.team === 0 ? 1 : 0]) {
      const own = team === snap.team;
      const tab = el('table', `score-table ${own ? 'ally' : 'enemy'}`, r);
      const hr = el('tr', '', el('thead', '', tab));
      for (const h of ['score.champ', 'score.player', ...(settings.scoreBotInfo ? ['score.botInfo'] : []), 'score.summoners', 'score.level', 'score.kda', 'score.cs', 'score.vision', 'score.damage', own ? 'score.gold' : 'score.itemValue', 'score.items'])
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
        const name = el('td', 'name', tr);
        // bots: rank badge in front of the name (procedural, icons.ts rankIcon)
        if (setup?.bot && !setup.isHuman) {
          const badge = el('span', 'sb-rank', name);
          setIcon(badge, rankIcon(setup.bot.rank));
          badge.title = t('score.rankTip', { rank: t(`rank.${setup.bot.rank}`) }); // native title: overrides the cell's style title
        }
        name.append(playerLabel(setup));
        name.title = styleTitle(setup);
        if (settings.scoreBotInfo) botInfoCell(el('td', 'botinfo', tr), setup);
        const sumCell = el('td', 'sums', tr);
        // own team: a hidden third slot for Teleport (top laner after 1500 minion gold, B4)
        const spells = [...(setup?.summoners ?? []), ...(own && !setup?.summoners.includes('teleport') ? ['teleport'] : [])];
        const sums = spells.map((id, i): SumView => {
          const root = el('span', `sb-sum${own ? '' : ' enemy'}${i === 2 ? ' hidden' : ''}`, sumCell);
          setIcon(root, summonerIcon(id));
          const cd = el('span', 'cd', root);
          const num = el('span', 'num', root);
          if (own) setTip(root, `summoner:${id}`);
          else {
            setTip(root, `text:${summonerName(id)} – ${t('score.sumTimerTip')}`);
            root.addEventListener('mousedown', (e) => {
              e.stopPropagation();
              e.preventDefault();
              if (e.altKey) return this.ctxPing(cooldownPingText(summonerName(id), this.timers.left(p.slot, i, this.time)?.left ?? null));
              if (this.timers.toggle(p.slot, i, id, this.time)) {
                const left = this.timers.left(p.slot, i, this.time);
                if (left) this.say(t('chat.sumTimer', { champ: champName(p.champ), spell: summonerName(id), at: mmss(this.time + left.left) }));
              }
            });
          }
          return { root, cd, num, id };
        });
        const level = el('td', '', tr);
        const kda = el('td', 'kda', tr);
        const cs = el('td', '', tr);
        const vision = el('td', '', tr);
        const damage = el('td', '', tr);
        const gold = el('td', 'gold-cell', tr);
        const items = el('td', 'items-cell', tr);
        this.rows.set(p.slot, { tr, pic, respawn, sums, level, kda, cs, vision, damage, gold, items, itemKey: '-' });
      }
    }
  }
}

function set(e: HTMLElement, s: string): void {
  if (e.textContent !== s) e.textContent = s;
}
