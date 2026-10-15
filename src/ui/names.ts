// Display names for champions, abilities, summoner spells and unit kinds (localized).
import { CHAMPION_DATA } from '../sim/champions';
import summoners from '../data/summoners.json';
import { settings } from '../settings';
import { Kind } from '../sim/types';
import { t } from '../i18n';

type L10n = { de: string; en: string };
const loc = (l: L10n | undefined, fallback: string): string => (l ? l[settings.lang] : fallback);

export function champName(id: string | null): string {
  if (!id) return '?';
  return CHAMPION_DATA[id]?.name ?? id.charAt(0).toUpperCase() + id.slice(1);
}

export function abilityInfo(champ: string, slot: number, fallbackId: string): { name: string; desc: string } {
  const a = CHAMPION_DATA[champ]?.abilities[slot];
  return { name: loc(a?.name, fallbackId), desc: loc(a?.desc, '') };
}

export function summonerName(id: string): string {
  const s = (summoners as { id: string; name: L10n }[]).find((x) => x.id === id);
  return loc(s?.name, id);
}

export function kindName(kind: number): string {
  const de = settings.lang === 'de';
  switch (kind) {
    case Kind.Tower:
      return de ? 'Turm' : 'Tower';
    case Kind.Inhibitor:
      return 'Inhibitor';
    case Kind.Nexus:
      return 'Nexus';
    case Kind.Dummy:
      return de ? 'Übungspuppe' : 'Practice dummy';
    case Kind.Monster:
      return de ? 'Monster' : 'Monster';
    case Kind.Plant:
      return t('unit.plant');
    default:
      return kind >= Kind.MinionMelee && kind <= Kind.MinionSuper ? (de ? 'Vasall' : 'Minion') : '?';
  }
}

/** Display name of a jungle monster / plant type (snapshot `variant`), falling back to the kind name. */
export function variantName(variant: string | undefined, kind: number): string {
  return variant ? t(`unit.${variant}`) : kindName(kind);
}
