// Typed champion registry for all roster champions (order = spec roster).
// `satisfies` checks every JSON file's shape against the widened schema (Json<ChampionData>) at compile time;
// asChampion() then checks enums, tuple and rank-array lengths and unknown keys at runtime and narrows the type.
import type { AbilityData, ChampionData } from '../../sim/champions/schema';
import { asChampion, type Json } from './validate';
import aurel from './aurel.json';
import brom from './brom.json';
import corvin from './corvin.json';
import dagny from './dagny.json';
import ferris from './ferris.json';
import gorvam from './gorvam.json';
import grimald from './grimald.json';
import hagen from './hagen.json';
import harrow from './harrow.json';
import ilvane from './ilvane.json';
import isolde from './isolde.json';
import kaelen from './kaelen.json';
import kiran from './kiran.json';
import lio from './lio.json';
import lysa from './lysa.json';
import mira from './mira.json';
import nyx from './nyx.json';
import oda from './oda.json';
import oleth from './oleth.json';
import ottilie from './ottilie.json';
import renn from './renn.json';
import seraphyne from './seraphyne.json';
import thessaly from './thessaly.json';
import tobin from './tobin.json';
import vessa from './vessa.json';
import wren from './wren.json';
import sev from './sev.json';
import fenna from './fenna.json'; // champ-support (#29)
import vargrim from './vargrim.json';

const raw = {
  ilvane,
  thessaly,
  kaelen,
  brom,
  oleth,
  mira,
  ferris,
  gorvam,
  vessa,
  nyx,
  harrow,
  seraphyne,
  renn,
  isolde,
  dagny,
  grimald,
  lio,
  ottilie,
  aurel,
  corvin,
  lysa,
  tobin,
  wren,
  hagen,
  kiran,
  oda,
  sev,
  fenna,
  vargrim,
} satisfies Record<string, Json<ChampionData>>;

export const champions: Record<string, ChampionData> = Object.fromEntries(
  Object.entries(raw).map(([id, data]) => [id, asChampion(data, `${id}.json`)]),
);

/**
 * Ability of a slot for display/render code. 0..3 = Q W E R; with `ult` >= 0 slot 3 is that chosen ultimate
 * (ChampionData.ultChoices, Sev). Virtual slots 4..6 = ultChoices[0..2] (icons, tooltips, choice cards).
 */
export function abilityForSlot(id: string, slot: number, ult = -1): AbilityData | undefined {
  const d = champions[id];
  if (!d) return undefined;
  if (slot >= 4 && slot <= 6) return d.ultChoices?.[slot - 4];
  return slot === 3 && ult >= 0 && d.ultChoices?.[ult] ? d.ultChoices[ult] : d.abilities[slot];
}

/** Display slot of the R button: 4 + chosen ultimate once chosen, else 3. */
export const ultDisplaySlot = (slot: number, chosen: number | undefined): number => (slot === 3 && chosen !== undefined && chosen >= 0 ? 4 + chosen : slot);
