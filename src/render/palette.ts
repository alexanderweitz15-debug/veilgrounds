// placeholder art: colour palette. Lichtwerk = copper/ivory/brass, Aschehalle = slate/rust/coal.
export interface TeamPalette {
  primary: string;
  secondary: string;
  accent: string;
  dark: string;
  glow: string;
  stone: string;
}

export const TEAM: [TeamPalette, TeamPalette] = [
  { primary: '#b8693a', secondary: '#efe6cf', accent: '#d9ad4c', dark: '#3b2a1d', glow: '#ffd889', stone: '#c9b994' },
  { primary: '#4d5662', secondary: '#a5492a', accent: '#2a2a30', dark: '#16161a', glow: '#ff6a3a', stone: '#5a5c66' },
];

export const INK = '#1b1612';

/**
 * Team identity of structures and bases (style C), matching the minion looks (render/champions/minions.ts):
 * Lichtwerk = ivory sandstone, blue cloth, brass, cold lantern light; Aschehalle = basalt, red cloth, iron, embers.
 */
export const BASE_LOOK = [
  { stone: '#a3937a', stoneDark: '#7c6e5a', cloth: '#3f66ad', clothDark: '#2b3f68', metal: '#c9973f', metal2: '#b0683c', roof: '#41689e', glow: '#bfe4ff', fire: '#ffe2a0' },
  { stone: '#5a5862', stoneDark: '#3c3a44', cloth: '#a8382a', clothDark: '#5a221c', metal: '#5d6470', metal2: '#3e3c44', roof: '#2a272e', glow: '#ff8a3a', fire: '#ff7a2a' },
] as const;

/** Relation colours (rings, bars, projectiles, telegraphs, minimap, pings). Mutated in place by applyColorMode. */
export interface RelPalette {
  me: string;
  ally: string;
  enemy: string;
  ownShot: string;
  enemyShot: string;
  /** Own champion's health bar. */
  meBar: string;
  /** Champion name labels above the bars. */
  allyText: string;
  enemyText: string;
  /** Click markers (move / attack command). */
  moveClick: string;
  attackClick: string;
  /** Homing projectile cores. */
  ownHoming: string;
  enemyHoming: string;
}

/**
 * Palettes per colour mode. Deuteranopia/protanopia (red-green): sky blue vs vermillion/orange with clearly
 * different lightness (Okabe-Ito); tritanopia (blue-yellow): teal vs magenta-red, self bright lime instead of yellow.
 */
export const REL_PALETTES: Record<'normal' | 'deuteranopia' | 'protanopia' | 'tritanopia', RelPalette> = {
  normal: {
    me: '#e8d25a', ally: '#4aa6e8', enemy: '#e0473a', ownShot: '#58b8ff', enemyShot: '#ff4a2e',
    meBar: '#59d35a', allyText: '#cfe0ff', enemyText: '#ffc9bd', moveClick: '#7dff8a', attackClick: '#ff5a3c',
    ownHoming: '#bfe4ff', enemyHoming: '#ffc29a',
  },
  deuteranopia: {
    me: '#f0e442', ally: '#56b4e9', enemy: '#e07000', ownShot: '#7cc8ff', enemyShot: '#ff8c00',
    meBar: '#f0e442', allyText: '#cfe6ff', enemyText: '#ffd2a0', moveClick: '#9fd8ff', attackClick: '#ff8c00',
    ownHoming: '#cfeaff', enemyHoming: '#ffd09a',
  },
  protanopia: {
    me: '#f0e442', ally: '#3d8fe0', enemy: '#e69f00', ownShot: '#6cb4ff', enemyShot: '#ffb000',
    meBar: '#f0e442', allyText: '#cfe0ff', enemyText: '#ffe0a0', moveClick: '#9fd8ff', attackClick: '#ffb000',
    ownHoming: '#cfe4ff', enemyHoming: '#ffe0a0',
  },
  tritanopia: {
    me: '#ffffff', ally: '#1fb8a8', enemy: '#e8336b', ownShot: '#3fd8c8', enemyShot: '#ff3f7a',
    meBar: '#b8f04a', allyText: '#c8fff6', enemyText: '#ffc8da', moveClick: '#3fd8c8', attackClick: '#ff3f7a',
    ownHoming: '#c8fff6', enemyHoming: '#ffc8da',
  },
};

export const REL: RelPalette = { ...REL_PALETTES.normal };

export function applyColorMode(mode: keyof typeof REL_PALETTES): void {
  Object.assign(REL, REL_PALETTES[mode] ?? REL_PALETTES.normal);
}
