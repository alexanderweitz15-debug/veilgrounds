// Scratch: print the ability motif per champion and slot (D1 audit helper). Run: npx tsx tools/scratch/motifs.ts
import { abilityTheme } from '../../src/render/abilityTheme';
import { champions } from '../../src/data/champions';

for (const id of Object.keys(champions)) {
  console.log(id.padEnd(10), [0, 1, 2, 3].map((s) => { const t = abilityTheme(id, s); return (t ? `${t.motif}/${t.hue}` : '-').padEnd(12); }).join(' '));
}
