// Typed champion registry for all 27 roster champions (order = spec roster).
// `satisfies` checks every JSON file's shape against the widened schema (Json<ChampionData>) at compile time;
// asChampion() then checks enums, tuple and rank-array lengths and unknown keys at runtime and narrows the type.
import type { ChampionData } from '../../sim/champions/schema';
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
} satisfies Record<string, Json<ChampionData>>;

export const champions: Record<string, ChampionData> = Object.fromEntries(
  Object.entries(raw).map(([id, data]) => [id, asChampion(data, `${id}.json`)]),
);
