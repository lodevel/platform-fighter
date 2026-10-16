/** Independent historical-export preparation. Not registered or consumed by
 * Character. Export patch/binary provenance and native update order remain
 * unresolved; these helpers do not qualify a production recovery. */
export interface PikachuQuickAttackParameters {
  readonly stickThreshold: number;
  readonly speedAdd: number;
  readonly speedMultiplier: number;
  readonly secondSpeedMultiplier: number;
  readonly secondAngleDegrees: number;
  readonly moveCounterInitial: number;
}

export const PIKACHU_QUICK_ATTACK_HISTORICAL_SOURCE = Object.freeze({
  url: 'https://docs.google.com/spreadsheets/d/1rwDPL1jhE-KuEbbcBkkTb44z1smJp9rYme_xb4BIJTk/edit#gid=1036933026',
  csvSha256: '8e7cf2ce2e4f21ae77f607ab775d4cdaefdc54b4a9c73f130861029d8f61285f',
  gamePatch: null,
  productionQualified: false,
  statusRevision: '413d42149b8a4d74c71bf9bd955d747b496e7577',
  fields: Object.freeze({ stickThreshold: '0x16f738d149', speedAdd: '0x1800709950',
    speedMultiplier: '0x1ae6b40717', secondSpeedMultiplier: '0x17d4b439f9',
    secondAngleDegrees: '0x172b6d941c', moveCounterInitial: '0x157cbabb70' }),
});

/** Exact Ultimate-column values from the preserved CSV; explicitly passed to
 * helpers, never implicit runtime defaults or current/native parity claims. */
export const PIKACHU_QUICK_ATTACK_HISTORICAL_PARAMETERS: PikachuQuickAttackParameters = Object.freeze({
  stickThreshold: 0.5, speedAdd: 11, speedMultiplier: 0,
  secondSpeedMultiplier: 0.9, secondAngleDegrees: 35, moveCounterInitial: 5,
});

/** Real PRC test fixture, with source Float32 storage precision preserved.
 * Its original game patch and unmodified extraction origin remain unknown.
 * Like the sheet preparation, this bundle has no production consumer. */
export const PIKACHU_QUICK_ATTACK_BINARY_FIXTURE_SOURCE = Object.freeze({
  url: 'https://github.com/ultimate-research/prc-rs/blob/c5855b8d0e910b1c3622c3131e6dfe0567d62397/src/tests/vl.prc',
  sha256: '49a645b4e1833bb29f608b8d0b40eaff25c2e47750f0782a32355137f2af6b05',
  gamePatch: null, unmodifiedVanillaVerified: false, productionQualified: false,
});
export const PIKACHU_QUICK_ATTACK_BINARY_FIXTURE_PARAMETERS: PikachuQuickAttackParameters = Object.freeze({
  stickThreshold: 0.5, speedAdd: 11, speedMultiplier: 0,
  secondSpeedMultiplier: 0.8999999761581421, secondAngleDegrees: 35, moveCounterInitial: 5,
});

export interface PikachuQuickAttackVector { readonly x: number; readonly y: number }

function magnitude(vector: PikachuQuickAttackVector): number {
  if (!Number.isFinite(vector.x) || !Number.isFinite(vector.y)) throw new Error('Quick Attack requires finite raw stick/direction');
  return Math.hypot(vector.x, vector.y);
}

function validateParameters(params: PikachuQuickAttackParameters): void {
  if (!Number.isFinite(params.stickThreshold) || params.stickThreshold <= 0 || params.stickThreshold > 0.999
    || !Number.isFinite(params.speedAdd) || params.speedAdd <= 0
    || !Number.isFinite(params.speedMultiplier) || params.speedMultiplier < 0
    || !Number.isFinite(params.secondSpeedMultiplier) || params.secondSpeedMultiplier <= 0
    || !Number.isFinite(params.secondAngleDegrees) || params.secondAngleDegrees < 0 || params.secondAngleDegrees > 180
    || !Number.isInteger(params.moveCounterInitial) || params.moveCounterInitial < 0) {
    throw new Error('Invalid explicit Quick Attack parameter bundle');
  }
}

/** FUN_710000c820's airborne vector path only. Native axes are X right/Y up;
 * caller must not pass screen-down Y or facing-relative directional buttons.
 * Ground-normal/passable-floor and native floating-point behavior are outside
 * this helper. Completed count0 means first burst,1 means second. */
export function preparePikachuAirborneWarp(rawStick: PikachuQuickAttackVector, completedBursts: 0 | 1,
  entryFacing: 1 | -1, params: PikachuQuickAttackParameters) {
  validateParameters(params);
  if (completedBursts !== 0 && completedBursts !== 1) throw new Error('Quick Attack permits only two prepared bursts');
  if (entryFacing !== 1 && entryFacing !== -1) throw new Error('Invalid Quick Attack entry facing');
  const rawMagnitude = magnitude(rawStick);
  const clampedMagnitude = Math.min(rawMagnitude, 0.999); // literal in preserved helper
  const direction = clampedMagnitude < params.stickThreshold
    ? { x: 0, y: 1 } : { x: rawStick.x / rawMagnitude, y: rawStick.y / rawMagnitude };
  const speed = (clampedMagnitude * params.speedMultiplier + params.speedAdd)
    * (completedBursts === 1 ? params.secondSpeedMultiplier : 1);
  const velocity = { x: direction.x * speed, y: direction.y * speed };
  // SpecialHiWarp/init: exact sign thresholds. Preserve facing vertically.
  const facing = velocity.x >= 0.001 ? 1 : velocity.x <= -0.001 ? -1 : entryFacing;
  return { direction, velocity, facing, clampedMagnitude };
}

/** FUN_710000ad30. No facing conversion: compare first APPLIED direction with
 * current raw stick. JavaScript scalar math is an authored evaluation policy;
 * native vec2_angle/f32 precision at an exact angular boundary is unverified. */
export function preparePikachuSecondWarpCheck(previousApplied: PikachuQuickAttackVector,
  rawStick: PikachuQuickAttackVector, completedBursts: number, params: PikachuQuickAttackParameters) {
  validateParameters(params);
  if (!Number.isInteger(completedBursts) || completedBursts < 0) throw new Error('Invalid completed Quick Attack burst count');
  const previousMagnitude = magnitude(previousApplied);
  const stickMagnitude = magnitude(rawStick);
  if (previousMagnitude === 0) throw new Error('Quick Attack requires the previous applied warp direction');
  if (completedBursts >= 2 || stickMagnitude < params.stickThreshold) return { accepted: false, angleRadians: null };
  const cosine = Math.max(-1, Math.min(1,
    (previousApplied.x * rawStick.x + previousApplied.y * rawStick.y) / (previousMagnitude * stickMagnitude)));
  const angleRadians = Math.acos(cosine);
  return { accepted: angleRadians > params.secondAngleDegrees * Math.PI / 180, angleRadians };
}

/** END exec invokes the second-warp helper only at phase1, then consumes a
 * rejected check by advancing to phase2. ACMD, not this helper, opens phase1. */
export function preparePikachuWarpBranch(phase: 0 | 1 | 2, previousApplied: PikachuQuickAttackVector,
  rawStick: PikachuQuickAttackVector, completedBursts: number, params: PikachuQuickAttackParameters) {
  if (phase !== 0 && phase !== 1 && phase !== 2) throw new Error('Invalid Quick Attack branch phase');
  if (phase !== 1) return { phase, enterWarp: false };
  const check = preparePikachuSecondWarpCheck(previousApplied, rawStick, completedBursts, params);
  return { phase: check.accepted ? phase : 2 as const, enterWarp: check.accepted };
}

/** The native loop decrements outside global stop, then exits on counter<0.
 * Caller scheduling/entry order is deliberately unspecified. No distance or
 * total gameplay duration is inferred from this isolated counter primitive. */
export function preparePikachuWarpCounter(counter: number, stopped: boolean) {
  if (!Number.isInteger(counter)) throw new Error('Quick Attack requires an integer warp counter');
  const nextCounter = stopped ? counter : counter - 1;
  return { counter: nextCounter, enterEnd: nextCounter < 0 };
}
