// One running match on the client: sim link, render world, input, HUD, minimap and the frame loop.
import { soundForEvent } from '../audio/eventSounds';
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
import { buildSettingsPanel } from '../ui/settingsPanel';
import { onSettingsChange, settings } from '../settings';
import { t } from '../i18n';

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
  private raf = 0;
  private lastFrame = performance.now();
  private focusedOnce = false;
  private frames = 0;
  private fpsAt = performance.now();
  private fps = 0;
  private snapsThisSec = 0;
  private snapRate = 0;
  private readonly offSettings: () => void;
  private readonly onResize = (): void => this.resize();
  private readonly beforeUnload = (e: BeforeUnloadEvent): void => {
    // Ctrl+W (level W) cannot be intercepted by pages; at least ask before the tab closes.
    e.preventDefault();
    e.returnValue = '';
  };

  constructor(parent: HTMLElement, config: SimConfig | null, private readonly onExit: () => void) {
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
    this.link = config ? workerLink(config, 0) : mockLink();
    this.link.onBotDebug = (rows, tick) => this.hud.botDebug.update(rows, tick);
    this.link.onSnap = (s) => {
      const now = performance.now();
      this.snapsThisSec++;
      for (const ev of this.state.ingest(s, now)) {
        this.world.onEvent(ev, this.state, now);
        this.overlay.onEvent(ev, this.state, now);
        this.hud.onEvent(ev, this.state, now);
        soundForEvent(ev, this.state);
      }
    };

    this.hud = new Hud(
      {
        levelUp: (slot) => this.link.send({ t: 'levelUp', slot }),
        cheat: (op) => this.link.send({ t: 'cheat', op: op as 'refreshCd' }),
        arm: (a) => this.input.setArmed(a),
        quit: () => this.exit(),
        buy: (item) => this.link.send({ t: 'buy', item }),
        sell: (slot) => this.link.send({ t: 'sell', slot }),
        swapTrinket: (id) => this.link.send({ t: 'trinket', id }),
      },
      config?.mode === 'sandbox' || !config,
      config?.players ?? [],
    );
    this.root.appendChild(this.hud.root);
    this.minimap = new Minimap(
      map,
      (x, y) => this.world.rig.focus(x, y),
      (x, y) => {
        this.link.send({ t: 'move', x, y });
        this.world.fx.clickMarker(x, y, false, performance.now());
      },
      (x, y) => this.link.send({ t: 'ping', kind: 'danger', x, y }),
    );
    const mmWrap = document.createElement('div');
    mmWrap.className = 'minimap-wrap';
    mmWrap.appendChild(this.minimap.canvas);
    this.hud.root.appendChild(mmWrap);

    this.menu = document.createElement('div');
    this.menu.className = 'ingame-menu';
    this.root.appendChild(this.menu);

    this.input = new InputController(
      {
        world: this.world,
        state: this.state,
        link: this.link,
        togglePause: () => this.setPaused(!this.state.paused),
        togglePanel: (p: Panel, on?: boolean) => this.hud.togglePanel(p, on),
        openMenu: () => this.openMenu(),
        useItem: (i) => this.hud.flashItem(i),
        onArmedChange: (a: Armed) => this.hud.setArmed(a),
        menuOpen: () => this.menu.classList.contains('open'),
      },
      canvas,
    );
    setVolume(settings.volume);
    this.offSettings = onSettingsChange(() => {
      this.hud.applyScale();
      setVolume(settings.volume);
    });
    window.addEventListener('resize', this.onResize);
    window.addEventListener('beforeunload', this.beforeUnload);
    window.addEventListener('keydown', blockBrowserShortcuts, true);
    this.root.addEventListener('pointerdown', audioUnlock);
    window.addEventListener('keydown', audioUnlock);
    // Fullscreen + Keyboard Lock (Ctrl+W levels up instead of closing the tab). Retry on first click if the
    // start was not a user gesture (e.g. ?play= URL).
    void enterGameFullscreen().then((ok) => {
      if (!ok && settings.fullscreenLock) this.root.addEventListener('pointerdown', () => void enterGameFullscreen(), { once: true });
    });
    this.resize();
    this.raf = requestAnimationFrame(this.loop);
  }

  private setPaused(p: boolean): void {
    this.state.paused = p;
    this.link.pause(p);
  }

  private openMenu(): void {
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
    resume.addEventListener('click', () => this.menu.classList.remove('open'));
    const quit = document.createElement('button');
    quit.className = 'menu-btn secondary';
    quit.textContent = t('menu.quit');
    quit.addEventListener('click', () => this.exit());
    // (key capture in the settings panel stops propagation, so Escape there does not close the menu)
    const close = (e: KeyboardEvent): void => {
      if (!this.menu.classList.contains('open')) window.removeEventListener('keydown', close);
      else if (e.code === 'Escape') {
        this.menu.classList.remove('open');
        window.removeEventListener('keydown', close);
      }
    };
    window.addEventListener('keydown', close);
    row.append(quit, resume);
    box.append(title, buildSettingsPanel(() => this.openMenu()), row);
    this.menu.appendChild(box);
    this.menu.classList.add('open');
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.world.resize(w, h);
    this.overlay.resize(w, h);
  }

  private readonly loop = (now: number): void => {
    setListener(this.world.rig.tx, this.world.rig.ty);
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const st = this.state;
    st.beginFrame(now);
    if (!this.focusedOnce) {
      const me = st.me();
      if (me) {
        this.world.rig.focus(me.x, me.y);
        this.focusedOnce = true;
      }
    }
    if (!this.minimap.dragging) this.input.update(dt, now);
    const hoverId = this.input.hover?.id ?? -1;
    this.world.frame(st, now, hoverId, this.input.showRange);
    this.overlay.draw(st, this.world, now, hoverId);
    this.minimap.draw(st, this.world, this.world.fog, now);
    this.hud.update(st, now);
    this.root.classList.toggle('dead', !!st.snap?.me?.dead);
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
  };

  exit(): void {
    cancelAnimationFrame(this.raf);
    this.link.dispose();
    this.input.dispose();
    this.minimap.dispose();
    this.offSettings();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('beforeunload', this.beforeUnload);
    window.removeEventListener('keydown', blockBrowserShortcuts, true);
    window.removeEventListener('keydown', audioUnlock);
    exitGameFullscreen();
    this.world.dispose();
    this.root.remove();
    this.onExit();
  }
}
