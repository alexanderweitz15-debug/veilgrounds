// Replay viewer bar (S2, FEATURE-GAP 6.6): play/pause, speed 0.5x-8x, timeline with kill / structure / epic markers,
// seek (click or drag; the replay worker re-simulates from its checkpoints), view switch (any of the 10 players),
// camera follow / free. Mounted into the normal game view (Game opts.mount); the game itself is read-only here.
import './replay.css';
import type { ReplayHost } from '../game/game';
import type { ReplayLink } from '../replay/replayLink';
import { momentTick, nearestMarker, SPEEDS, clockOf, tallyAt } from '../replay/timeline';
import type { ReplayMarker } from '../replay/replay';
import { champName } from './names';
import { t } from '../i18n';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
};

/** Hover text of a timeline marker. */
export function markerText(m: ReplayMarker, champOf: (slot: number) => string, myTeam: number): string {
  const team = t(m.team === myTeam ? 'rp.team.ours' : 'rp.team.theirs');
  const when = clockOf(m.tick);
  switch (m.kind) {
    case 'kill': {
      const victim = champName(m.champ ?? champOf(m.victim ?? -1));
      return `${when} ${m.killer !== undefined && m.killer >= 0 ? t('rp.marker.kill', { killer: champName(m.killerChamp ?? champOf(m.killer)), victim }) : t('rp.marker.exec', { victim })}`;
    }
    case 'tower':
      return `${when} ${t('rp.marker.tower', { team })}`;
    case 'inhib':
      return `${when} ${t('rp.marker.inhib', { team })}`;
    case 'nexus':
      return `${when} ${t('rp.marker.nexus', { team })}`;
    default:
      return `${when} ${t('rp.marker.epic', { what: t(`post.obj.${m.champ === 'schleierwaechter' ? 'schleier' : m.champ === 'leviathan' ? 'leviathan' : 'kesselbrut'}`), team })}`;
  }
}

/** The `mount` callback for Game: builds the bar and wires the link callbacks. */
export function replayMount(link: ReplayLink): (root: HTMLElement, host: ReplayHost) => void {
  const replay = link.replay;
  const markers = replay.markers ?? [];
  const players = replay.config.players;
  const champOf = (slot: number): string => players.find((p) => p.slot === slot)?.champion ?? '?';
  const myTeam = players.find((p) => p.slot === (replay.humanSlot ?? 0))?.team ?? 0;
  const total = Math.max(1, replay.ticks);

  return (root, host) => {
    root.classList.add('rp-mode');
    const bar = el('div', 'rp-bar', root);
    // keep game input (clicks on the map, hotkeys of the HUD) away from the bar
    for (const ev of ['pointerdown', 'mousedown', 'contextmenu'] as const) bar.addEventListener(ev, (e) => e.stopPropagation());

    // ---- row 1: transport
    const r1 = el('div', 'rp-row', bar);
    const play = el('button', 'rp-btn', r1);
    const time = el('span', 'rp-time', r1);
    el('span', 'rp-label', r1, t('rp.speed'));
    const speedBtns = SPEEDS.map((s) => {
      const b = el('button', 'rp-btn', r1, `${s}x`);
      b.addEventListener('click', () => {
        link.setSpeed(s);
        refresh();
      });
      return b;
    });
    const cam = el('button', 'rp-btn', r1);
    const status = el('span', 'rp-status', r1);
    const exit = el('button', 'rp-btn', r1, t('rp.exit'));
    exit.addEventListener('click', () => host.exit());

    // ---- row 2: whose eyes
    const r2 = el('div', 'rp-row', bar);
    el('span', 'rp-label', r2, t('rp.view'));
    const viewBtns = [...players]
      .sort((a, b) => a.team - b.team || a.slot - b.slot)
      .map((p) => {
        const b = el('button', `rp-btn team${p.team}${p.slot === replay.humanSlot ? ' me' : ''}`, r2, champName(p.champion));
        b.addEventListener('click', () => {
          link.view(p.slot);
          refresh();
        });
        return { b, slot: p.slot };
      });
    el('span', 'rp-hint', r2, t('rp.hint'));

    // ---- timeline
    const track = el('div', 'rp-track', bar);
    const idx = el('div', 'idx', track);
    const done = el('div', 'done', track);
    const head = el('div', 'head', track);
    for (const m of markers) {
      const b = el('button', `rp-mark ${m.kind} ${m.team === myTeam ? 'own' : 'enemy'}${m.kind === 'kill' && (m.killer === replay.humanSlot || m.victim === replay.humanSlot) ? ' mine' : ''}`, track);
      b.style.left = `${(m.tick / total) * 100}%`;
      b.title = markerText(m, champOf, myTeam);
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        jump(momentTick(replay, m.tick));
      });
    }

    let target = -1; // tick of a seek that was asked for and has not been answered yet
    let lastSeekMs = 0;
    let progress = 0;
    let ended = false;
    let resume = false;
    const nowTick = (): number => (target >= 0 ? target : (host.state.snap?.tick ?? 0));
    function jump(tick: number): void {
      target = Math.max(0, Math.min(replay.ticks, Math.round(tick)));
      ended = false;
      link.seek(target);
      refresh();
    }
    const setCam = (m: 'follow' | 'free'): void => {
      camMode = m;
      host.setCamera(m);
      refresh();
    };
    let camMode: 'follow' | 'free' = 'follow';
    cam.addEventListener('click', () => setCam(camMode === 'follow' ? 'free' : 'follow'));
    play.addEventListener('click', () => {
      if (ended) {
        resume = true; // the game refuses to unpause behind a decided match until the reset below cleared that
        jump(0);
      } else host.setPaused(!host.state.paused);
      refresh();
    });
    const at = (e: PointerEvent): number => {
      const r = track.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width))) * replay.ticks;
    };
    let drag = false;
    track.addEventListener('pointerdown', (e) => {
      drag = true;
      track.setPointerCapture(e.pointerId);
      jump(at(e));
    });
    track.addEventListener('pointermove', (e) => {
      if (drag) jump(at(e));
      else {
        const near = nearestMarker(markers, at(e), (replay.ticks / Math.max(1, track.clientWidth)) * 6);
        track.title = near ? markerText(near, champOf, myTeam) : '';
      }
    });
    track.addEventListener('pointerup', () => (drag = false));
    const onKey = (e: KeyboardEvent): void => {
      if (!root.isConnected) return window.removeEventListener('keydown', onKey);
      if (e.code === 'ArrowLeft') jump(nowTick() - 300);
      else if (e.code === 'ArrowRight') jump(nowTick() + 300);
    };
    window.addEventListener('keydown', onKey);

    // ---- link callbacks: after a seek / view change the client forgets what it derived from earlier snapshots
    link.onReset = (tick) => {
      const s = host.state;
      s.resetForSeek();
      if (resume) {
        resume = false;
        host.setPaused(false);
      }
      const ta = tallyAt(markers, tick - 1); // the snapshot of `tick` still carries the events of tick - 1
      s.kills = ta.kills;
      s.towers = ta.towers;
      s.objectives.restoreEpicKills({ ...(ta.epic.leviathan >= 0 ? { leviathan: ta.epic.leviathan } : {}), ...(ta.epic.schleier >= 0 ? { schleier: ta.epic.schleier } : {}) });
      if (target >= 0 && Math.abs(tick - target) <= 1) target = -1;
    };
    link.onSeeked = (tick, ms) => {
      lastSeekMs = ms;
      if (target >= 0 && Math.abs(tick - target) <= 1) target = -1;
    };
    link.onIndex = (p) => (progress = p);
    link.onEnd = () => {
      ended = true;
      host.setPaused(true);
      refresh();
    };

    function refresh(): void {
      const tick = nowTick();
      const paused = host.state.paused;
      play.textContent = ended ? '↺' : paused ? '▶' : '❚❚';
      play.title = t(paused ? 'rp.play' : 'rp.pause');
      time.textContent = `${clockOf(tick)} / ${clockOf(replay.ticks)}`;
      speedBtns.forEach((b, i) => b.classList.toggle('on', SPEEDS[i] === link.speed));
      cam.textContent = t(camMode === 'follow' ? 'rp.freeCam' : 'rp.followCam');
      for (const v of viewBtns) v.b.classList.toggle('on', v.slot === link.slot);
      head.style.left = `${(tick / total) * 100}%`;
      done.style.width = `${(tick / total) * 100}%`;
      idx.style.width = `${progress * 100}%`;
      status.textContent = progress < 1 ? t('rp.indexing', { p: Math.round(progress * 100) }) : `${t('rp.indexed')}${lastSeekMs ? ` (${lastSeekMs} ms)` : ''}`;
    }
    const timer = setInterval(() => {
      if (!root.isConnected) return clearInterval(timer);
      refresh();
    }, 100);
    refresh();
  };
}
