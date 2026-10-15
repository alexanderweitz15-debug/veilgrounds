// The three art-direction variants. Everything the renderers need is data here; figures.ts / scene.ts / minimap.ts
// read it. Team colours keep spec §11 (Lichtwerk copper/ivory/brass, Aschehalle slate/rust/coal); Aschehalle's
// rust is pushed brown in every variant so warm signal red stays reserved for enemy skillshots.

export type VariantId = 'A' | 'B' | 'C';

export interface TeamColors {
  primary: string; // body / large masses
  secondary: string; // cloth / second mass
  accent: string; // trim, metal
  dark: string; // legs, shadows of the team
  glow: string; // lamps, embers
  stone: string; // plinths
}

export interface SpriteStyle {
  ink: string;
  lw: number; // outline width in a 256 px cell
  /** Form shadow: shift of the lit copy (px) and how shadows are filled. */
  shadeShift: number;
  shadeMode: 'hatch' | 'flat' | 'paint';
  shade(base: string): string;
  lit(base: string): string;
  /** Rim light on the lit (upper-right) edge; null = none. */
  rim: { color: string; w: number; all: boolean } | null;
  /** Specular accent, only on metal / glass (spec §11). */
  spec: string;
  /** Proportions: x/y scale around the feet (B stockier, C taller). */
  chunk: [number, number];
  skin: string;
}

export interface WorldStyle {
  background: string;
  /** 3D shading mode: hatch = engraving shader, flat = faceted lambert, paint = 3-step toon with cool shadows + rim. */
  mode: 'hatch' | 'flat' | 'paint';
  outline: { structures: number; terrain: number; color: string } | null;
  sun: { color: string; intensity: number; dir: [number, number, number] };
  hemi: { sky: string; ground: string; intensity: number };
  softShadows: boolean;
  paper: string; // A: paper tone mixed into everything; others: unused-ish base
  shadowTint: string; // C: colour shadows shift toward
  rimColor: string; // C: fresnel rim colour
  fog: { color: string; near: number; far: number } | null;
  ground: {
    grass: string;
    grassDark: string;
    lane: string;
    laneEdge: string;
    river: string;
    riverLight: string;
    riftDeep: string;
    riftGlow: string;
    plaza: [string, string];
    rock: string;
    rockDark: string;
    bush: [string, string];
    tree: [string, string];
    trunk: string;
  };
  mist: string;
  /** Proportions of structures: [width, height] multipliers and radial segments. */
  structure: { w: number; h: number; seg: number };
}

export interface Variant {
  id: VariantId;
  name: string;
  tagline: string;
  team: [TeamColors, TeamColors];
  sprite: SpriteStyle;
  world: WorldStyle;
  swatches: { name: string; hex: string }[];
  notes: string[];
}

/** Relation colours stay identical in all variants (gameplay layer, spec §11). */
export const REL = { me: '#e8d25a', ally: '#4aa6e8', enemy: '#e0473a', ownShot: '#58b8ff', enemyShot: '#ff4a2e' };

const mixc = (a: string, b: string, t: number): string => {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const A = p(a);
  const B = p(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i]! - v) * t).toString(16).padStart(2, '0')).join('');
};

// ------------------------------------------------------------------------------------------------ A
const A: Variant = {
  id: 'A',
  name: 'Kupferstich',
  tagline: 'Tusche & Schraffur auf Papier – Stich-/Holzschnitt-Look',
  team: [
    { primary: '#b0653a', secondary: '#f1e6cb', accent: '#c49a3e', dark: '#4a3424', glow: '#ffe7a6', stone: '#d8c9a4' },
    { primary: '#5a6170', secondary: '#7e4a33', accent: '#2c2a2e', dark: '#1f1d22', glow: '#ffb24a', stone: '#8d8a84' },
  ],
  sprite: {
    ink: '#1d1712',
    lw: 9,
    shadeShift: 14,
    shadeMode: 'hatch',
    shade: (b) => mixc(b, '#1d1712', 0.12),
    lit: (b) => mixc(b, '#f3e9d2', 0.12),
    rim: null,
    spec: '#fffaf0',
    chunk: [1, 1],
    skin: '#ecd3b0',
  },
  world: {
    background: '#cbbd98',
    mode: 'hatch',
    outline: { structures: 10, terrain: 9, color: '#1d1712' },
    sun: { color: '#fff6e8', intensity: 2.5, dir: [0.55, 0.75, 0.38] },
    hemi: { sky: '#fff8ea', ground: '#d8ccb0', intensity: 1.0 },
    softShadows: false,
    paper: '#efe4c8',
    shadowTint: '#3a3040',
    rimColor: '#ffffff',
    fog: null,
    ground: {
      grass: '#a9ad84',
      grassDark: '#8e9468',
      lane: '#ebdcb8',
      laneEdge: '#c9b68c',
      river: '#b4c0bf',
      riverLight: '#dfe4de',
      riftDeep: '#2a2230',
      riftGlow: '#9d8bb8',
      plaza: ['#e2d3b0', '#bdb3a2'],
      rock: '#c7bc9f',
      rockDark: '#9c937c',
      bush: ['#7f8b5c', '#96a06c'],
      tree: ['#7a8758', '#909b68'],
      trunk: '#7b5a3c',
    },
    mist: '#8e7fa8',
    structure: { w: 1, h: 1, seg: 8 },
  },
  swatches: [
    { name: 'Papier', hex: '#efe4c8' },
    { name: 'Tusche', hex: '#1d1712' },
    { name: 'Kupfer', hex: '#b0653a' },
    { name: 'Elfenbein', hex: '#f1e6cb' },
    { name: 'Messing', hex: '#c49a3e' },
    { name: 'Schiefer', hex: '#5a6170' },
    { name: 'Rost (braun)', hex: '#7e4a33' },
    { name: 'Kohle', hex: '#2c2a2e' },
    { name: 'Moos', hex: '#a9ad84' },
    { name: 'Fluss', hex: '#b4c0bf' },
    { name: 'Schleier', hex: '#8e7fa8' },
  ],
  notes: [
    'Alles sitzt auf warmem Papier; Ton entsteht nur durch Tusche-Schraffur (1–3 Lagen), nicht durch Farbverlauf.',
    'Dicke Tuschekontur (9 px/256) auf Einheiten UND Gelände; Licht kommt von oben rechts.',
    'Glanzlicht nur auf Metall/Glas: weißer Strich auf Messing, Klingen, Glocke, Glasarm.',
    'Teams: Lichtwerk rund (Kuppeln, Rundschilde), Aschehalle kantig (Keile, Dornen).',
  ],
};

// ------------------------------------------------------------------------------------------------ B
const B: Variant = {
  id: 'B',
  name: 'Werkstatt-Lowpoly',
  tagline: 'Weiche Flächen, klobige Formen – Gelände ohne Kontur, Einheiten mit Kontur',
  team: [
    { primary: '#d2875a', secondary: '#f7efdc', accent: '#e4b65a', dark: '#6a4632', glow: '#fff1b8', stone: '#e6dac0' },
    { primary: '#6b7587', secondary: '#9a5e46', accent: '#3d3e48', dark: '#2c2d36', glow: '#ffb85a', stone: '#9b9a98' },
  ],
  sprite: {
    ink: '#2b2430',
    lw: 7,
    shadeShift: 9,
    shadeMode: 'flat',
    shade: (b) => mixc(mixc(b, '#2b2440', 0.22), b, 0.15),
    lit: (b) => b,
    rim: null,
    spec: '#ffffff',
    chunk: [1.1, 0.92],
    skin: '#f0cfa8',
  },
  world: {
    background: '#a7c1c8',
    mode: 'flat',
    outline: null,
    sun: { color: '#fff1dc', intensity: 2.1, dir: [0.5, 0.78, 0.42] },
    hemi: { sky: '#dfe9ff', ground: '#bfae8c', intensity: 1.55 },
    softShadows: true,
    paper: '#f4ecd8',
    shadowTint: '#5a5a80',
    rimColor: '#ffffff',
    fog: null,
    ground: {
      grass: '#8fa572',
      grassDark: '#7a935f',
      lane: '#dcc79a',
      laneEdge: '#c8b083',
      river: '#8fbfcc',
      riverLight: '#cfe6ea',
      riftDeep: '#3b3150',
      riftGlow: '#a894d8',
      plaza: ['#e3d6b8', '#a9a8a8'],
      rock: '#b8ae9a',
      rockDark: '#978d7a',
      bush: ['#5f8a5a', '#6f9a63'],
      tree: ['#6c9660', '#82a86d'],
      trunk: '#8a6446',
    },
    mist: '#b8a8d8',
    structure: { w: 1.15, h: 0.86, seg: 6 },
  },
  swatches: [
    { name: 'Kontur', hex: '#2b2430' },
    { name: 'Kupfer', hex: '#d2875a' },
    { name: 'Elfenbein', hex: '#f7efdc' },
    { name: 'Messing', hex: '#e4b65a' },
    { name: 'Schiefer', hex: '#6b7587' },
    { name: 'Rost (braun)', hex: '#9a5e46' },
    { name: 'Kohle', hex: '#3d3e48' },
    { name: 'Moos', hex: '#8fa572' },
    { name: 'Weg', hex: '#dcc79a' },
    { name: 'Fluss', hex: '#8fbfcc' },
    { name: 'Schleier', hex: '#b8a8d8' },
  ],
  notes: [
    'Gelände: facettiertes Lowpoly mit Flächenfarben, KEINE Kontur, weiche Schatten, viel Himmelslicht.',
    'Einheiten: 7 px Kontur in dunklem Pflaume statt Schwarz, zwei Töne, kleine Lichtkante oben rechts.',
    'Proportionen gestaucht (klobig, Kopf groß) – liest sich wie Spielfiguren auf einem Brett.',
    'Fluss ist eingetieft, der Riss ein echtes Loch im Plateau – Höhe statt Textur erzählt das Gelände.',
  ],
};

// ------------------------------------------------------------------------------------------------ C
const C: Variant = {
  id: 'C',
  name: 'Gouache-Dämmerung',
  tagline: 'Harte Schattenformen, kühle Schatten, warmes Randlicht – Abendstimmung',
  team: [
    { primary: '#c46d3c', secondary: '#f2dfbd', accent: '#e2a944', dark: '#4a2e22', glow: '#ffd98a', stone: '#b9a283' },
    { primary: '#4c5566', secondary: '#7c4632', accent: '#24222a', dark: '#17151b', glow: '#ff9e45', stone: '#5e5c66' },
  ],
  sprite: {
    ink: '#1a1420',
    lw: 6,
    shadeShift: 26,
    shadeMode: 'paint',
    shade: (b) => mixc(mixc(b, '#000000', 0.45), '#3a2d5a', 0.32),
    lit: (b) => mixc(b, '#ffd9a8', 0.1),
    rim: { color: '#ffbf72', w: 6, all: true },
    spec: '#fff4dc',
    chunk: [0.94, 1.06],
    skin: '#e8c29a',
  },
  world: {
    background: '#221c2c',
    mode: 'paint',
    outline: { structures: 6, terrain: 5, color: '#1a1420' },
    sun: { color: '#ffb877', intensity: 2.9, dir: [0.74, 0.42, -0.4] },
    hemi: { sky: '#7a68b0', ground: '#2c2a22', intensity: 1.05 },
    softShadows: false,
    paper: '#f2dfbd',
    shadowTint: '#3a2d5a',
    rimColor: '#ffbf72',
    fog: { color: '#2a2338', near: 3200, far: 7400 },
    ground: {
      grass: '#55613f',
      grassDark: '#434f33',
      lane: '#9c8158',
      laneEdge: '#77633f',
      river: '#6f7f99',
      riverLight: '#e3ad87',
      riftDeep: '#130f1a',
      riftGlow: '#a58ae0',
      plaza: ['#8f7d64', '#545565'],
      rock: '#6e6656',
      rockDark: '#4b4639',
      bush: ['#2f4a3e', '#3b5a45'],
      tree: ['#2e4536', '#3b5640'],
      trunk: '#4a3426',
    },
    mist: '#9a86c8',
    structure: { w: 0.92, h: 1.14, seg: 8 },
  },
  swatches: [
    { name: 'Nacht-Tusche', hex: '#1a1420' },
    { name: 'Schattenviolett', hex: '#3a2d5a' },
    { name: 'Randlicht', hex: '#ffbf72' },
    { name: 'Kupfer', hex: '#c46d3c' },
    { name: 'Elfenbein', hex: '#f2dfbd' },
    { name: 'Messing', hex: '#e2a944' },
    { name: 'Schiefer', hex: '#4c5566' },
    { name: 'Rost (braun)', hex: '#7c4632' },
    { name: 'Kohle', hex: '#24222a' },
    { name: 'Moos', hex: '#55613f' },
    { name: 'Fluss', hex: '#6f7f99' },
    { name: 'Schleier', hex: '#9a86c8' },
  ],
  notes: [
    'Tiefe Abendsonne von hinten rechts (halbes Gegenlicht): lange Schlagschatten zur Kamera, Schatten kippen nach kühlem Violett statt Schwarz.',
    'Große, harte Schattenformen (halber Körper) + warmes Randlicht trennt Figuren vom dunklen Grund.',
    'Gelände dunkel und entsättigt, Einheiten hell und gesättigt – stärkste Werthierarchie der drei.',
    'Schleier leuchtet: der Riss ist die hellste Fläche der Umgebung und damit Landmarke.',
  ],
};

export const VARIANTS: Variant[] = [A, B, C];
