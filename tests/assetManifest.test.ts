// Asset manifest: every sprite id the game draws has a painter and frames; missing ones are reported, not silent.
import './loaderEnv';
import { describe, expect, it, vi } from 'vitest';
import { champions } from '../src/data/champions';
import { buildManifest, idsOf, validateManifest, type AssetEntry } from '../src/render/loader/manifest';
import { planAtlas, rendererOf } from '../src/render/champions/atlas';

// Champions that are on the roster (sim data) but have no sprite kit yet. The test lists them on purpose: the game
// draws them as the checkerboard (never an invisible unit), and a new entry here must be a conscious decision.
// fenna: WIP champion (docs: "champ-support #29"), art pending (agent A26).
const KNOWN_WITHOUT_ART = ['fenna'];

describe('asset manifest', () => {
  const manifest = buildManifest();

  it('lists every roster champion, Hark, the minions, monsters and plants', () => {
    for (const id of Object.keys(champions)) expect(manifest.find((e) => e.id === id)?.kind).toBe('champion');
    expect(manifest.find((e) => e.id === 'hark')?.kind).toBe('pet');
    expect(manifest.filter((e) => e.kind === 'minion')).toHaveLength(8);
    expect(manifest.filter((e) => e.kind === 'plant').map((e) => e.id).sort()).toEqual(['honigfrucht', 'spaehfrucht', 'sprungfrucht']);
    expect(idsOf('monstersBig')).toContain('leviathan');
    expect(new Set(manifest.map((e) => e.id)).size).toBe(manifest.length); // ids are unique across atlases
  });

  it('every roster champion has a kit and frames for every animation (except the known art gaps)', () => {
    const issues = validateManifest(manifest.filter((e) => e.kind === 'champion')).filter((i) => i.kind === 'champion');
    const gaps = issues.filter((i) => i.problem === 'no-renderer').map((i) => i.id).sort();
    expect(gaps).toEqual(KNOWN_WITHOUT_ART);
    // everything else must be fully valid: renderer allowed for the kind, >0 frames per required anim
    expect(issues.filter((i) => !KNOWN_WITHOUT_ART.includes(i.id))).toEqual([]);
  });

  it('minions, monsters, plants and Hark are valid, and every sim monster type resolves to a baked sprite', () => {
    expect(validateManifest(manifest).filter((i) => !KNOWN_WITHOUT_ART.includes(i.id))).toEqual([]);
  });

  it('reports a missing renderer and an animation without frames', () => {
    const fake: AssetEntry[] = [
      { id: 'ghost-champ', kind: 'champion', atlas: 'champions', renderers: ['kit'], requiredAnims: ['idle'] },
      { id: 'mira', kind: 'champion', atlas: 'champions', renderers: ['kit'], requiredAnims: ['idle', 'cast'] },
      { id: 'melee0', kind: 'minion', atlas: 'minions', renderers: ['kit', 'drawer'], requiredAnims: ['cast'] }, // minions have no cast
    ];
    const issues = validateManifest(fake).filter((i) => i.problem !== 'unmapped-variant');
    expect(issues.map((i) => `${i.id}:${i.problem}`)).toEqual(['ghost-champ:no-renderer', 'melee0:no-frames']);
  });

  it('reports a sim type that has no sprite', () => {
    const issues = validateManifest(manifest.filter((e) => e.id !== 'leviathan'));
    expect(issues.some((i) => i.problem === 'unmapped-variant' && i.id === 'leviathan')).toBe(true);
  });
});

describe('atlas without a painter for an id', () => {
  it('does not bake the unknown id (the painter would throw and take the whole atlas down) but keeps a placeholder slot', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(rendererOf('fenna')).toBeNull();
    const p = planAtlas(['mira', 'fenna'], { frame: 128, maxSize: 4096 });
    expect(p.list).toEqual(['mira']);
    expect(p.missing).toEqual(['fenna']);
    expect(p.jobs.every((j) => j.id === 'mira')).toBe(true);
    // the checkerboard cell is the one after the last job and lies inside the grid
    expect(p.placeholderCell).toBe(p.jobs.length);
    expect(Math.floor(p.placeholderCell / p.perRow) * p.frame + p.frame).toBeLessThanOrEqual(p.height);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("'fenna' has no renderer"));
    warn.mockRestore();
  });
});
