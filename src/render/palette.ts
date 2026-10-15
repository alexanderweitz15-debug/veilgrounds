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

/** Relation colours for readability (rings, bars, projectiles). */
export const REL = {
  me: '#e8d25a',
  ally: '#4aa6e8',
  enemy: '#e0473a',
  ownShot: '#58b8ff',
  enemyShot: '#ff4a2e',
};
