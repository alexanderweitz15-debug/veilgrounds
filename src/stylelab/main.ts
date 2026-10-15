// Style lab entry (stylelab.html): three art-direction variants rendered with the game's camera, a 64 px
// silhouette test strip and palette swatches. Switch variants with the tabs or ?v=A|B|C&view=lane|structures.
import * as THREE from 'three';
import { mountChampions } from './champions';
import { CHAMPS, LABEL, MINIONS, sprite, type Key } from './figures';
import { drawMinimap } from './minimap';
import { buildScene, VIEWS, type LabScene } from './scene';
import { VARIANTS, type Variant, type VariantId } from './styles';
import { FOV, PITCH } from './util';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('view');
const labelLayer = $<HTMLDivElement>('labels');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
const camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 50, 20000);
const cam = { ...VIEWS.lane };

let current: Variant = VARIANTS[0]!;
let lab: LabScene | null = null;
let showLabels = true;
let labelEls: HTMLDivElement[] = [];

function applyCamera(): void {
  camera.position.set(cam.x, Math.sin(PITCH) * cam.dist, -cam.y + Math.cos(PITCH) * cam.dist);
  camera.lookAt(cam.x, 0, -cam.y);
  camera.updateMatrixWorld();
}

function resize(): void {
  const w = canvas.parentElement!.clientWidth;
  const h = Math.round((w * 9) / 16);
  renderer.setSize(w, h, false);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function setVariant(id: VariantId): void {
  const v = VARIANTS.find((x) => x.id === id) ?? VARIANTS[0]!;
  current = v;
  lab?.dispose();
  lab = buildScene(v, renderer);
  document.body.dataset.variant = v.id;
  for (const b of document.querySelectorAll<HTMLButtonElement>('#tabs button')) b.classList.toggle('on', b.dataset.id === v.id);
  for (const r of document.querySelectorAll<HTMLElement>('.strip')) r.classList.toggle('on', r.dataset.id === v.id);
  $('vname').textContent = `${v.id} – ${v.name}`;
  $('vtag').textContent = v.tagline;
  $('vnotes').innerHTML = v.notes.map((n) => `<li>${n}</li>`).join('');
  drawMinimap($<HTMLCanvasElement>('minimap'), v);
  labelLayer.innerHTML = '';
  labelEls = lab.labels.map((l) => {
    const d = document.createElement('div');
    d.className = `label ${l.cls}`;
    d.textContent = l.text;
    labelLayer.appendChild(d);
    return d;
  });
  const url = new URL(location.href);
  url.searchParams.set('v', v.id);
  history.replaceState(null, '', url);
}

// ------------------------------------------------------------------------------------------------ champions view
const champHost = document.createElement('div');
document.querySelector('header')!.after(champHost);
const champView = mountChampions(champHost);
const champBtn = document.createElement('button');
champBtn.textContent = 'Champions';
champBtn.title = 'Champion-Sprites (Variante C): Spielgröße, Animationen, 8 Richtungen, 64-px-Test';
document.getElementById('views')!.insertBefore(champBtn, document.getElementById('labelsBtn'));
let champsOn = false;
function showChampions(on: boolean): void {
  champsOn = on;
  document.querySelector<HTMLElement>('main')!.style.display = on ? 'none' : '';
  for (const s of document.querySelectorAll<HTMLElement>('section.block')) s.style.display = on ? 'none' : '';
  champBtn.classList.toggle('on', on);
  if (on) {
    for (const b of document.querySelectorAll<HTMLButtonElement>('#views button[data-view]')) b.classList.remove('on');
    champView.start();
    const url = new URL(location.href);
    url.searchParams.set('view', 'champions');
    history.replaceState(null, '', url);
  } else champView.stop();
}
champBtn.onclick = () => showChampions(true);

function setView(name: keyof typeof VIEWS): void {
  if (champsOn) showChampions(false);
  Object.assign(cam, VIEWS[name]);
  for (const b of document.querySelectorAll<HTMLButtonElement>('#views button[data-view]')) b.classList.toggle('on', b.dataset.view === name);
  const url = new URL(location.href);
  url.searchParams.set('view', name);
  history.replaceState(null, '', url);
}

const tmp = new THREE.Vector3();
function placeLabels(): void {
  if (!lab) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  lab.labels.forEach((l, i) => {
    const el = labelEls[i]!;
    tmp.copy(l.pos).project(camera);
    const vis = showLabels && tmp.z < 1 && Math.abs(tmp.x) < 1.05 && Math.abs(tmp.y) < 1.05;
    el.style.display = vis ? 'block' : 'none';
    if (vis) el.style.transform = `translate(${((tmp.x + 1) / 2) * w}px, ${((1 - tmp.y) / 2) * h}px) translate(-50%, -100%)`;
  });
}

function frame(now: number): void {
  applyCamera();
  if (!champsOn) {
    lab?.update(now / 1000);
    if (lab) renderer.render(lab.scene, camera);
    placeLabels();
  }
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------------------------------------ controls
let drag: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const perPx = (2 * cam.dist * Math.tan(THREE.MathUtils.degToRad(FOV / 2))) / canvas.clientHeight;
  cam.x -= (e.clientX - drag.x) * perPx;
  cam.y += ((e.clientY - drag.y) * perPx) / Math.sin(PITCH);
  drag = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointerup', () => (drag = null));
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    cam.dist = THREE.MathUtils.clamp(cam.dist + Math.sign(e.deltaY) * 150, 1500, 4200);
  },
  { passive: false },
);

// ------------------------------------------------------------------------------------------------ static panels
function buildTabs(): void {
  const tabs = $('tabs');
  for (const v of VARIANTS) {
    const b = document.createElement('button');
    b.dataset.id = v.id;
    b.innerHTML = `<b>${v.id}</b> ${v.name}`;
    b.onclick = () => setVariant(v.id);
    tabs.appendChild(b);
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('#views button[data-view]')) b.onclick = () => setView(b.dataset.view as keyof typeof VIEWS);
  $<HTMLButtonElement>('labelsBtn').onclick = (e) => {
    showLabels = !showLabels;
    (e.currentTarget as HTMLElement).classList.toggle('on', showLabels);
  };
  $<HTMLButtonElement>('saveBtn').onclick = () => {
    const a = document.createElement('a');
    a.download = `veilgrounds-stil-${current.id}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  };
}

const CELL = 64;
const COLS: { key: Key; team: number }[] = [
  ...CHAMPS.map((key) => ({ key, team: 0 })),
  ...MINIONS.flatMap((key) => [
    { key, team: 0 },
    { key, team: 1 },
  ]),
];

function buildStrips(): void {
  const host = $('striprows');
  for (const v of VARIANTS) {
    const wrap = document.createElement('div');
    wrap.className = 'strip';
    wrap.dataset.id = v.id;
    const head = document.createElement('div');
    head.className = 'striphead';
    head.innerHTML = `<b>${v.id}</b> ${v.name}`;
    wrap.appendChild(head);
    const rows: [string, string | null][] = [
      ['auf Weg', v.world.ground.lane],
      ['auf Dschungel', v.world.ground.grassDark],
      ['Silhouette', null],
    ];
    const pad = 8;
    const c = document.createElement('canvas');
    c.width = COLS.length * (CELL + pad) + 96;
    c.height = rows.length * (CELL + pad) + 18;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.font = '600 11px Barlow, system-ui, sans-serif';
    ctx.fillStyle = '#9aa0a6';
    COLS.forEach((col, i) => {
      const label = CHAMPS.includes(col.key) ? LABEL[col.key].split(' ')[0]! : `${LABEL[col.key]} ${col.team ? 'A' : 'L'}`;
      ctx.fillText(label, 96 + i * (CELL + pad), 12, CELL + pad - 2);
    });
    rows.forEach(([name, bg], r) => {
      const y = 18 + r * (CELL + pad);
      ctx.fillStyle = '#9aa0a6';
      ctx.fillText(name, 0, y + CELL / 2 + 4);
      COLS.forEach((col, i) => {
        const x = 96 + i * (CELL + pad);
        ctx.fillStyle = bg ?? '#f4f4f4';
        ctx.fillRect(x, y, CELL, CELL);
        const src = sprite(v, col.key, col.team);
        if (bg) ctx.drawImage(src, x, y, CELL, CELL);
        else {
          const s = document.createElement('canvas');
          s.width = s.height = CELL;
          const sc = s.getContext('2d')!;
          sc.imageSmoothingQuality = 'high';
          sc.drawImage(src, 0, 0, CELL, CELL);
          sc.globalCompositeOperation = 'source-in';
          sc.fillStyle = '#111';
          sc.fillRect(0, 0, CELL, CELL);
          ctx.drawImage(s, x, y);
        }
      });
    });
    wrap.appendChild(c);
    wrap.onclick = () => setVariant(v.id);
    host.appendChild(wrap);
  }
}

function buildSwatches(): void {
  const host = $('swatches');
  for (const v of VARIANTS) {
    const row = document.createElement('div');
    row.className = 'swrow';
    row.innerHTML =
      `<div class="swname"><b>${v.id}</b> ${v.name}</div>` +
      v.swatches.map((s) => `<div class="sw"><i style="background:${s.hex}"></i><span>${s.name}</span><code>${s.hex}</code></div>`).join('');
    host.appendChild(row);
  }
}

buildTabs();
buildStrips();
buildSwatches();
window.addEventListener('resize', resize);
resize();
const params = new URLSearchParams(location.search);
setView((params.get('view') as keyof typeof VIEWS) in VIEWS ? (params.get('view') as keyof typeof VIEWS) : 'lane');
setVariant((params.get('v') as VariantId) ?? 'A');
if (params.get('view') === 'champions') showChampions(true);
requestAnimationFrame(frame);

// hook for automated screenshots / debugging
// (renderNow: rAF is paused in hidden tabs, so captures render one frame explicitly)
const renderNow = (t = 2.2): void => {
  applyCamera();
  lab?.update(t);
  if (lab) renderer.render(lab.scene, camera);
};
(window as unknown as { __lab: unknown }).__lab = { setVariant, setView, canvas, renderNow, showChampions, champView };
