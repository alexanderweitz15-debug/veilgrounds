// Struct-of-arrays components, one set per Sim instance (bitecs 0.4 worlds are independent, so several sims
// can run side by side: replay verification, "what would a Challenger do" ghost runs, headless bot-sim).

export const MAX_ENT = 4096;

const f64 = (): Float64Array => new Float64Array(MAX_ENT);
const i32 = (): Int32Array => new Int32Array(MAX_ENT);
const u8 = (): Uint8Array => new Uint8Array(MAX_ENT);

export function createComponents() {
  return {
    /** Position in map units. Map is 16000 x 16000, origin bottom-left (Lichtwerk), y up. */
    Pos: { x: f64(), y: f64(), px: f64(), py: f64() /* previous tick, for render interpolation */ },
    /** Facing as unit vector (used for cast prediction by bots and sprite direction). */
    Face: { x: f64(), y: f64() },
    Unit: {
      kind: u8(),
      team: u8(),
      lane: u8(),
      /** Monotonic spawn serial; refs that may outlive the target store (eid, serial). */
      serial: i32(),
      alive: u8(),
      /** Index into sim.championIds for champions, -1 otherwise. */
      champ: i32(),
      /** Player slot for champions (0..9), -1 otherwise. */
      slot: i32(),
      radius: f64(),
      untargetable: u8(),
      invulnerable: u8(),
      /** Monster / plant type: index into VARIANTS (types.ts), 0 otherwise. */
      variant: u8(),
    },
    Hp: { cur: f64(), max: f64(), regen: f64() /* per second */, shield: f64() },
    Mana: { cur: f64(), max: f64(), regen: f64() },
    /** Final (computed) stats. Base + level growth + items + buffs is recomputed by the stats system. */
    Stats: {
      ad: f64(),
      bonusAd: f64(),
      ap: f64(),
      armor: f64(),
      mr: f64(),
      /** Attacks per second, final. */
      as: f64(),
      range: f64(),
      ms: f64(),
      crit: f64(),
      lethality: f64(),
      armorPenPct: f64(),
      magicPen: f64(),
      lifesteal: f64(),
      haste: f64(),
      /** Wind-up as fraction of attack time (champion data). */
      windup: f64(),
      tenacity: f64(),
    },
    /** Movement intent. mode: 0 idle, 1 walking a path (sim.paths), 2 chasing target (Atk.target). */
    Move: { mode: u8(), tx: f64(), ty: f64(), pathIdx: i32() },
    /** Auto-attack state machine. phase: 0 idle, 1 windup, 2 backswing. */
    Atk: {
      target: i32(),
      targetSerial: i32(),
      phase: u8(),
      phaseEnd: i32(), // tick when current phase ends
      nextReady: i32(), // tick when next attack may start (attack timer)
      attackMove: u8(),
      amx: f64(),
      amy: f64(),
    },
    /** Champion progression. */
    Champ: { level: u8(), xp: f64(), gold: f64(), totalGold: f64(), cs: i32(), skillPoints: u8(), respawnAt: i32(), recallAt: i32() },
    /** Last damage source, for last-hit credit and assists. */
    LastHit: { eid: i32(), serial: i32(), tick: i32() },
    Vision: { r: f64() },
    /** Structures: tier 0 outer, 1 inner, 2 inhib tower, 3 nexus tower; plates left (outer only). */
    Tower: { tier: u8(), plates: u8(), lastTarget: i32(), shotsOnSame: i32() },
    /**
     * Projectiles (own entities, no Unit.alive semantics). kind: 0 homing (auto), 1 line skillshot, 2 targeted ability.
     * Damage payload is resolved by the owner system through payload id in sim.payloads.
     */
    Proj: {
      kind: u8(),
      src: i32(),
      srcSerial: i32(),
      target: i32(),
      targetSerial: i32(),
      team: u8(),
      speed: f64(),
      dx: f64(),
      dy: f64(),
      width: f64(),
      maxDist: f64(),
      travelled: f64(),
      payload: i32(),
    },
  };
}

export type Components = ReturnType<typeof createComponents>;
