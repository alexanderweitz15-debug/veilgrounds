// One running match on the client: sim link, render world, input, HUD, minimap and the frame loop.
import { ChatBox } from '../ui/chat';
import { soundForEvent, soundForFire } from '../audio/eventSounds';
import { audioUnlock, setListener, setVolume } from '../audio/sfx';
import { blockBrowserShortcuts, enterGameFullscreen, exitGameFullscreen } from './fullscreen';
import { loadMap } from '../sim/map';
import type { SimConfig } from '../sim/types';
import { ClientState } from './state';
import { mockLink } from './mock';
import { workerLink, type SimLink } from './link';
import { World } from '../render/world';
import { InputController, type Armed, type Panel } from '../input/controller';
import { Hud } from '../ui/hud';
import { Overlay } from '../ui/overlay';
import { Minimap } from '../ui/minimap';
import { minimapPingFor } from './minimapPing';
import { buildSettingsPanel } from '../ui/settingsPanel';
import { onSettingsChange, settings } from '../settings';
import { t } from '../i18n';
import { getChampionAtlas, getMinionAtlas, getMonsterAtlases } from '../render/sheets';
import { SessionExtras, type ExitOpts, type SessionResult } from './session';
import { withClientSettings } from './modes';

export class Game {
  private readonly root: HTMLElement;
  private readonly state = new ClientState();
  private readonly link: SimLink;
  private readonly world: World;
  private readonly input: InputController;
  private readonly hud: Hud;
  private readonly overlay = new Overlay();
  private readonly minimap: Minimap;
  private readonly menu: HTMLElement;
  private readonly extras: SessionExtras;
  private readonly chat: ChatBox;
  private raf = 0;
  private lastFrame = performance.now();
  private focusedOnce = false;
  private frames = 0;
  private fpsAt = performance.now();
  private fps = 0;
  private snapsThisSec = 0;
  private snapRate = 0;
  /** EMA of the CPU time per frame part (ms), shown in the F9 panel. */
  private readonly perf = { input: 0, world: 0, overlay: 0, minimap: 0, hud: 0, total: 0 };
  private readonly offSettings: () => void;
  private readonly onResize = (): void => this.resize();
  private readonly beforeUnload = (e: BeforeUnloadEvent): void => {
    // Ctrl+W (level W) cannot be intercepted by pages; at least ask before the tab closes.
    e.preventDefault();
    e.returnValue = '';
  };
  private readonly armUnload = (): void => {
    window.removeEventListener('pointerdown', this.armUnload, true);
    window.removeEventListener('keydown', this.armUnload, true);
    window.addEventListener('beforeunload', this.beforeUnload);
  };
  /** Sprite atlases baked; until then the sim stays paused (see constructor). */
  private atlasReady = false;
  /** Dark screen behind the loading banner until the sprites are baked and the first snapshot arrived (before that the
   * world has no vision yet and would show one violet fog wash). */
  private cover: HTMLElement | null;

  constructor(parent: HTMLElement, config: SimConfig | null, private readonly onExit: (r?: SessionResult) => void) {
    if (config) config = withClientSettings(config, settings); // e.g. bot toxicity for trainer/duel bots too
    const map = loadMap();
    this.root = document.createElement('div');
    this.root.className = 'game';
    parent.appendChild(this.root);
    const canvas = document.createElement('canvas');
    canvas.className = 'gl';
    this.root.appendChild(canvas);
    this.root.appendChild(this.overlay.canvas);

    this.world = new World(canvas, map);
    const f = map.sides[0].fountain;
    this.world.rig.focus(f.x + 600, f.y + 600);
    // bake the animated champion sprites (worker pool); champions show the placeholder sprite until it is done
    this.cover = document.createElement('div');
    this.cover.className = 'boot-cover';
    this.root.appendChild(this.cover);
    const loading = document.createElement('div');
    // centred on the dark cover; the sim stays paused until the atlases are ready (loading must not eat game time)
    loading.className = 'sprite-loading';
    loading.textContent = t('hud.loadingChamps', { p: 0 });
    this.cover.appendChild(loading);
    void getChampionAtlas(config?.players.map((p) => p.champion) ?? ['mira'], (done, total) => {
      loading.textContent = t('hud.loadingChamps', { p: Math.round((done / total) * 100) });
    })
      .then((atlas) => this.world.setChampionAtlas(atlas))
      .catch((e) => console.warn('champion atlas failed, keeping placeholder sprites', e))
      .then(() => {
        // champions ready: start the clock (minions only appear at 1:05, they keep baking in the background)
        loading.remove();
        this.atlasReady = true;
        this.link.pause(this.state.paused);
      })
      // minions after the champions (one worker pool at a time); usually already baked on the loading screen.
      // G/A4: wait 2.5 s after the clock started so the bakes do not compete with the first snapshots (the first
      // minute showed snapshot jitter up to 71 ms = frozen frames; minions only appear at 1:05 anyway)
      .then(() => new Promise<void>((r) => window.setTimeout(r, 2500)))
      .then(() => getMinionAtlas())
      .then((atlas) => this.world.setMinionAtlas(atlas))
      .catch((e) => console.warn('minion atlas failed, keeping placeholder sprites', e))
      // jungle monsters + plants appear at 1:30: baked last, in the background
      .then(() => getMonsterAtlases())
      .then((atlases) => this.world.setMonsterAtlases(atlases))
      .catch((e) => console.warn('monster atlases failed, keeping placeholder sprites', e));
    this.link = config ? workerLink(config, 0) : mockLink();
    this.link.pause(true); // sim builds in the worker meanwhile but does not tick until the sprites are baked
    this.link.onBotDebug = (rows, tick) => this.hud.botDebug.update(rows, tick);
    this.link.onError = (msg) => this.showSimError(msg);
    this.link.onGhost = (m) => this.extras.setGhost(m); // Challenger-Geist timeline for the post-game screen
    this.link.onSnap = (s) => {
      const now = performance.now();
      this.snapsThisSec++;
      this.extras.ingest(s); // Phase 5: post-game stats
      for (const ev of this.state.ingest(s, now)) {
        this.world.onEvent(ev, this.state, now);
        this.overlay.onEvent(ev, this.state, now);
        this.hud.onEvent(ev, this.state, now);
        this.chat?.onEvent(ev);
        soundForEvent(ev, this.state);
      }
      for (const e of this.state.fired) soundForFire(e);
    };

    this.hud = new Hud(
      {
        levelUp: (slot) => this.link.send({ t: 'levelUp', slot }),
        cheat: (op) => this.link.send({ t: 'cheat', op: op as 'refreshCd' }),
        arm: (a) => this.input.setArmed(a),
        quit: () => this.exit(),
        buy: (item) => this.link.send({ t: 'buy', item }),
        sell: (slot) => this.link.send({ t: 'sell', slot }),
        undo: () => this.link.send({ t: 'undo' }),
        swapTrinket: (id) => this.link.send({ t: 'trinket', id }),
        say: (text) => this.chat.say(text),
        ultChoice: (choice) => this.link.send({ t: 'ultChoice', choice }),
        focusCamera: (where) => this.focusDeadCamera(where),
      },
      config?.mode === 'kite' || !config, // sandbox: one merged panel (src/ui/sandboxPanel.ts)
      config?.players ?? [],
      config?.mode,
    );
    this.root.appendChild(this.hud.root);
    // Phase 5: trainer panel/result, sandbox+ panel, stats recorder (src/game/session.ts)
    this.extras = new SessionExtras(this.root, config, (c) => this.link.send(c), (p) => this.setPaused(p), (o) => this.exit(o), (a) => this.input.setArmed(a));
    this.minimap = new Minimap(
      map,
      (x, y) => {
        this.world.rig.focus(x, y);
        this.input.cameraPeekUntil = performance.now() + 1200;
      },
      (x, y) => {
        this.link.send({ t: 'move', x, y });
        this.world.fx.clickMarker(x, y, false, performance.now());
      },
      (x, y) => {
        // Alt+click: snaps to a structure / objective pit under the cursor (src/game/minimapPing.ts)
        const p = minimapPingFor(x, y, this.state.snap?.entities ?? [], this.state.myTeam, [map.objectives.leviathan, map.objectives.kesselbrut]);
        this.link.send(p.target !== undefined ? { t: 'ping', kind: p.kind, x: p.x, y: p.y, target: p.target } : { t: 'ping', kind: p.kind, x: p.x, y: p.y });
      },
    );
    const mmWrap = document.createElement('div');
    mmWrap.className = 'minimap-wrap';
    mmWrap.append(this.hud.deathBar.root, this.minimap.canvas);
    this.hud.root.appendChild(mmWrap);

    this.chat = new ChatBox(
      this.root,
      config?.players ?? [],
      config?.players.find((p) => p.isHuman)?.slot ?? 0,
      (text) => this.link.send({ t: 'chat', text }),
      () => this.menu.classList.contains('open'),
      this.state.muted,
    );
    this.menu = document.createElement('div');
    this.menu.className = 'ingame-menu';
    this.root.appendChild(this.menu);

    this.input = new InputController(
      {
        world: this.world,
        state: this.state,
        link: this.link,
        togglePause: () => this.togglePause(),
        togglePanel: (p: Panel, on?: boolean) => this.hud.togglePanel(p, on),
        openMenu: () => this.openMenu(),
        useItem: (i) => this.hud.flashItem(i),
        onArmedChange: (a: Armed) => this.hud.setArmed(a),
        select: (eid) => this.hud.target.select(eid),
        // the menu, chat input and the victory/defeat screen swallow game input
        menuOpen: () => this.menu.classList.contains('open') || this.chat.typing || this.state.winner !== null,
      },
      canvas,
    );
    setVolume(settings.volume);
    this.offSettings = onSettingsChange(() => {
      this.hud.applyScale();
      this.world.applyQuality();
      setVolume(settings.volume);
    });
    window.addEventListener('resize', this.onResize);
    // beforeunload only after a user gesture (Chrome blocks/logs the prompt for frames without one)
    window.addEventListener('pointerdown', this.armUnload, true);
    window.addEventListener('keydown', this.armUnload, true);
    window.addEventListener('keydown', blockBrowserShortcuts, true);
    this.root.addEventListener('pointerdown', audioUnlock);
    window.addEventListener('keydown', audioUnlock);
    // Fullscreen + Keyboard Lock (Ctrl+W levels up instead of closing the tab). Retry on first click if the
    // start was not a user gesture (e.g. ?play= URL).
    // Fullscreen + keyboard lock only from a click inside the RUNNING game (first snapshot received). Entering it
    // from the loading-screen click while the game was still starting froze the client for some players.
    const tryFullscreen = (): void => {
      if (!settings.fullscreenLock) return;
      if (!this.state.snap) {
        return;
      }
      if (!document.fullscreenElement) void enterGameFullscreen();
    };
    // every click in the running game re-enters fullscreen after the player left it (hold Esc); setting turns it off
    this.root.addEventListener('pointerdown', tryFullscreen);
    this.resize();
    this.raf = requestAnimationFrame(this.loop);
    // benchmark hook (dev or ?bench): step frames synchronously (works in hidden tabs where rAF is paused)
    if (import.meta.env.DEV || location.search.includes('bench')) (window as unknown as { __vg?: unknown }).__vg = { frame: (now: number) => this.frame(now), world: this.world, perf: this.perf, state: this.state, link: this.link, hud: this.hud };
  }

  /** The worker died (e.g. out of memory): say so instead of a silently frozen game. */
  private showSimError(msg: string): void {
    if (this.root.querySelector('.sim-error')) return;
    const box = document.createElement('div');
    box.className = 'sim-error';
    box.setAttribute('role', 'alert');
    box.textContent = t('hud.simError', { msg });
    const quit = document.createElement('button');
    quit.className = 'menu-btn';
    quit.textContent = t('menu.quit');
    quit.addEventListener('click', () => this.exit());
    box.appendChild(quit);
    this.root.appendChild(box);
  }

  /** Player's F10 / Pause key: toggle, then announce (banner + chat line); the trainer-result freeze stays silent. */
  private togglePause(): void {
    const was = this.state.paused;
    this.setPaused(!was);
    if (this.state.paused !== was) this.chat.system(this.hud.announcePause(this.state.paused));
  }

  /** Dead: free camera onto the death spot (own corpse) or the own fountain. */
  private focusDeadCamera(where: 'death' | 'fountain'): void {
    const me = this.state.me();
    const f = loadMap().sides[this.state.myTeam as 0 | 1].fountain;
    if (where === 'fountain') this.world.rig.focus(f.x, f.y);
    else if (me) this.world.rig.focus(this.state.x(me), this.state.y(me));
  }

  private setPaused(p: boolean): void {
    // a finished trainer run or a decided match never resumes (F10 / Pause behind the result screen)
    if (!p && (this.extras.over || this.state.winner !== null)) return;
    this.state.paused = p;
    this.link.pause(p || !this.atlasReady);
  }

  private openMenu(): void {
    // Esc closes an open shop first (LoL behaviour), only then the menu
    if (this.hud.isPanelOpen('shop')) return this.hud.togglePanel('shop', false);
    this.menu.textContent = '';
    const box = document.createElement('div');
    box.className = 'menu-panel classic-panel settings-panel ingame-panel';
    const title = document.createElement('h2');
    title.className = 'menu-title';
    title.textContent = t('menu.settings');
    const row = document.createElement('div');
    row.className = 'row-buttons';
    const resume = document.createElement('button');
    resume.className = 'menu-btn';
    resume.textContent = t('menu.resume');
    resume.addEventListener('click', () => this.closeMenu());
    const quit = document.createElement('button');
    quit.className = 'menu-btn secondary';
    quit.textContent = t('menu.quit');
    quit.addEventListener('click', () => this.exit());
    // (key capture in the settings panel stops propagation, so Escape there does not close the menu)
    const close = (e: KeyboardEvent): void => {
      if (!this.menu.classList.contains('open')) window.removeEventListener('keydown', close);
      else if (e.code === 'Escape') {
        this.closeMenu();
        window.removeEventListener('keydown', close);
      }
    };
    window.addEventListener('keydown', close);
    row.append(quit, resume);
    box.append(title, buildSettingsPanel(() => this.openMenu()), row);
    this.menu.appendChild(box);
    this.menu.classList.add('open');
  }

  /** Close the Escape menu and drop its content: a pending key capture in the settings panel ends with it. */
  private closeMenu(): void {
    this.menu.classList.remove('open');
    this.menu.textContent = '';
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.world.resize(w, h);
    this.overlay.resize(w, h);
  }

  private readonly loop = (now: number): void => {
    this.raf = requestAnimationFrame(this.loop);
    this.frame(now);
  };

  /** One client frame (also driven synchronously by the dev benchmark hook, see constructor). */
  private frame(now: number): void {
    const t0 = performance.now();
    setListener(this.world.rig.tx, this.world.rig.ty);
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const st = this.state;
    st.beginFrame(now);
    if (this.cover && this.atlasReady && st.snap) {
      // first real frame: fade the dark cover out (removed after the transition)
      const c = this.cover;
      this.cover = null;
      c.classList.add('done');
      window.setTimeout(() => c.remove(), 400);
    }
    if (!this.focusedOnce) {
      const me = st.me();
      if (me) {
        this.world.rig.focus(me.x, me.y);
        this.focusedOnce = true;
      }
    }
    // dead: the camera is free (the lock would keep it on the corpse); Space still snaps to the death spot
    if (st.snap?.me?.dead) this.input.cameraPeekUntil = Math.max(this.input.cameraPeekUntil, now + 100);
    if (!this.minimap.dragging) this.input.update(dt, now);
    // C8: the highlighted unit is the one a click hits (hover, or the predicted attack-move target while A is armed)
    const hoverId = this.input.highlight?.id ?? -1;
    const t1 = performance.now();
    this.world.frame(st, now, hoverId, this.input.showRange || this.input.attackMoveArmed);
    const t2 = performance.now();
    this.overlay.draw(st, this.world, now, hoverId);
    const t3 = performance.now();
    this.minimap.draw(st, this.world, this.world.fog, now);
    const t4 = performance.now();
    this.hud.update(st, now);
    this.extras.frame(st.snap);
    this.root.classList.toggle('dead', !!st.snap?.me?.dead);
    const t5 = performance.now();
    // CPU time per frame part (exponential moving average, ms) for the F9 panel
    const p = this.perf;
    const k = 0.05;
    p.input += (t1 - t0 - p.input) * k;
    p.world += (t2 - t1 - p.world) * k;
    p.overlay += (t3 - t2 - p.overlay) * k;
    p.minimap += (t4 - t3 - p.minimap) * k;
    p.hud += (t5 - t4 - p.hud) * k;
    p.total += (t5 - t0 - p.total) * k;
    // stats for the F9 panel
    this.frames++;
    if (now - this.fpsAt >= 1000) {
      this.fps = this.frames;
      this.snapRate = this.snapsThisSec;
      this.frames = this.snapsThisSec = 0;
      this.fpsAt = now;
      const s = st.snap;
      const info = this.world.renderer.info.render;
      this.hud.debugText.textContent =
        `FPS ${this.fps}  snaps/s ${this.snapRate}\n` +
        `tick ${s?.tick ?? '-'}  entities ${s?.entities.length ?? 0}  projectiles ${s?.projectiles.length ?? 0}\n` +
        `draw calls ${info.calls}  triangles ${info.triangles}\n` +
        `camera ${Math.round(this.world.rig.tx)},${Math.round(this.world.rig.ty)} ${settings.cameraLocked ? 'locked' : 'free'}\n` +
        `bots: ${this.link.requestBotDebug ? 'see table' : '-'}`;
      // F9 bot overlay: poll the worker only while the panel is open
      if (this.hud.isPanelOpen('debug')) this.link.requestBotDebug?.();
    }
  }

  exit(o: ExitOpts = {}): void {
    const result = this.extras.result(o);
    this.extras.dispose();
    cancelAnimationFrame(this.raf);
    delete (window as unknown as { __vg?: unknown }).__vg;
    this.link.dispose();
    this.input.dispose();
    this.minimap.dispose();
    this.chat.dispose();
    this.offSettings();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('beforeunload', this.beforeUnload);
    window.removeEventListener('pointerdown', this.armUnload, true);
    window.removeEventListener('keydown', this.armUnload, true);
    window.removeEventListener('keydown', blockBrowserShortcuts, true);
    window.removeEventListener('keydown', audioUnlock);
    exitGameFullscreen();
    this.world.dispose();
    this.root.remove();
    this.onExit(result);
  }
}
