// Scratch (idea agent): headless measurements behind docs/IDEAS-FEEL-SHOP.md (pathfinding detours, command latency,
// collision cost, wind-up quantisation, icon glyph collisions). Run: npx tsx tools/scratch/feelMeasure.ts
import { createSim, step, type Sim } from '../../src/sim/sim';
import { findPath } from '../../src/sim/map';
import { spawnMinion } from '../../src/sim/systems/minions';
import { Kind, type SimConfig } from '../../src/sim/types';
import { windupTicks } from '../../src/sim/systems/attack';
import { championData } from '../../src/sim/champions';
import itemsJson from '../../src/data/items.json';

// No @types/node in this repo (see tools/botSim.ts).
declare const process: { stdout: { write(s: string): void } };

const NO_RUNES = { keystone: 'none', minor: ['none', 'none', 'none'] as [string, string, string] };
function makeSim(players: SimConfig['players']): Sim {
  return createSim({ seed: 1, mode: 'sandbox', minionsEnabled: false, players: players.map((p) => ({ ...p, runes: NO_RUNES })) });
}
const place = (sim: Sim, eid: number, x: number, y: number): void => {
  sim.c.Pos.x[eid] = sim.c.Pos.px[eid] = x;
  sim.c.Pos.y[eid] = sim.c.Pos.py[eid] = y;
};
const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

// ---------------------------------------------------------------- A. pathfinding cost + detours
{
  const sim = makeSim([{ slot: 0, team: 0, champion: 'mira', role: 'adc', summoners: ['sprung', 'heilen'], isHuman: true }]);
  const m = sim.map;
  const side = m.sides[0]!;
  const f0 = side.fountain;
  const tw = side.towers;
  const camp = (id: string) => side.camps.find((c) => c.id.includes(id))!;
  const routes: [string, { x: number; y: number }, { x: number; y: number }][] = [
    ['Brunnen -> Mid-Außenturm', f0, tw.mid[0]!],
    ['Brunnen -> Top-Außenturm', f0, tw.top[0]!],
    ['Brunnen -> Bot-Außenturm', f0, tw.bot[0]!],
    ['Mid-Außenturm -> Top-Außenturm (durch den Jungle)', tw.mid[0]!, tw.top[0]!],
    ['Mid-Außenturm -> Moosrudel', tw.mid[0]!, camp('moosrudel')],
    ['Moosrudel -> Glutwächter', camp('moosrudel'), camp('glutwaechter')],
    ['Dornenbock -> Hohlkäfer (quer durch den Jungle)', camp('dornenbock'), camp('hohlkaefer')],
    ['Top-Außenturm -> Leviathan-Grube', tw.top[0]!, m.objectives.leviathan],
    ['Bot-Außenturm -> Schleierwächter-Grube', tw.bot[0]!, m.objectives.schleierwaechter],
  ];
  console.log('\n== A. Pathfinding (A* 50er-Grid + String-Pulling) ==');
  console.log('Route | Luftlinie | Pfadlänge | Umweg % | Wegpunkte | ms (Median von 20)');
  for (const [name, a, b] of routes) {
    const times: number[] = [];
    let path: { x: number; y: number }[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      path = findPath(m.nav, a.x, a.y, b.x, b.y);
      times.push(performance.now() - t0);
    }
    times.sort((p, q) => p - q);
    let len = 0;
    let prev = a;
    for (const p of path) (len += dist(prev, p)), (prev = p);
    const straight = dist(a, b);
    console.log(`${name} | ${straight.toFixed(0)} | ${len.toFixed(0)} | ${((len / straight - 1) * 100).toFixed(1)} | ${path.length} | ${times[10]!.toFixed(2)}`);
  }
  // held right click: 20 repaths/s over a long route
  const a = f0;
  const b = m.sides[1]!.fountain;
  const t0 = performance.now();
  for (let i = 0; i < 100; i++) findPath(m.nav, a.x + i, a.y, b.x, b.y);
  console.log(`100x Brunnen->gegn. Brunnen: ${((performance.now() - t0) / 100).toFixed(2)} ms pro Aufruf (Hold-Rechtsklick = 20/s)`);
  console.log('Camps:', side.camps.map((c) => c.id).join(', '));
}

// ---------------------------------------------------------------- B. command -> first movement / attack ticks
{
  const sim = makeSim([
    { slot: 0, team: 0, champion: 'mira', role: 'adc', summoners: ['sprung', 'heilen'], isHuman: true },
    { slot: 1, team: 1, champion: 'brom', role: 'top', summoners: ['sprung', 'heilen'], isHuman: false },
  ]);
  const me = sim.slots[0]!;
  const foe = sim.slots[1]!;
  place(sim, me, 6000, 8750);
  place(sim, foe, 6400, 8750);
  for (let i = 0; i < 30; i++) step(sim);
  const x0 = sim.c.Pos.x[me]!;
  let ticks = 0;
  step(sim, [{ slot: 0, cmd: { t: 'move', x: 7000, y: 8750 } }]);
  ticks++;
  while (sim.c.Pos.x[me] === x0 && ticks < 10) (step(sim), ticks++);
  console.log('\n== B. Befehl -> Sim-Reaktion ==');
  console.log(`Move-Befehl -> erste Positionsänderung: ${ticks} Tick(s) (${(ticks * 33.3).toFixed(0)} ms Sim-Zeit; Schritt ${(sim.c.Pos.x[me]! - x0).toFixed(1)} u = ${sim.c.Stats.ms[me]} u/s)`);
  step(sim, [{ slot: 0, cmd: { t: 'stop' } }]);
  for (let i = 0; i < 30; i++) step(sim);
  // attack: foe in range (mira range 550)
  place(sim, me, 6000, 8750);
  place(sim, foe, 6400, 8750);
  for (let i = 0; i < 5; i++) step(sim);
  let atkStart = -1;
  let dmgTick = -1;
  const t0 = sim.tick;
  step(sim, [{ slot: 0, cmd: { t: 'attack', target: foe } }]);
  for (let i = 0; i < 60 && dmgTick < 0; i++) {
    for (const e of sim.events) {
      if (e.e === 'attack' && e.src === me && atkStart < 0) atkStart = sim.tick - t0;
      if (e.e === 'damage' && e.src === me && dmgTick < 0) dmgTick = sim.tick - t0;
    }
    step(sim);
  }
  console.log(`Attack-Befehl (in Reichweite) -> Wind-up-Start: Tick ${atkStart}, Schaden (Projektil 2000 u/s über ~400 u): Tick ${dmgTick} (windupTicks=${windupTicks(sim, me)})`);
  // orbwalk: move during backswing cancels anim only; move during windup cancels attack
  step(sim, [{ slot: 0, cmd: { t: 'attack', target: foe } }]);
  let ph: number[] = [];
  for (let i = 0; i < 12; i++) (ph.push(sim.c.Atk.phase[me]!), step(sim));
  console.log(`Atk.phase Verlauf nach Attack-Befehl (12 Ticks): ${ph.join('')}`);
}

// ---------------------------------------------------------------- C. collision: walking through a wave / champion
{
  const run = (label: string, setup: (sim: Sim, me: number) => void): void => {
    const sim = makeSim([
      { slot: 0, team: 0, champion: 'brom', role: 'top', summoners: ['sprung', 'heilen'], isHuman: true },
      { slot: 1, team: 1, champion: 'oleth', role: 'top', summoners: ['sprung', 'heilen'], isHuman: false },
    ]);
    const me = sim.slots[0]!;
    place(sim, sim.slots[1]!, 100, 100);
    place(sim, me, 5200, 8750);
    setup(sim, me);
    for (let i = 0; i < 5; i++) step(sim);
    const ms = sim.c.Stats.ms[me]!;
    const ideal = Math.ceil((1600 / ms) * 30);
    let maxDy = 0;
    let ticks = 0;
    step(sim, [{ slot: 0, cmd: { t: 'move', x: 6800, y: 8750 } }]);
    while (sim.c.Move.mode[me] !== 0 && ticks < 400) {
      step(sim);
      ticks++;
      maxDy = Math.max(maxDy, Math.abs(sim.c.Pos.y[me]! - 8750));
    }
    console.log(`${label}: ${ticks} Ticks (ideal ${ideal}, +${(((ticks - ideal) / ideal) * 100).toFixed(0)} %), max. seitliche Abweichung ${maxDy.toFixed(0)} u, Ende bei (${sim.c.Pos.x[me]!.toFixed(0)}, ${sim.c.Pos.y[me]!.toFixed(0)})`);
  };
  console.log('\n== C. Kollision beim Laufen (1600 u geradeaus, Brom ms 340) ==');
  run('freies Feld', () => {});
  run('durch eigene Welle (3 Nahkampf + 3 Caster, stehend)', (sim) => {
    const kinds = [Kind.MinionMelee, Kind.MinionMelee, Kind.MinionMelee, Kind.MinionCaster, Kind.MinionCaster, Kind.MinionCaster];
    kinds.forEach((k, i) => {
      const e = spawnMinion(sim, k, 0, 'mid' as never, 5900 + (i % 3) * 110, 8700 + Math.floor(i / 3) * 100);
      sim.c.Move.mode[e] = 0;
      sim.c.Atk.target[e] = -1;
    });
  });
  run('durch gegnerische Welle (6 Minions, stehend)', (sim) => {
    const kinds = [Kind.MinionMelee, Kind.MinionMelee, Kind.MinionMelee, Kind.MinionCaster, Kind.MinionCaster, Kind.MinionCaster];
    kinds.forEach((k, i) => {
      const e = spawnMinion(sim, k, 1, 'mid' as never, 5900 + (i % 3) * 110, 8700 + Math.floor(i / 3) * 100);
      sim.c.Move.mode[e] = 0;
      sim.c.Atk.target[e] = -1;
      sim.c.Unit.radius[e] = sim.c.Unit.radius[e]!; // keep
    });
  });
  run('gegen stehenden gegnerischen Champion (Oleth, genau auf der Linie)', (sim) => {
    place(sim, sim.slots[1]!, 6000, 8750);
  });
  run('gegen stehenden Champion, 20 u versetzt', (sim) => {
    place(sim, sim.slots[1]!, 6000, 8770);
  });
}

// ---------------------------------------------------------------- D. wind-up quantisation
{
  console.log('\n== D. Wind-up-Quantisierung (round(30*w/AS)) ==');
  console.log('Champion | windup | AS L1 | Ticks L1 (ms) | ideal ms | AS x1.6 (Items) | Ticks (ms) | ideal ms | Fehler');
  for (const id of ['mira', 'lysa', 'aurel', 'brom', 'kaelen']) {
    const d = championData(id);
    const w = d.base.windup;
    for (const mult of [1, 1.6]) {
      const as = d.base.as * mult;
      const ticks = Math.max(1, Math.round((30 * w) / as));
      const ideal = (1000 * w) / as;
      process.stdout.write(`${mult === 1 ? id : ''} | ${mult === 1 ? w : ''} | ${as.toFixed(3)} | ${ticks} (${(ticks * 33.33).toFixed(0)}) | ${ideal.toFixed(0)} | Fehler ${(ticks * 33.33 - ideal).toFixed(0)} ms${mult === 1 ? ' || ' : '\n'}`);
    }
  }
}

// ---------------------------------------------------------------- E. icon glyph collisions (rules copied from src/ui/icons.ts)
{
  type It = { id: string; tier: string; stats: Record<string, number>; name: { de: string } };
  const items = (itemsJson as unknown as { items: It[] }).items;
  const rules: [RegExp, string][] = [
    [/stiefel/, 'boot'], [/trank/, 'potion'], [/ward/, 'eye'], [/zahn/, 'fang'], [/bogen/, 'bow'], [/krone/, 'crown'],
    [/dolch/, 'dagger'], [/beil|hacke/, 'axe'], [/schwert|klinge|stahl|brecher/, 'sword'], [/kettenhemd|weste|wallherz/, 'shield'],
    [/kette/, 'chain'], [/mantel|gewand/, 'cloak'], [/stab/, 'staff'], [/buch/, 'book'], [/ring/, 'ring'], [/lampe/, 'lamp'],
    [/uhr|zeit/, 'hourglass'], [/guertel/, 'belt'], [/horn/, 'horn'], [/herz|wurzel/, 'heart'],
    [/kristall|splitter|glas|kern|schale|kelch/, 'gem'],
  ];
  const glyph = (it: It): string => {
    for (const [re, g] of rules) if (re.test(it.id)) return g;
    const st = it.stats;
    if (st.ad || st.lethality) return 'sword';
    if (st.ap) return 'staff';
    if (st.armor) return 'shield';
    if (st.mr) return 'cloak';
    return 'gem';
  };
  const hue = (it: It): string => {
    const st = it.stats;
    if (it.tier === 'boots') return 'boots';
    if (it.tier === 'consumable') return 'consumable';
    if (st.critPct || st.asPct) return 'gelb(AS/Krit)';
    if (st.ad || st.lethality) return 'rot(AD)';
    if (st.ap) return 'violett(AP)';
    if (st.mr) return 'blau(MR)';
    if (st.armor) return 'braun(Rüstung)';
    if (st.hp) return 'grün(HP)';
    if (st.mana || st.manaRegenPct || st.healShieldPowerPct) return 'türkis(Mana)';
    return 'neutral';
  };
  const groups = new Map<string, string[]>();
  for (const it of items) {
    const k = `${glyph(it)} + ${hue(it)}`;
    groups.set(k, [...(groups.get(k) ?? []), `${it.name.de} (${it.tier})`]);
  }
  console.log('\n== E. Icon-Kollisionen (gleicher Glyph + gleiche Farbgruppe) ==');
  console.log(`${items.length} Items, ${groups.size} unterscheidbare Glyph+Farbe-Kombinationen`);
  for (const [k, v] of [...groups].sort((a, b) => b[1].length - a[1].length)) if (v.length > 1) console.log(`${k}: ${v.length} -> ${v.join(', ')}`);
  const tiers = new Map<string, number>();
  for (const it of items) tiers.set(it.tier, (tiers.get(it.tier) ?? 0) + 1);
  console.log('Items pro Tier:', [...tiers].map(([k, v]) => `${k} ${v}`).join(', '));
}
