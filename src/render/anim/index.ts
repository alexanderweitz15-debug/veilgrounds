// Animation system (A3): data table, per-unit state machine and event bus. See docs/ANIM-FORMAT.md.
export * from './types';
export { ANIM_OVERRIDES, DEFAULT_REF_SPEED, applyRateOverrides, buildClipSet, defaultEvents, hitOverride, layoutKey, validateClipSet, type AnimOverride, type ClipBase, type ClipOverride } from './data';
export { AnimEventBus, animEvents } from './events';
export { CAST_AFTER_MS, CC_INTERRUPT, FLINCH, FLINCH_MS, STOP_GRACE_MS, TICK_MS, UnitAnim, newInput, type AnimInput, type AnimSink } from './machine';
