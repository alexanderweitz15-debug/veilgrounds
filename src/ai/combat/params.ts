// Typed access to src/data/bots/micro.json (tunables of the combat micro layer).

import raw from '../../data/bots/micro.json';

export interface MicroParams {
  parts: Record<'aim' | 'dodge' | 'combo' | 'tick' | 'spacing' | 'focus' | 'peel', boolean>;
  aim: {
    leadNoiseDivisor: number;
    jukeLateral: number;
    jukeSpeed: number;
    jukeCircle: number;
    minConfidence: { poke: number; fight: number };
    rangeShare: number;
  };
  spacing: { safeMargin: number; punishInside: number; minRanged: number };
  focus: {
    threatBase: number;
    threatPerPower: number;
    carryBonus: number;
    frontlinePenalty: number;
    squishyShare: number;
    squishyBonus: number;
    minAccess: number;
    accessFalloff: number;
    shieldWidth: number;
    shieldedFactor: number;
    allyLowHp: number;
    retaliate: number;
    pingBonus: number;
  };
  dodge: {
    margin: number;
    holdTicks: number;
    minThreat: number;
    windupSlackTicks: number;
    persistentZoneTicks: number;
    towerPenalty: number;
    enemyPenalty: number;
    dashThreat: number;
  };
}

export const MICRO = raw as unknown as MicroParams;
