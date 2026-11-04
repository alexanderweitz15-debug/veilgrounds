// A4 VFX: loads every effects/*.json at build time (Vite glob), validates it and keeps the valid ones in a stable
// order (sorted by id; the index is the row in the GPU curve table). A broken file is skipped with a warning at
// runtime; tests/vfx.test.ts demands `VFX_ERRORS` to be empty.
import { validateEffect, type EffectDef } from './schema';

const files = import.meta.glob('./effects/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

const defs: EffectDef[] = [];
export const VFX_ERRORS: string[] = [];
for (const path of Object.keys(files).sort()) {
  const where = path.replace('./effects/', '');
  const raw = files[path];
  const v = validateEffect(raw, where);
  const expectId = where.replace(/\.json$/, '');
  if (v.def && v.def.id !== expectId) v.errors.push(`${where}: id "${v.def.id}" must equal the file name "${expectId}"`);
  if (v.def && !v.errors.length) defs.push(v.def);
  else {
    VFX_ERRORS.push(...v.errors);
    console.warn(`[vfx] ${v.errors.join('; ')}`);
  }
}
defs.sort((a, b) => (a.id < b.id ? -1 : 1));

/** All valid effect definitions, index = effect handle. */
export const EFFECTS: readonly EffectDef[] = defs;
const byId = new Map<string, number>(defs.map((d, i) => [d.id, i]));

/** Effect handle of an id, -1 if unknown. Use the handle in hot paths. */
export const effectHandle = (id: string): number => byId.get(id) ?? -1;
export const effectDef = (id: string): EffectDef | undefined => {
  const i = byId.get(id);
  return i === undefined ? undefined : defs[i];
};
