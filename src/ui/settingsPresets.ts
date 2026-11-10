// Gameplay setting presets (one click in the settings panel): beginner (aids on), LoL standard, competitive (aids off).
// Only touches the keys listed here; graphics, audio, language and keybinds stay as they are.
import type { Settings } from '../settings';

export type PresetId = 'beginner' | 'standard' | 'pro';

export const PRESETS: Record<PresetId, Partial<Settings>> = {
  beginner: { castIndicator: true, attackMoveOnCursor: false, attackMoveNearCursor: true, lolTelegraphs: false, enemySkillshotOutline: true, damageNumbers: true, voiceLines: true, trainingHud: 'auto', cameraLocked: true, cameraSemiLock: false },
  standard: { castIndicator: true, attackMoveOnCursor: false, attackMoveNearCursor: false, lolTelegraphs: false, enemySkillshotOutline: false, damageNumbers: true, voiceLines: true, trainingHud: 'auto', cameraLocked: false, cameraSemiLock: false },
  pro: { castIndicator: false, attackMoveOnCursor: true, attackMoveNearCursor: true, lolTelegraphs: true, enemySkillshotOutline: false, damageNumbers: false, voiceLines: false, trainingHud: 'off', cameraLocked: false, cameraSemiLock: false },
};
