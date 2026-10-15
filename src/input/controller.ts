// LoL-like mouse + keyboard control. Turns raw input into sim Commands and camera movement.
import type { SnapEntity } from '../sim/snapshot';
import type { Command } from '../sim/types';
import type { ClientState } from '../game/state';
import type { SimLink } from '../game/link';
import type { World } from '../render/world';
import { settings, updateSettings } from '../settings';
import { actionFor, type Action } from './keybinds';

const EDGE_PX = 10;
const EDGE_SPEED = 2600; // units per second at cameraSpeed 1
const HOLD_MOVE_MS = 140;

export type Panel = 'scoreboard' | 'shop' | 'debug';
export type Armed = 'attackMove' | 'teleport' | 'spawnDummy' | null;

export interface InputHost {
  world: World;
  state: ClientState;
  link: SimLink;
  togglePause(): void;
  togglePanel(p: Panel, on?: boolean): void;
  openMenu(): void;
  useItem(slot: number): void;
  onArmedChange(a: Armed): void;
  /** True while a DOM menu/overlay owns the keyboard. */
  menuOpen(): boolean;
}

export class InputController {
  mouseX = -1;
  mouseY = -1;
  hover: SnapEntity | null = null;
  showRange = false;
  private centerHeld = false;
  private rightHeld = false;
  private lastHoldMove = 0;
  private dragFrom: { x: number; y: number } | null = null;
  private armed: Armed = null;
  private inside = false;
  private readonly off: (() => void)[] = [];

  constructor(private readonly host: InputHost, private readonly el: HTMLElement) {
    const on = <K extends keyof WindowEventMap>(t: EventTarget, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions): void => {
      t.addEventListener(type, fn as EventListener, opts);
      this.off.push(() => t.removeEventListener(type, fn as EventListener, opts));
    };
    on(el, 'contextmenu', (e) => e.preventDefault());
    on(el, 'mousedown', (e) => this.mouseDown(e));
    on(window, 'mouseup', (e) => this.mouseUp(e));
    on(window, 'mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.inside = true;
    });
    on(document.documentElement, 'mouseleave', () => (this.inside = false));
    on(el, 'wheel', (e) => {
      e.preventDefault();
      host.world.rig.zoom(Math.sign(e.deltaY) * 120);
    }, { passive: false });
    on(window, 'keydown', (e) => this.keyDown(e));
    on(window, 'keyup', (e) => this.keyUp(e));
    on(window, 'blur', () => {
      this.centerHeld = this.rightHeld = this.showRange = false;
      this.host.togglePanel('scoreboard', false);
    });
  }

  dispose(): void {
    for (const f of this.off) f();
  }

  setArmed(a: Armed): void {
    this.armed = a;
    this.el.style.cursor = a ? 'crosshair' : '';
    this.host.onArmedChange(a);
  }

  private send(cmd: Command): void {
    this.host.link.send(cmd);
  }

  private cursorGround(): { x: number; y: number } | null {
    const r = this.el.getBoundingClientRect();
    return this.host.world.rig.groundAtNdc(((this.mouseX - r.left) / r.width) * 2 - 1, -((this.mouseY - r.top) / r.height) * 2 + 1);
  }

  private hoveredEnemy(): SnapEntity | null {
    const h = this.hover;
    return h && h.team !== this.host.state.myTeam ? h : null;
  }

  private mouseDown(e: MouseEvent): void {
    if (this.host.menuOpen()) return;
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
    this.refreshHover();
    const now = performance.now();
    if (e.button === 2) {
      if (this.armed) {
        this.setArmed(null);
        return;
      }
      this.rightHeld = true;
      this.rightClick(now, true);
    } else if (e.button === 1) {
      e.preventDefault();
      this.dragFrom = this.cursorGround();
    } else if (e.button === 0) {
      const g = this.cursorGround();
      if (!g) return;
      if (this.armed === 'attackMove') {
        this.send({ t: 'attackMove', x: g.x, y: g.y });
        this.host.world.fx.clickMarker(g.x, g.y, true, now);
      } else if (this.armed === 'teleport') this.send({ t: 'cheat', op: 'teleport', x: g.x, y: g.y });
      else if (this.armed === 'spawnDummy') this.send({ t: 'cheat', op: 'spawnDummy', x: g.x, y: g.y });
      if (this.armed) this.setArmed(null);
    }
  }

  private rightClick(now: number, fresh: boolean): void {
    const enemy = this.hoveredEnemy();
    if (enemy && fresh) {
      this.send({ t: 'attack', target: enemy.id });
      this.host.world.fx.clickMarker(enemy.x, enemy.y, true, now);
      this.rightHeld = false;
      return;
    }
    const g = this.cursorGround();
    if (!g) return;
    this.send({ t: 'move', x: g.x, y: g.y });
    if (fresh) this.host.world.fx.clickMarker(g.x, g.y, false, now);
    this.lastHoldMove = now;
  }

  private mouseUp(e: MouseEvent): void {
    if (e.button === 2) this.rightHeld = false;
    if (e.button === 1) this.dragFrom = null;
  }

  private keyDown(e: KeyboardEvent): void {
    if (this.host.menuOpen()) return;
    if (e.code === 'Escape') {
      if (this.armed) this.setArmed(null);
      else this.host.openMenu();
      return;
    }
    if (e.code === 'Pause') {
      e.preventDefault();
      if (!e.repeat) this.host.togglePause();
      return;
    }
    const action = actionFor(e.code);
    if (!action) return;
    e.preventDefault();
    if (action === 'pause') {
      if (!e.repeat) this.host.togglePause();
      return;
    }
    if (e.repeat && action !== 'centerCamera') return;
    if (this.host.state.paused && action !== 'scoreboard') return;
    this.act(action, e);
  }

  private act(action: Action, e: KeyboardEvent): void {
    const levelMod = settings.levelMod === 'shift' ? e.shiftKey : e.ctrlKey;
    const abilitySlot = ({ q: 0, w: 1, e: 2, r: 3 } as Partial<Record<Action, 0 | 1 | 2 | 3>>)[action];
    if (abilitySlot !== undefined) {
      if (levelMod) this.send({ t: 'levelUp', slot: abilitySlot });
      else this.cast('cast', abilitySlot, e.altKey);
      return;
    }
    switch (action) {
      case 'd':
        return this.cast('spell', 0, e.altKey);
      case 'f':
        return this.cast('spell', 1, e.altKey);
      case 'stop':
        this.send({ t: 'stop' });
        return;
      case 'attackMove':
        if (settings.attackMoveOnCursor) {
          const g = this.cursorGround();
          if (g) {
            this.send({ t: 'attackMove', x: g.x, y: g.y });
            this.host.world.fx.clickMarker(g.x, g.y, true, performance.now());
          }
        } else this.setArmed('attackMove');
        return;
      case 'recall':
        this.send({ t: 'recall' });
        return;
      case 'centerCamera': {
        this.centerHeld = true;
        const me = this.host.state.me();
        if (me) this.host.world.rig.focus(me.x, me.y);
        return;
      }
      case 'toggleCameraLock':
        updateSettings({ cameraLocked: !settings.cameraLocked });
        return;
      case 'showRange':
        this.showRange = true;
        return;
      case 'item1':
      case 'item2':
      case 'item3':
      case 'item4':
      case 'item5':
      case 'item6':
        this.host.useItem(Number(action.slice(4)) - 1);
        return;
      case 'trinket':
        this.host.useItem(6);
        return;
      case 'scoreboard':
        this.host.togglePanel('scoreboard', true);
        return;
      case 'debug':
        this.host.togglePanel('debug');
        return;
      case 'shop':
        this.host.togglePanel('shop');
        return;
    }
  }

  /** Quick cast at the cursor; enemy under cursor becomes the target; Alt = self-cast. */
  private cast(t: 'cast' | 'spell', slot: number, self: boolean): void {
    const st = this.host.state;
    const me = st.me();
    if (self && me) {
      this.send(t === 'cast' ? { t, slot: slot as 0 | 1 | 2 | 3, x: me.x, y: me.y, target: me.id } : { t, slot: slot as 0 | 1, x: me.x, y: me.y, target: me.id });
      return;
    }
    const g = this.cursorGround();
    if (!g) return;
    const enemy = this.hoveredEnemy();
    const target = enemy?.id;
    if (t === 'cast') this.send(target !== undefined ? { t, slot: slot as 0 | 1 | 2 | 3, x: g.x, y: g.y, target } : { t, slot: slot as 0 | 1 | 2 | 3, x: g.x, y: g.y });
    else this.send(target !== undefined ? { t, slot: slot as 0 | 1, x: g.x, y: g.y, target } : { t, slot: slot as 0 | 1, x: g.x, y: g.y });
  }

  private keyUp(e: KeyboardEvent): void {
    const action = actionFor(e.code);
    if (action === 'centerCamera') this.centerHeld = false;
    else if (action === 'showRange') this.showRange = false;
    else if (action === 'scoreboard') this.host.togglePanel('scoreboard', false);
  }

  private refreshHover(): void {
    const r = this.el.getBoundingClientRect();
    this.hover =
      this.mouseX >= 0 && !this.host.menuOpen() ? this.host.world.pick(this.host.state, this.mouseX - r.left, this.mouseY - r.top, () => true) : null;
  }

  /** Per frame: hover pick, held right-click, camera follow / edge scroll / drag. */
  update(dt: number, now: number): void {
    const { world, state } = this.host;
    const rig = world.rig;
    const r = this.el.getBoundingClientRect();
    const mx = this.mouseX - r.left;
    const my = this.mouseY - r.top;
    this.refreshHover();
    this.el.style.cursor = this.armed ? 'crosshair' : this.hoveredEnemy() ? 'pointer' : '';

    if (this.rightHeld && !state.paused && now - this.lastHoldMove > HOLD_MOVE_MS) this.rightClick(now, false);

    const me = state.me();
    if (me && (settings.cameraLocked || this.centerHeld)) {
      rig.focus(state.x(me), state.y(me));
      return;
    }
    if (this.dragFrom) {
      const g = this.cursorGround();
      if (g) rig.pan(this.dragFrom.x - g.x, this.dragFrom.y - g.y);
      return;
    }
    if (settings.edgeScroll && this.inside && document.hasFocus() && !this.host.menuOpen()) {
      const sp = EDGE_SPEED * settings.cameraSpeed * dt;
      let dx = 0;
      let dy = 0;
      if (mx <= EDGE_PX) dx = -1;
      else if (mx >= r.width - EDGE_PX) dx = 1;
      if (my <= EDGE_PX) dy = 1;
      else if (my >= r.height - EDGE_PX) dy = -1;
      if (dx || dy) rig.pan(dx * sp, dy * sp);
    }
  }
}
