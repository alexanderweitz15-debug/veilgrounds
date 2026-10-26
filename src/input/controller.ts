// LoL-like mouse + keyboard control. Turns raw input into sim Commands and camera movement.
import type { SnapEntity } from '../sim/snapshot';
import type { Command } from '../sim/types';
import type { ClientState } from '../game/state';
import type { SimLink } from '../game/link';
import type { World } from '../render/world';
import { settings, updateSettings } from '../settings';
import { actionFor, resolveKey, type Action, type KeyResolution } from './keybinds';
import { ABILITY_KEYS, castModeFor, castTargetFor, isAbilityKey, isCastKey, type AbilityKey, type CastKey } from './castMode';
import { PingWheel } from '../ui/pingWheel';
import type { PingSender } from '../game/pingSender';
import { missingAt, objectiveAt, type PingCtx, type PingReq } from '../game/contextPing';
import { Kind, type PingKind } from '../sim/types';
import { ATTACK_CURSOR } from '../ui/cursors';
import { attackMoveTarget } from './attackMove';

const anyUnit = (): boolean => true;
/** Champions and their decoys (Sev E clones look like champions, LoL lets champion-only targeting hit them). */
const championLike = (e: SnapEntity): boolean => e.kind === Kind.Champion || !!e.look;

const EDGE_PX = 20;
const EDGE_SPEED = 4200; // units per second at cameraSpeed 1 (LoL-like brisk pan; 2600 felt sluggish)
// held right button: re-path every 50 ms (smooth steering; 140 ms felt like 7 Hz steps)
const HOLD_MOVE_MS = 50;

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
  /** Left click on a unit (eid) or the ground (null): target frame (C3). */
  select?(eid: number | null): void;
  /** Ping door with the spam limit; without it pings go straight to the link (tests, mocks). */
  pings?: PingSender;
  /** Timers / lanes for context pings (src/game/contextPing.ts). */
  pingCtx?(): PingCtx;
  /** Map point under a screen position when it is over the minimap (ping wheel on the minimap). */
  minimapAt?(cx: number, cy: number): [number, number] | null;
}

export class InputController {
  mouseX = -1;
  mouseY = -1;
  hover: SnapEntity | null = null;
  /** Predicted attack-move target while attack-move is armed (C8). */
  private amTarget: SnapEntity | null = null;

  /** Unit the HUD highlights: the predicted attack-move target while armed, else the hovered unit. */
  get highlight(): SnapEntity | null {
    return this.armed === 'attackMove' ? this.amTarget : this.hover;
  }

  /** Attack-move armed (A pressed, waiting for the left click): the range circle is shown like LoL. */
  get attackMoveArmed(): boolean {
    return this.armed === 'attackMove';
  }
  /** Own champion was dead last frame (respawn camera snap). */
  private wasDead = false;
  showRange = false;
  /** Ability key held with "cast with indicator": aim preview until the key is released. */
  aiming: { slot: 0 | 1 | 2 | 3 | null; key: CastKey; code: string; /** Normal cast: stays until a left click casts (right click cancels). */ click?: boolean } | null = null;
  /** performance.now() until which the camera lock is suspended (minimap peek). */
  cameraPeekUntil = 0;
  private centerHeld = false;
  /** "Target champions only" key held (LoL `): picking ignores everything but champions. */
  private champsOnly = false;
  /** Last CSS cursor written to the canvas (the attack cursor is a long data URI: write on change only). */
  private cursor = '';
  private rightHeld = false;
  private lastHoldMove = 0;
  /** Enemy already ordered to attack while the right button is held (-1 = none). */
  private heldAttack = -1;
  private dragFrom: { x: number; y: number } | null = null;
  private armed: Armed = null;
  private inside = false;
  private readonly off: (() => void)[] = [];
  private readonly wheel: PingWheel;
  /** Ground point where the ping wheel was opened (pings land there, like LoL). */
  private wheelAt: { x: number; y: number } | null = null;
  private wheelOnMap = false;

  constructor(private readonly host: InputHost, private readonly el: HTMLElement) {
    const on = <K extends keyof WindowEventMap>(t: EventTarget, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions): void => {
      t.addEventListener(type, fn as EventListener, opts);
      this.off.push(() => t.removeEventListener(type, fn as EventListener, opts));
    };
    this.wheel = new PingWheel(el.parentElement ?? document.body);
    this.off.push(() => this.wheel.el.remove());
    // never show the browser context menu during a game (HUD, minimap, overlays included); capture phase so panels
    // that stop propagation (shop right-click buy) still get their own handler
    on(window, 'contextmenu', (e) => e.preventDefault(), { capture: true });
    on(el, 'mousedown', (e) => this.mouseDown(e));
    on(window, 'mouseup', (e) => this.mouseUp(e));
    on(window, 'mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.inside = true;
      if (this.wheel.isOpen) this.wheel.highlight(e.clientX, e.clientY);
    });
    on(document.documentElement, 'mouseleave', () => (this.inside = false));
    on(el, 'wheel', (e) => {
      e.preventDefault();
      host.world.rig.zoom(Math.sign(e.deltaY) * 120);
    }, { passive: false });
    on(window, 'keydown', (e) => this.keyDown(e));
    on(window, 'keyup', (e) => this.keyUp(e));
    on(window, 'blur', () => {
      // keys/buttons released while the window was in the background never send keyup/mouseup
      this.centerHeld = this.rightHeld = this.showRange = this.champsOnly = false;
      this.aiming = null;
      this.dragFrom = null; // middle-mouse camera drag
      this.wheel.hide(); // ping wheel (G held): closes without pinging
      this.wheelAt = null;
      this.host.togglePanel('scoreboard', false);
    });
  }

  dispose(): void {
    for (const f of this.off) f();
  }

  setArmed(a: Armed): void {
    this.armed = a;
    this.el.style.cursor = this.cursor = a ? 'crosshair' : '';
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
    // normal cast (C7): the shown indicator casts on left click, right click cancels it
    if (this.aiming?.click && (e.button === 0 || e.button === 2)) {
      const key = this.aiming.key;
      this.aiming = null;
      if (e.button === 0) this.fire(key, false);
      return;
    }
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
      if (e.altKey && !this.armed) {
        // Alt+click: danger on ground, focus on an enemy, objective on a big monster
        const h = this.hover;
        const obj = h?.kind === Kind.Monster || !h ? this.objectivePing(g.x, g.y) : null; // pit / camp / epic monster: with its timer
        if (obj) return void this.pingReq(obj);
        const kind: PingKind = h && h.team !== this.host.state.myTeam && h.team <= 1 ? 'focus' : 'danger';
        this.ping(kind, h && kind !== 'danger' ? h.x : g.x, h && kind !== 'danger' ? h.y : g.y, kind !== 'danger' ? h?.id : undefined);
        return;
      }
      // LoL: a plain left click selects the unit under the cursor for the target frame, ground clears it
      if (!this.armed) this.host.select?.(this.hover ? this.hover.id : null);
      if (this.armed === 'attackMove') this.attackMoveAt(g, now);
      else if (this.armed === 'teleport') this.send({ t: 'cheat', op: 'teleport', x: g.x, y: g.y });
      else if (this.armed === 'spawnDummy') this.send({ t: 'cheat', op: 'spawnDummy', x: g.x, y: g.y });
      if (this.armed) this.setArmed(null);
    }
  }

  /** G/A3: turn the own sprite toward the ordered point right away (render only; the sim facing follows). */
  private intentFace(x: number, y: number, now: number): void {
    const me = this.host.state.me();
    if (me) this.host.world.intentFace(me.id, x - this.host.state.x(me), y - this.host.state.y(me), now);
  }

  private rightClick(now: number, fresh: boolean): void {
    const enemy = this.hoveredEnemy();
    if (enemy && fresh) {
      this.send({ t: 'attack', target: enemy.id });
      this.host.world.fx.clickMarker(enemy.x, enemy.y, true, now);
      this.intentFace(enemy.x, enemy.y, now);
      this.rightHeld = false;
      return;
    }
    // LoL: sweeping the held right button over an enemy attacks it (once per target, not every repath)
    if (enemy) {
      if (this.heldAttack !== enemy.id) {
        this.heldAttack = enemy.id;
        this.send({ t: 'attack', target: enemy.id });
        this.intentFace(enemy.x, enemy.y, now);
      }
      this.lastHoldMove = now;
      return;
    }
    this.heldAttack = -1;
    const g = this.cursorGround();
    if (!g) return;
    this.send({ t: 'move', x: g.x, y: g.y });
    this.intentFace(g.x, g.y, now);
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
      if (this.aiming) this.aiming = null; // cancel the held ability indicator
      else if (this.armed) this.setArmed(null);
      else this.host.openMenu();
      return;
    }
    if (e.code === 'Pause') {
      e.preventDefault();
      if (!e.repeat) this.host.togglePause();
      return;
    }
    const hit = resolveKey(e, settings); // primary or alternate key + level-up / self-cast modifier
    if (!hit) return;
    const action = hit.action;
    e.preventDefault();
    if (action === 'targetChampionsOnly') {
      this.champsOnly = true; // held modifier, also while paused (keyUp / blur release it)
      return;
    }
    if (action === 'pause') {
      if (!e.repeat) this.host.togglePause();
      return;
    }
    if (e.repeat && action !== 'centerCamera') return;
    if (this.host.state.paused && action !== 'scoreboard') return;
    this.act(action, e, hit);
  }

  private act(action: Action, e: KeyboardEvent, hit: KeyResolution): void {
    // Level-up modifier (settings.levelUpMod, LoL Ctrl) on Q/W/E/R levels the ability instead of casting it
    if (hit.levelUp) {
      this.send({ t: 'levelUp', slot: ABILITY_KEYS.indexOf(action as AbilityKey) as 0 | 1 | 2 | 3 });
      return;
    }
    // abilities, summoner spells (the unlocked Teleport slot is ignored by the sim until it exists), items, ward:
    // self-cast modifier casts on yourself, else the per-key cast mode decides (src/input/castMode.ts)
    if (isCastKey(action)) {
      if (hit.selfCast) this.fire(action, true);
      else {
        const mode = castModeFor(settings, action);
        if (mode === 'quick') this.fire(action, false);
        else this.aiming = { slot: isAbilityKey(action) ? (ABILITY_KEYS.indexOf(action) as 0 | 1 | 2 | 3) : null, key: action, code: e.code, click: mode === 'normal' };
      }
      return;
    }
    switch (action) {
      case 'stop':
        this.send({ t: 'stop' });
        return;
      case 'attackMove':
        if (settings.attackMoveOnCursor) {
          const g = this.cursorGround();
          if (g) this.attackMoveAt(g, performance.now());
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
      case 'scoreboard':
        this.host.togglePanel('scoreboard', true);
        return;
      case 'debug':
        this.host.togglePanel('debug');
        return;
      case 'shop':
        this.host.togglePanel('shop');
        return;
      case 'pingWheel': {
        // over the minimap the wheel pings the map point under the cursor, else the ground point
        const mm = this.host.minimapAt?.(this.mouseX, this.mouseY);
        this.wheelAt = mm ? { x: mm[0], y: mm[1] } : this.cursorGround();
        this.wheelOnMap = !!mm;
        if (this.wheelAt) this.wheel.show(this.mouseX, this.mouseY);
        return;
      }
      case 'pingMissing': {
        const g = this.cursorGround();
        if (g) this.missing(g.x, g.y, this.hover);
        return;
      }
      case 'pingQuestion': {
        // '?' on the hovered unit (enemy / objective) or the ground under the cursor
        const g = this.cursorGround();
        const h = this.hover;
        if (h) this.ping('question', h.x, h.y, h.id);
        else if (g) this.ping('question', g.x, g.y);
        return;
      }
    }
  }

  /** Predicted first target of an attack-move at ground point g (src/input/attackMove.ts), or null. */
  private predictAttackMove(g: { x: number; y: number } | null): SnapEntity | null {
    const st = this.host.state;
    const me = st.me();
    const range = st.snap?.me?.stats?.range;
    if (!g || !me || !st.snap || range === undefined) return null;
    return attackMoveTarget({
      entities: st.snap.entities, myTeam: st.myTeam, me, range, gx: g.x, gy: g.y,
      nearCursor: settings.attackMoveNearCursor, hover: this.hoveredEnemy(),
    });
  }

  /**
   * A + left click (or A with "attack move on cursor"): a hostile unit under the cursor is attacked directly (LoL),
   * otherwise attack-move; the sim picks the in-range enemy nearest to the click, as predicted and highlighted.
   */
  private attackMoveAt(g: { x: number; y: number }, now: number): void {
    const enemy = this.hoveredEnemy();
    if (enemy) {
      this.send({ t: 'attack', target: enemy.id });
      this.host.world.fx.clickMarker(enemy.x, enemy.y, true, now);
      this.intentFace(enemy.x, enemy.y, now);
      return;
    }
    this.send(settings.attackMoveNearCursor ? { t: 'attackMove', x: g.x, y: g.y, cursor: true } : { t: 'attackMove', x: g.x, y: g.y });
    this.host.world.fx.clickMarker(g.x, g.y, true, now);
    this.intentFace(g.x, g.y, now);
  }

  /** Cast / use a bound key at the cursor (or on yourself): ability, summoner spell, item or the ward trinket. */
  private fire(key: CastKey, self: boolean): void {
    const tg = castTargetFor(key);
    if (tg.t === 'cast' || tg.t === 'spell') return this.cast(tg.t, tg.slot, self);
    const me = this.host.state.me();
    const g = self && me ? { x: me.x, y: me.y } : this.cursorGround();
    if (tg.t === 'item') {
      this.send(g ? { t: 'item', slot: tg.slot, x: g.x, y: g.y } : { t: 'item', slot: tg.slot });
      this.host.useItem(tg.slot);
      return;
    }
    // Schleierward: place at the cursor; Suchfeuer: sweep there (src/sim/wards.ts clamps to range)
    if (g) this.send({ t: 'ward', x: g.x, y: g.y });
    this.host.useItem(6);
  }

  /** Quick cast at the cursor; enemy under cursor becomes the target; self = cast on the own champion. */
  private cast(t: 'cast' | 'spell', slot: number, self: boolean): void {
    const st = this.host.state;
    const me = st.me();
    if (self && me) {
      this.send(t === 'cast' ? { t, slot: slot as 0 | 1 | 2 | 3, x: me.x, y: me.y, target: me.id } : { t, slot: slot as 0 | 1 | 2, x: me.x, y: me.y, target: me.id });
      return;
    }
    const g = this.cursorGround();
    if (!g) return;
    const enemy = this.hoveredEnemy();
    const target = enemy?.id;
    if (t === 'cast') this.send(target !== undefined ? { t, slot: slot as 0 | 1 | 2 | 3, x: g.x, y: g.y, target } : { t, slot: slot as 0 | 1 | 2 | 3, x: g.x, y: g.y });
    else this.send(target !== undefined ? { t, slot: slot as 0 | 1 | 2, x: g.x, y: g.y, target } : { t, slot: slot as 0 | 1 | 2, x: g.x, y: g.y });
  }

  private ping(kind: PingKind, x: number, y: number, target?: number): void {
    this.pingReq(target !== undefined ? { kind, x, y, target } : { kind, x, y });
  }

  private pingReq(req: PingReq): void {
    if (this.host.pings) this.host.pings.ping(req);
    else this.send({ t: 'ping', ...req });
  }

  /** "Achtung" on a pit or camp reads as its timer. */
  private pingAtObjective(at: { x: number; y: number }): PingReq | null {
    const c = this.host.pingCtx?.();
    return c ? objectiveAt(c, at.x, at.y, this.wheelOnMap ? null : this.hover) : null;
  }

  private objectivePing(x: number, y: number): PingReq | null {
    const c = this.host.pingCtx?.();
    return c ? objectiveAt(c, x, y, this.hover) : null;
  }

  /** "Missing": on the hovered enemy champion, else on the lane under (x, y). */
  private missing(x: number, y: number, hover: SnapEntity | null): void {
    const c = this.host.pingCtx?.();
    if (c) this.pingReq(missingAt(c, x, y, hover));
    else this.ping('missing', x, y);
  }

  private keyUp(e: KeyboardEvent): void {
    if (this.aiming && !this.aiming.click && e.code === this.aiming.code) {
      const key = this.aiming.key;
      this.aiming = null;
      if (!this.host.menuOpen()) this.fire(key, false);
      return;
    }
    const action = actionFor(e.code);
    if (action === 'pingWheel' && this.wheel.isOpen) {
      const kind = this.wheel.pick(this.mouseX, this.mouseY);
      this.wheel.hide();
      const at = this.wheelAt;
      this.wheelAt = null;
      if (!at) return;
      if (kind === 'missing') this.missing(at.x, at.y, this.wheelOnMap ? null : this.hover);
      else this.pingReq((kind === 'alert' ? this.pingAtObjective(at) : null) ?? { kind, x: at.x, y: at.y });
      return;
    }
    if (action === 'centerCamera') this.centerHeld = false;
    else if (action === 'targetChampionsOnly') this.champsOnly = false;
    else if (action === 'showRange') this.showRange = false;
    else if (action === 'scoreboard') this.host.togglePanel('scoreboard', false);
  }

  /**
   * The single pick behind hover highlight, right-click attack, left-click select, casts and pings (C8): whatever is
   * highlighted is what a click hits. "Target champions only" (held) narrows it to champions (and their decoys).
   */
  private refreshHover(): void {
    const r = this.el.getBoundingClientRect();
    this.hover =
      this.mouseX >= 0 && !this.host.menuOpen()
        ? this.host.world.pick(this.host.state, this.mouseX - r.left, this.mouseY - r.top, this.champsOnly ? championLike : anyUnit)
        : null;
  }

  /** Per frame: hover pick, held right-click, camera follow / edge scroll / drag. */
  update(dt: number, now: number): void {
    const { world, state } = this.host;
    const rig = world.rig;
    const r = this.el.getBoundingClientRect();
    const mx = this.mouseX - r.left;
    const my = this.mouseY - r.top;
    this.refreshHover();
    if (this.aiming && this.host.menuOpen()) this.aiming = null;
    world.fx.showAim(state, this.aiming ? this.aiming.slot : null, this.aiming ? this.cursorGround() : null);
    // attack-move armed: highlight the unit the click would attack (same outline as hover)
    this.amTarget = this.armed === 'attackMove' ? this.predictAttackMove(this.cursorGround()) : null;
    // attack cursor over whatever a click would attack (hovered hostile unit / predicted attack-move target)
    const cursor = this.aiming?.slot === null ? 'crosshair' : this.armed === 'attackMove' ? (this.amTarget ? ATTACK_CURSOR : 'crosshair') : this.armed ? 'crosshair' : this.hoveredEnemy() ? ATTACK_CURSOR : '';
    if (cursor !== this.cursor) this.el.style.cursor = this.cursor = cursor;

    if (this.rightHeld && !state.paused && now - this.lastHoldMove > HOLD_MOVE_MS) this.rightClick(now, false);

    const me = state.me();
    // LoL: on respawn the camera jumps to the champion in the fountain (it stayed at the death spot)
    const dead = !!state.snap?.me?.dead;
    if (this.wasDead && !dead && me) rig.focus(me.x, me.y);
    this.wasDead = dead;
    if (this.centerHeld) this.cameraPeekUntil = 0;
    // minimap click/hold peeks at a spot even with the camera locked (like LoL); the lock resumes afterwards
    if (me && (settings.cameraLocked || this.centerHeld) && now >= this.cameraPeekUntil) {
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
