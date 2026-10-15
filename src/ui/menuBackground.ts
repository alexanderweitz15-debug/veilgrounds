// Animated main-menu backdrop: two fortress silhouettes (Lichtwerk copper bottom-left, Aschehalle slate top-right),
// a glowing rift across the plateau and violet mist rising from it. placeholder art, canvas 2D, ~0.3 ms/frame.

interface Mote {
  x: number;
  y: number;
  r: number;
  vy: number;
  vx: number;
  life: number;
  max: number;
}

export function startMenuBackground(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext('2d')!;
  const motes: Mote[] = [];
  let raf = 0;
  let w = 0;
  let h = 0;
  const resize = (): void => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize);

  // rift polyline across the screen (bottom-right to top-left diagonal, like the river)
  const riftAt = (t: number): [number, number] => {
    const x = w * (1.05 - t * 1.1);
    const y = h * (0.95 - t * 0.9) + Math.sin(t * 19) * 14 + Math.sin(t * 7.3) * 22;
    return [x, y];
  };

  const fortress = (x: number, y: number, s: number, fill: string, glow: string, flip: boolean): void => {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(flip ? -s : s, flip ? -s : s);
    ctx.fillStyle = fill;
    ctx.shadowColor = glow;
    ctx.shadowBlur = 30;
    ctx.beginPath();
    // stepped keep with towers
    ctx.moveTo(-160, 0);
    ctx.lineTo(-160, -70);
    ctx.lineTo(-130, -70);
    ctx.lineTo(-130, -120);
    ctx.lineTo(-100, -140);
    ctx.lineTo(-70, -120);
    ctx.lineTo(-70, -80);
    ctx.lineTo(-20, -80);
    ctx.lineTo(-20, -170);
    ctx.lineTo(10, -200);
    ctx.lineTo(40, -170);
    ctx.lineTo(40, -90);
    ctx.lineTo(90, -90);
    ctx.lineTo(90, -130);
    ctx.lineTo(115, -150);
    ctx.lineTo(140, -130);
    ctx.lineTo(140, -60);
    ctx.lineTo(180, -60);
    ctx.lineTo(180, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  const frame = (now: number): void => {
    const t = now / 1000;
    const bg = ctx.createRadialGradient(w * 0.55, h * 0.5, 0, w * 0.55, h * 0.5, Math.max(w, h) * 0.8);
    bg.addColorStop(0, '#2c2438');
    bg.addColorStop(0.55, '#17141c');
    bg.addColorStop(1, '#0b0a0c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    fortress(w * 0.16, h * 1.0, Math.min(w, h) / 620, '#4a2f1b', 'rgba(201,130,60,0.45)', false);
    fortress(w * 0.86, h * 0.0, Math.min(w, h) / 620, '#262a33', 'rgba(170,80,60,0.4)', true);

    // rift glow
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let pass = 0; pass < 3; pass++) {
      ctx.beginPath();
      for (let i = 0; i <= 60; i++) {
        const [x, y] = riftAt(i / 60);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      const pulse = 0.55 + 0.25 * Math.sin(t * 1.3);
      ctx.strokeStyle = pass === 0 ? `rgba(150,110,230,${0.12 * pulse})` : pass === 1 ? `rgba(190,150,255,${0.25 * pulse})` : 'rgba(240,225,255,0.55)';
      ctx.lineWidth = pass === 0 ? 46 : pass === 1 ? 14 : 2;
      ctx.stroke();
    }
    ctx.restore();

    // mist motes rising from the rift
    if (motes.length < 140) {
      const [x, y] = riftAt(Math.random());
      motes.push({ x, y, r: 20 + Math.random() * 60, vy: -(6 + Math.random() * 14), vx: (Math.random() - 0.5) * 8, life: 0, max: 6 + Math.random() * 6 });
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = motes.length - 1; i >= 0; i--) {
      const m = motes[i]!;
      m.life += 1 / 60;
      m.x += m.vx / 60;
      m.y += m.vy / 60;
      const a = Math.sin((m.life / m.max) * Math.PI) * 0.09;
      if (m.life >= m.max) {
        motes.splice(i, 1);
        continue;
      }
      const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r);
      g.addColorStop(0, `rgba(170,140,220,${a})`);
      g.addColorStop(1, 'rgba(170,140,220,0)');
      ctx.fillStyle = g;
      ctx.fillRect(m.x - m.r, m.y - m.r, m.r * 2, m.r * 2);
    }
    ctx.restore();

    // vignette
    const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.65)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
  };
}
