// UI strings. German is the default; English via settings.lang.
import de from './de.json';
import en from './en.json';
import { settings } from '../settings';

const tables: Record<'de' | 'en', Record<string, string>> = { de, en };

/** Translate key, substituting {name} placeholders. Falls back to German, then the key itself. */
export function t(key: string, vars?: Record<string, string | number>): string {
  let s = tables[settings.lang][key] ?? de[key as keyof typeof de] ?? key;
  if (vars) for (const k in vars) s = s.split(`{${k}}`).join(String(vars[k])); // every occurrence
  return s;
}
