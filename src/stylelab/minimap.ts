// Minimap drawn in the map style of each variant (spec §11: "Minimap im Kartenstil"). Schematic 3-lane layout.
import type { Variant } from './styles';
import { REL } from './styles';
import { mix, mulberry, scale } from './util';

export function drawMinimap(c: HTMLCanvasElement, v: Variant): void {
  const N = c.width;
  const ctx = c.getContext('2d')!;
  const G = v.world.ground;
  const mode = v.world.mode;
  const ink = v.sprite.ink;
  const u = N / 100; // map units: 0..100, y down
  const rnd = mulberry(4);
  ctx.save();
  ctx.clearRect(0, 0, N, N);
  ctx.lineCap = ctx.lineJoin = 'round';

  ctx.fillStyle = mode === 'hatch' ? v.world.paper : G.grass;
  ctx.fillRect(0, 0, N, N);
  // jungle quadrants
  ctx.fillStyle = mode === 'hatch' ? G.grass : G.grassDark;
  for (const [x, y] of [
    [22, 40],
    [40, 78],
    [60, 22],
    [78, 60],
  ]) {
    ctx.beginPath();
    ctx.ellipse(x! * u, y! * u, 15 * u, 11 * u, -0.78, 0, Math.PI * 2);
    ctx.fill();
  }
  if (mode === 'hatch') {
    // hatched jungle
    ctx.save();
    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 0.8;
    for (const [x, y] of [
      [22, 40],
      [40, 78],
      [60, 22],
      [78, 60],
    ]) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(x! * u, y! * u, 15 * u, 11 * u, -0.78, 0, Math.PI * 2);
      ctx.clip();
      for (let k = -40; k < 40; k += 3) {
        ctx.beginPath();
        ctx.moveTo((x! + k - 20) * u, (y! + 20) * u);
        ctx.lineTo((x! + k + 20) * u, (y! - 20) * u);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  }
  // river
  ctx.strokeStyle = G.river;
  ctx.lineWidth = 6 * u;
  ctx.beginPath();
  ctx.moveTo(4 * u, 4 * u);
  ctx.bezierCurveTo(30 * u, 30 * u, 70 * u, 64 * u, 96 * u, 96 * u);
  ctx.stroke();
  if (mode === 'paint') {
    ctx.strokeStyle = G.riverLight;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 2 * u;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // lanes
  const lanes = (w: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = w * u;
    ctx.beginPath();
    ctx.moveTo(10 * u, 88 * u);
    ctx.lineTo(10 * u, 12 * u);
    ctx.lineTo(88 * u, 10 * u);
    ctx.moveTo(12 * u, 90 * u);
    ctx.lineTo(88 * u, 90 * u);
    ctx.lineTo(90 * u, 12 * u);
    ctx.moveTo(14 * u, 86 * u);
    ctx.lineTo(86 * u, 14 * u);
    ctx.stroke();
  };
  if (mode === 'hatch') {
    lanes(6.5, ink);
    lanes(5, G.lane);
  } else {
    lanes(6, G.laneEdge);
    lanes(4.6, G.lane);
  }
  // rift at the centre
  ctx.fillStyle = G.riftDeep;
  ctx.beginPath();
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    ctx.lineTo((44 + t * 12) * u, (46 + t * 8 + Math.sin(t * 9) * 1.2) * u - 2 * u * Math.sin(Math.PI * t));
  }
  for (let i = 10; i >= 0; i--) {
    const t = i / 10;
    ctx.lineTo((44 + t * 12) * u, (46 + t * 8 + Math.sin(t * 7) * 1.2) * u + 2 * u * Math.sin(Math.PI * t));
  }
  ctx.closePath();
  if (mode === 'paint') {
    ctx.shadowColor = G.riftGlow;
    ctx.shadowBlur = 12;
  }
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = mode === 'hatch' ? ink : G.riftGlow;
  ctx.lineWidth = mode === 'hatch' ? 1.2 : 1;
  ctx.stroke();
  // bases
  for (const team of [0, 1]) {
    const t = v.team[team]!;
    const [x, y] = team ? [90, 10] : [10, 90];
    ctx.fillStyle = t.stone;
    ctx.beginPath();
    ctx.arc(x * u, y * u, 12 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = team ? t.primary : t.primary;
    ctx.strokeStyle = mode === 'flat' ? scale(t.primary, 0.6) : ink;
    ctx.lineWidth = mode === 'flat' ? 1 : 1.5;
    ctx.beginPath();
    if (team) ctx.rect((x - 4) * u, (y - 4) * u, 8 * u, 8 * u);
    else ctx.arc(x * u, y * u, 4.5 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  // towers: own team round, enemy square (shape AND colour, colour-blind safe)
  const towers: [number, number, number][] = [
    [10, 62, 0],
    [10, 36, 0],
    [36, 90, 0],
    [62, 90, 0],
    [30, 70, 0],
    [42, 58, 0],
    [38, 10, 1],
    [64, 10, 1],
    [90, 38, 1],
    [90, 64, 1],
    [70, 30, 1],
    [58, 42, 1],
  ];
  for (const [x, y, team] of towers) {
    ctx.fillStyle = team ? REL.enemy : REL.ally;
    ctx.strokeStyle = mode === 'flat' ? '#2b2430' : ink;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    if (team) ctx.rect((x - 1.8) * u, (y - 1.8) * u, 3.6 * u, 3.6 * u);
    else ctx.arc(x * u, y * u, 2 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  // style finish
  if (mode === 'hatch') {
    for (let i = 0; i < 600; i++) {
      ctx.fillStyle = 'rgba(80,60,30,0.12)';
      ctx.fillRect(rnd() * N, rnd() * N, 1 + rnd() * 2, 1);
    }
    ctx.strokeStyle = ink;
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, N - 3, N - 3);
  } else if (mode === 'paint') {
    const g = ctx.createRadialGradient(N / 2, N / 2, N * 0.3, N / 2, N / 2, N * 0.75);
    g.addColorStop(0, 'rgba(20,14,30,0)');
    g.addColorStop(1, 'rgba(20,14,30,0.6)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, N, N);
  } else {
    ctx.strokeStyle = mix(G.grassDark, '#2b2430', 0.4);
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, N - 4, N - 4);
  }
  ctx.restore();
}
