// A4 VFX: public surface of src/render/vfx (docs/VFX-FORMAT.md).
export { VfxSystem, buildCurveTable, type EmitOpts, type VfxStats, type VfxTeam } from './system';
export { VfxBus, type Binding, type VfxEvent } from './bus';
export { EFFECTS, VFX_ERRORS, effectDef, effectHandle } from './registry';
export { CLASS_CAP, CLASS_FRAME_BUDGET, VFX_CLASSES, validateEffect, type EffectDef, type VfxClass } from './schema';
export { RENDER_ORDER, coversEnemyTelegraph, telegraphOrder } from './order';
