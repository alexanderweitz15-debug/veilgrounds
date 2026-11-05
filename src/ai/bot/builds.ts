// Build index (src/data/builds/<champ>.json). Static imports: import.meta.glob is unavailable under tsx.
import aurel from '../../data/builds/aurel.json';
import brom from '../../data/builds/brom.json';
import corvin from '../../data/builds/corvin.json';
import dagny from '../../data/builds/dagny.json';
import ferris from '../../data/builds/ferris.json';
import gorvam from '../../data/builds/gorvam.json';
import grimald from '../../data/builds/grimald.json';
import hagen from '../../data/builds/hagen.json';
import harrow from '../../data/builds/harrow.json';
import ilvane from '../../data/builds/ilvane.json';
import isolde from '../../data/builds/isolde.json';
import kaelen from '../../data/builds/kaelen.json';
import kiran from '../../data/builds/kiran.json';
import lio from '../../data/builds/lio.json';
import lysa from '../../data/builds/lysa.json';
import mira from '../../data/builds/mira.json';
import nyx from '../../data/builds/nyx.json';
import oda from '../../data/builds/oda.json';
import oleth from '../../data/builds/oleth.json';
import ottilie from '../../data/builds/ottilie.json';
import renn from '../../data/builds/renn.json';
import seraphyne from '../../data/builds/seraphyne.json';
import sev from '../../data/builds/sev.json';
import fenna from '../../data/builds/fenna.json'; // champ-support (#29)
import gneis from '../../data/builds/gneis.json'; // swarm champs-a
import kerrin from '../../data/builds/kerrin.json';
import henrike from '../../data/builds/henrike.json';
import thessaly from '../../data/builds/thessaly.json';
import tobin from '../../data/builds/tobin.json';
import vargrim from '../../data/builds/vargrim.json';
import knarr from '../../data/builds/knarr.json';
import truda from '../../data/builds/truda.json';
import marga from '../../data/builds/marga.json';
import torben from '../../data/builds/torben.json';
import svea from '../../data/builds/svea.json';
import rovena from '../../data/builds/rovena.json';
import dorrak from '../../data/builds/dorrak.json';
import tilda from '../../data/builds/tilda.json';
import vessa from '../../data/builds/vessa.json';
import wren from '../../data/builds/wren.json';

export interface BuildVariant { boots: string; core: string[] }
export interface BuildData { champion: string; starter: string[]; standard: BuildVariant; vsAD?: BuildVariant; vsAP?: BuildVariant }

export const BUILDS: Record<string, BuildData> = { aurel, brom, corvin, dagny, ferris, gorvam, grimald, hagen, harrow, ilvane, isolde, kaelen, kiran, lio, lysa, mira, nyx, oda, oleth, ottilie, renn, seraphyne, sev, fenna, rovena, dorrak, tilda, gneis, kerrin, henrike, thessaly, tobin, vargrim, vessa, wren, svea, truda, knarr, marga, torben };
