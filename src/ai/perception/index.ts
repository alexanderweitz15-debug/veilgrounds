// Agent L perception layer (spec-bots §3). One PerceptionState per bot; call perceive() once per decision tick and
// hand the result to the behaviour tree as NodeCtx.pv (it extends the contract's PerceptionView).
export { perceive, NEAR_RANGE, isCC, isHookChamp, mainAbility } from './perceive';
export { newPerceptionState } from './types';
export type { BotPerception, PerceptionState, TrackMem, WaveInfo, IncomingCast, PosSource, AudioCue, PingMem } from './types';
export { pathThreat, threatReach } from './threat';
export { laneOf, lanePos, frontTower, waveStates } from './waves';
export { estimateStyle } from './enemyStyle';
export { trackPos, logTrack, logPos, logPoint } from './logInputs';
export * as rankModel from './rankModel';
