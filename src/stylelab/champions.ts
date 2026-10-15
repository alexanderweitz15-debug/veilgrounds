// Style lab "Champions" view: the 26 procedural champion sprites (variant C "Gouache-Dämmerung") at game scale
// on lane/jungle ground with team rings and violet shadows, enlarged animated previews, the 8-direction turntable
// and the 64 px silhouette strip. Uses only the public API of src/render/champions.
import { ANIMS, CHAMPION_IDS, DIRS, FPS, championKit, drawChampionFrame, framesOf, type Anim, type Dir } from '../render/champions';

const C = {
  bg: '#221c2c',
  lane: '#9c8158',
  laneEdge: '#77633f',
  grass: '#55613f',
  grassDark: '#434f33',
  ally: '#4aa6e8',
  enemy: '#e0473a',
  shadow: 'rgba(28,18,48,0.5)',
  text: '#e6e2da',
  muted: '#9aa0a6',
};

const CHAMPS = CHAMPION_IDS.filter((id) => id !== 'hark');
const ALL = [...CHAMPS, 'hark'];
const PLAY: Anim[] = ['idle', 'run', 'attack', 'cast'];

// ------------------------------------------------------------------------------------------------ frame cache
const cache = new Map<string, HTMLCanvasElement>();
function frameCanvas(id: string, anim: Anim, dir: Dir, f: number, size: number): HTMLCanvasElement {
  const n = Math.max(1, framesOf(id, anim));
  const fr = ((f % n) + n) % n;
  const key = `${id}|${anim}|${dir}|${fr}|${size}`;
  let c = cache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = c.height = size;
    drawChampionFrame(c.getContext('2d')!, id, anim, dir, fr, 0, 0, size);
    cache.set(key, c);
  }
  return c;
}
const animFor = (id: string, a: Anim): Anim => (framesOf(id, a) ? a : 'idle');

// ------------------------------------------------------------------------------------------------ ground painting
function rnd(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function paintGround(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, base: string, seed: number): void {
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);
  const r = rnd(seed);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  for (let i = 0; i < (w * h) / 260; i++) {
    const px = x + r() * w;
    const py = y + r() * h;
    ctx.strokeStyle = r() < 0.5 ? 'rgba(255,220,170,0.06)' : 'rgba(30,20,50,0.10)';
    ctx.lineWidth = 2 + r() * 3;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + 6 + r() * 10, py + (r() - 0.5) * 3);
    ctx.stroke();
  }
  ctx.restore();
}

const silhouetteTmp = document.createElement('canvas');
function castShadow(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, cx: number, gy: number, size: number): void {
  // sun low behind-right → shadow falls toward the camera / lower left (like the 3D lane scene)
  silhouetteTmp.width = src.width;
  silhouetteTmp.height = src.height;
  const s = silhouetteTmp.getContext('2d')!;
  s.clearRect(0, 0, src.width, src.height);
  s.drawImage(src, 0, 0);
  s.globalCompositeOperation = 'source-in';
  s.fillStyle = C.shadow;
  s.fillRect(0, 0, src.width, src.height);
  s.globalCompositeOperation = 'source-over';
  ctx.save();
  ctx.translate(cx, gy);
  ctx.transform(1, 0, 0.55, -0.42, 0, 0);
  ctx.drawImage(silhouetteTmp, -size / 2, -size * 0.92, size, size);
  ctx.restore();
}

function ringAt(ctx: CanvasRenderingContext2D, cx: number, gy: number, rx: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = Math.max(2, rx * 0.12);
  ctx.beginPath();
  ctx.ellipse(cx, gy, rx, rx * 0.56, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** One unit at game scale: shadow, ring, sprite. size = displayed cell size. */
function unit(ctx: CanvasRenderingContext2D, id: string, anim: Anim, dir: Dir, f: number, cx: number, gy: number, size: number, team: number | null): void {
  const src = frameCanvas(id, animFor(id, anim), dir, f, 128);
  castShadow(ctx, src, cx, gy, size);
  if (team !== null) ringAt(ctx, cx, gy, size * (id === 'hark' ? 0.22 : 0.2), team ? C.enemy : C.ally);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, cx - size / 2, gy - size * 0.92, size, size);
}

// ------------------------------------------------------------------------------------------------ view
export interface ChampionsView {
  root: HTMLElement;
  start(): void;
  stop(): void;
  /** draw everything once (rAF is paused in background tabs) */
  renderOnce(time?: number): void;
  /** JPEG data URLs of the documentation sheets (overview, close-up, animation sheet). */
  exportSheets(): { overview: string; closeup: string; anims: string };
}

export function mountChampions(host: HTMLElement): ChampionsView {
  const root = document.createElement('section');
  root.id = 'champions';
  root.style.cssText = 'display:none;padding:16px;';
  root.innerHTML = `
    <style>
      #champions h2 { margin: 6px 0 6px; }
      #champions .row { display:flex; flex-wrap:wrap; gap:12px; align-items:flex-start; }
      #champions .panel { background: var(--panel); border:1px solid var(--line); border-radius:6px; padding:10px; }
      #champions canvas { display:block; border-radius:4px; }
      #champions .cards { display:grid; grid-template-columns: repeat(auto-fill, minmax(176px, 1fr)); gap:10px; }
      #champions .card { background: var(--panel); border:1px solid var(--line); border-radius:6px; padding:6px; cursor:pointer; }
      #champions .card.on { border-color: var(--hi); }
      #champions .card b { display:block; font: 600 15px 'Barlow Condensed', sans-serif; }
      #champions .card span { display:block; font-size:11px; color: var(--muted); line-height:1.25; min-height: 28px; }
      #champions .ctl { display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-bottom:8px; }
      #champions .ctl label { color: var(--muted); font-size: 12px; }
      #champions .look { color: var(--muted); max-width: 520px; font-size: 13px; }
    </style>
    <div class="panel" style="margin-bottom:12px">
      <h2>Champions in Spielgröße (Variante C)</h2>
      <p class="legend">Alle 26 + Hark, Bildzellen 128 px wie im Atlas, auf Weg und Dschungel, Bodenring Team (blau/rot), Schatten nach vorn (Sonne hinten rechts). Animation läuft durch Idle → Lauf → Angriff → Zauber.</p>
      <canvas id="chGame"></canvas>
    </div>
    <div class="row" style="margin-bottom:12px">
      <div class="panel">
        <div class="ctl">
          <label>Animation</label><span id="chAnims"></span>
          <label>Richtung</label><span id="chDirs"></span>
        </div>
        <canvas id="chBig" width="400" height="400"></canvas>
        <p id="chLook" class="look"></p>
      </div>
      <div class="panel">
        <h2>8 Richtungen (aktuelle Animation)</h2>
        <canvas id="chTurn"></canvas>
        <h2 style="margin-top:10px">Alle Frames (Richtung SE)</h2>
        <canvas id="chSheet"></canvas>
      </div>
    </div>
    <div class="panel" style="margin-bottom:12px">
      <h2>64-px-Silhouettentest</h2>
      <canvas id="chSil"></canvas>
    </div>
    <h2>Alle Champions vergrößert (2×)</h2>
    <div class="cards" id="chCards"></div>
  `;
  host.appendChild(root);
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;

  let selected = 'mira';
  let animSel: Anim | 'auto' = 'auto';
  let dirSel: Dir | 'auto' = 'auto';
  let running = false;
  let raf = 0;
  const t0 = performance.now();

  // controls
  const mkBtn = (label: string, on: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = on;
    return b;
  };
  const animBox = $('chAnims');
  const dirBox = $('chDirs');
  const refreshCtl = () => {
    for (const b of animBox.querySelectorAll('button')) b.classList.toggle('on', b.textContent === (animSel === 'auto' ? 'auto' : animSel));
    for (const b of dirBox.querySelectorAll('button')) b.classList.toggle('on', b.textContent === (dirSel === 'auto' ? 'drehen' : dirSel));
  };
  animBox.append(mkBtn('auto', () => ((animSel = 'auto'), refreshCtl())), ...ANIMS.map((a) => mkBtn(a, () => ((animSel = a), refreshCtl()))));
  dirBox.append(mkBtn('drehen', () => ((dirSel = 'auto'), refreshCtl())), ...DIRS.map((d) => mkBtn(d, () => ((dirSel = d), refreshCtl()))));
  refreshCtl();

  // cards
  const cards = $('chCards');
  const cardCanvases = new Map<string, HTMLCanvasElement>();
  for (const id of ALL) {
    const k = championKit(id);
    const card = document.createElement('div');
    card.className = 'card' + (id === selected ? ' on' : '');
    const c = document.createElement('canvas');
    c.width = c.height = 164;
    card.appendChild(c);
    const b = document.createElement('b');
    b.textContent = k?.name ?? 'Hark (Ottilies Wolf)';
    const s = document.createElement('span');
    s.textContent = k?.feature ?? 'grauer Wolf mit Lederhalsband';
    card.append(b, s);
    card.onclick = () => {
      selected = id;
      for (const el of cards.querySelectorAll('.card')) el.classList.remove('on');
      card.classList.add('on');
      $('chLook').textContent = k?.look ?? 'Hark: großer grauer Wolf, helle Brust, gelbe Augen, Lederhalsband mit Messingmarke.';
    };
    cards.appendChild(card);
    cardCanvases.set(id, c);
  }
  $('chLook').textContent = championKit(selected)!.look;

  // game-scale canvas
  const game = $<HTMLCanvasElement>('chGame');
  const perRow = 7;
  const cell = 128; // displayed cell = atlas cell size (1:1)
  const gap = 8;
  const rowH = 150;
  game.width = perRow * (cell + gap) + 40;
  game.height = rowH * 4 + 10;

  const sil = $<HTMLCanvasElement>('chSil');
  const S = 64;
  sil.width = ALL.length * (S + 6) + 90;
  sil.height = 3 * (S + 6) + 20;

  const big = $<HTMLCanvasElement>('chBig');
  const turn = $<HTMLCanvasElement>('chTurn');
  turn.width = 8 * 100;
  turn.height = 112;
  const sheet = $<HTMLCanvasElement>('chSheet');
  sheet.width = 6 * 100;
  sheet.height = 4 * 100 + 10;

  function drawGame(time: number): void {
    const ctx = game.getContext('2d')!;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, game.width, game.height);
    const cycle = Math.floor(time / 2.4) % PLAY.length;
    const anim = PLAY[cycle]!;
    for (let row = 0; row < 4; row++) {
      const y0 = row * rowH + 5;
      const lane = row % 2 === 0;
      paintGround(ctx, 0, y0, game.width, rowH - 4, lane ? C.lane : C.grassDark, 7 + row);
      if (lane) {
        ctx.fillStyle = C.laneEdge;
        ctx.fillRect(0, y0, game.width, 4);
      }
    }
    ALL.forEach((id, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const cx = 30 + col * (cell + gap) + cell / 2;
      const gy = row * rowH + 5 + rowH - 16;
      const fps = FPS[anim];
      const f = Math.floor(time * fps + i * 0.7);
      unit(ctx, id, anim, i % 3 === 0 ? 'E' : i % 3 === 1 ? 'SE' : 'S', f, cx, gy, cell, i % 4 === 3 ? 1 : 0);
    });
    ctx.fillStyle = C.text;
    ctx.font = '600 12px Barlow, system-ui, sans-serif';
    ctx.fillText(`${anim}`, 6, 18);
  }

  function drawSil(): void {
    const ctx = sil.getContext('2d')!;
    ctx.fillStyle = '#202226';
    ctx.fillRect(0, 0, sil.width, sil.height);
    const rows: [string, string | null][] = [
      ['auf Weg', C.lane],
      ['auf Dschungel', C.grassDark],
      ['Silhouette', null],
    ];
    ctx.font = '600 10px Barlow, system-ui, sans-serif';
    ALL.forEach((id, i) => {
      ctx.fillStyle = C.muted;
      const nm = (championKit(id)?.name ?? 'Hark').split(' ')[0]!;
      ctx.fillText(nm, 90 + i * (S + 6), 12, S);
    });
    rows.forEach(([name, bg], r) => {
      const y = 18 + r * (S + 6);
      ctx.fillStyle = C.muted;
      ctx.font = '600 11px Barlow, system-ui, sans-serif';
      ctx.fillText(name, 0, y + S / 2 + 4);
      ALL.forEach((id, i) => {
        const x = 90 + i * (S + 6);
        ctx.fillStyle = bg ?? '#f4f4f4';
        ctx.fillRect(x, y, S, S);
        const src = frameCanvas(id, 'idle', 'SE', 0, 128);
        if (bg) ctx.drawImage(src, x, y, S, S);
        else {
          const t = document.createElement('canvas');
          t.width = t.height = S;
          const tc = t.getContext('2d')!;
          tc.imageSmoothingQuality = 'high';
          tc.drawImage(src, 0, 0, S, S);
          tc.globalCompositeOperation = 'source-in';
          tc.fillStyle = '#111';
          tc.fillRect(0, 0, S, S);
          ctx.drawImage(t, x, y);
        }
      });
    });
  }

  function currentAnim(time: number): Anim {
    if (animSel !== 'auto') return animFor(selected, animSel);
    return animFor(selected, (['idle', 'run', 'attack', 'cast', 'death'] as Anim[])[Math.floor(time / 2) % 5]!);
  }
  function currentDir(time: number): Dir {
    if (dirSel !== 'auto') return dirSel;
    return DIRS[Math.floor(time / 10) % 8]!;
  }

  function drawBig(time: number): void {
    const ctx = big.getContext('2d')!;
    paintGround(ctx, 0, 0, big.width, big.height, C.grass, 3);
    const anim = currentAnim(time);
    const dir = currentDir(time);
    const f = Math.floor(time * FPS[anim]);
    const n = Math.max(1, framesOf(selected, anim));
    const loopF = anim === 'death' ? Math.min(n - 1, f % (n + 4)) : f;
    // shadow + ring + 3x sprite (rendered directly at 384 px master for crispness)
    const size = 384;
    const cx = big.width / 2;
    const gy = big.height - 22;
    const src = frameCanvas(selected, anim, dir, loopF, size);
    castShadow(ctx, src, cx, gy, size);
    ringAt(ctx, cx, gy, size * 0.2, C.ally);
    ctx.drawImage(src, cx - size / 2, gy - size * 0.92, size, size);
    ctx.fillStyle = C.text;
    ctx.font = '600 14px Barlow, system-ui, sans-serif';
    ctx.fillText(`${championKit(selected)?.name ?? 'Hark'} – ${anim} ${dir} #${(((loopF % n) + n) % n) + 1}/${n}`, 10, 20);
  }

  function drawTurn(time: number): void {
    const ctx = turn.getContext('2d')!;
    paintGround(ctx, 0, 0, turn.width, turn.height, C.lane, 5);
    const anim = currentAnim(time);
    const f = Math.floor(time * FPS[anim]);
    DIRS.forEach((d, i) => {
      const src = frameCanvas(selected, anim, d, anim === 'death' ? framesOf(selected, anim) - 1 : f, 128);
      ctx.drawImage(src, i * 100 - 14, -10, 128, 128);
      ctx.fillStyle = C.text;
      ctx.font = '600 11px Barlow, system-ui, sans-serif';
      ctx.fillText(d, i * 100 + 4, 108);
    });
  }

  function drawSheet(): void {
    const ctx = sheet.getContext('2d')!;
    ctx.fillStyle = '#2a2338';
    ctx.fillRect(0, 0, sheet.width, sheet.height);
    const anims: Anim[] = ['idle', 'run', 'attack', 'cast', 'death'];
    let row = 0;
    for (const a of anims) {
      const n = framesOf(selected, a);
      if (!n) continue;
      if (row > 4) break;
      for (let f = 0; f < n; f++) {
        const src = frameCanvas(selected, a, 'SE', f, 128);
        ctx.drawImage(src, f * 100 - 14, row * 82 - 22, 128, 128);
      }
      ctx.fillStyle = C.muted;
      ctx.font = '600 10px Barlow, system-ui, sans-serif';
      ctx.fillText(a, 2, row * 82 + 10);
      row++;
    }
  }

  let lastSel = '';
  let cardsDone = 0;
  function tick(): void {
    if (!running) return;
    step((performance.now() - t0) / 1000, 2);
    raf = requestAnimationFrame(tick);
  }
  function step(time: number, cardBudget: number): void {
    drawGame(time);
    drawBig(time);
    drawTurn(time);
    if (lastSel !== selected) {
      drawSheet();
      lastSel = selected;
    }
    // cards: render progressively (2 per tick), then animate the selected one only
    if (cardsDone < ALL.length) {
      for (let k = 0; k < cardBudget && cardsDone < ALL.length; k++, cardsDone++) {
        const id = ALL[cardsDone]!;
        const c = cardCanvases.get(id)!;
        const ctx = c.getContext('2d')!;
        paintGround(ctx, 0, 0, c.width, c.height, cardsDone % 2 ? C.grassDark : C.lane, cardsDone);
        drawChampionFrame(ctx, id, 'idle', 'SE', 0, -46, -66, 256);
      }
    }
  }

  let silDone = false;
  return {
    root,
    start() {
      root.style.display = 'block';
      if (!silDone) {
        drawSil();
        silDone = true;
      }
      if (!running) {
        running = true;
        raf = requestAnimationFrame(tick);
      }
    },
    stop() {
      root.style.display = 'none';
      running = false;
      cancelAnimationFrame(raf);
    },
    renderOnce(time = 3.1) {
      root.style.display = 'block';
      if (!silDone) {
        drawSil();
        silDone = true;
      }
      step(time, ALL.length);
    },
    exportSheets() {
      // overview: game-scale canvas + silhouette strip; close-up: big preview + turntable + frame sheet
      const time = 3.1;
      drawGame(time);
      const ov = document.createElement('canvas');
      ov.width = Math.max(game.width, sil.width);
      ov.height = game.height + sil.height + 10;
      const o = ov.getContext('2d')!;
      o.fillStyle = '#17181a';
      o.fillRect(0, 0, ov.width, ov.height);
      o.drawImage(game, 0, 0);
      o.drawImage(sil, 0, game.height + 10);
      // close-up: every champion at ~2x game scale (idle, SE) with name and 64 px feature
      const cols = 9;
      const cw = 236;
      const chh = 270;
      const cu = document.createElement('canvas');
      cu.width = cols * cw;
      cu.height = Math.ceil(ALL.length / cols) * chh;
      const q = cu.getContext('2d')!;
      ALL.forEach((id, i) => {
        const x = (i % cols) * cw;
        const y = Math.floor(i / cols) * chh;
        paintGround(q, x, y, cw, chh, i % 2 ? C.grassDark : C.lane, 20 + i);
        const src = frameCanvas(id, 'idle', 'SE', 0, 256);
        castShadow(q, src, x + cw / 2, y + chh - 26, 256);
        ringAt(q, x + cw / 2, y + chh - 26, 256 * 0.2, i % 4 === 3 ? C.enemy : C.ally);
        q.drawImage(src, x + cw / 2 - 128, y + chh - 26 - 256 * 0.92, 256, 256);
        q.fillStyle = 'rgba(15,15,18,0.65)';
        q.fillRect(x, y, cw, 34);
        q.fillStyle = C.text;
        q.font = '600 14px Barlow, system-ui, sans-serif';
        q.fillText(championKit(id)?.name ?? 'Hark (Ottilie)', x + 6, y + 15);
        q.fillStyle = C.muted;
        q.font = '500 11px Barlow, system-ui, sans-serif';
        q.fillText(championKit(id)?.feature ?? 'wolf companion', x + 6, y + 29, cw - 10);
      });
      // animation sheet: a few champions through idle/run/attack/cast/death (SE / E)
      const animIds = ['mira', 'brom', 'hagen', 'corvin', 'nyx', 'lio'];
      const seq: [Anim, Dir, number][] = [];
      for (let f = 0; f < 2; f++) seq.push(['idle', 'SE', f * 2]);
      for (let f = 0; f < 6; f++) seq.push(['run', 'SE', f]);
      for (let f = 0; f < 4; f++) seq.push(['attack', 'E', f]);
      for (let f = 0; f < 3; f++) seq.push(['cast', 'SE', f]);
      for (let f = 0; f < 3; f++) seq.push(['death', 'SE', f]);
      const an = sheetCanvas(animIds, seq, 128, C.grass);
      return { overview: ov.toDataURL('image/jpeg', 0.92), closeup: cu.toDataURL('image/jpeg', 0.92), anims: an.toDataURL('image/jpeg', 0.92) };
    },
  };
}

/** Debug/screenshot helper: a sheet of frames (rows = ids, columns = [anim, dir, frame] triples). */
export function sheetCanvas(ids: string[], cols: [Anim, Dir, number][], size = 256, bg = C.grass): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = cols.length * size;
  c.height = ids.length * size;
  const g = c.getContext('2d')!;
  paintGround(g, 0, 0, c.width, c.height, bg, 1);
  ids.forEach((id, r) => cols.forEach(([a, d, f], i) => drawChampionFrame(g, id, animFor(id, a), d, f, i * size, r * size, size)));
  return c;
}
(window as unknown as { __champSheet: typeof sheetCanvas }).__champSheet = sheetCanvas;
