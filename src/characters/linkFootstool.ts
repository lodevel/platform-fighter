/** Fresh Link tread source fields and bounded presentation/kinetic adapters.
 * Exact common range selector, accelerated jump basis and recipient motion
 * dispatch remain unrecovered; consumers own actual accepted contact/leases.
 * Receipt: source-contracts/link-footstool-consumer.json. */
export const LINK_FOOTSTOOL_SOURCE = Object.freeze({
  jumpSpeedYMultiplier: 1.3, miniJumpSpeedYMultiplier: .7,
  rangeOffsetY: 1, rangeWidth: 6, rangeHeight: 6,
  additionalRangeWidth: 2, additionalRangeHeight: 2,
  airRecipientRecoveryFrames: 36,
  repeatVelocityMultiplier: .75, minimumNativeVelocity: .5, cooldownFrames: 8,
  motions: Object.freeze({
    jump: Object.freeze({ motion: 'step_jump', rawEnd: 8, loop: false, cancelFrame: 0 }),
    front: Object.freeze({ motion: 'step_pose', rawEnd: 8, loop: false, cancelFrame: 0 }),
    back: Object.freeze({ motion: 'step_pose_back', rawEnd: 23, loop: false, cancelFrame: 21 }),
    airPose: Object.freeze({ motion: 'step_pose_air', rawEnd: 8, loop: false, cancelFrame: 8,
      reserveChangeStatusDelayMotionRawFrame: 8 }),
    airFall: Object.freeze({ motion: 'step_fall', rawEnd: 40, loop: true, cancelFrame: 0 }),
  }),
});
function positive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive and finite`);
  return value;
}
function counter(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be nonnegative integer`);
  return value;
}
/** Base dimensions interpreted as full dimensions; unresolved +2/+2 selector
 * is not silently active. Scene attaches this adapter to real paired head data. */
export function linkFootstoolContactProfile(pixelsPerUnit = 5) {
  const ppu = positive(pixelsPerUnit, 'pixelsPerUnit');
  return Object.freeze({ halfWidthPixels: LINK_FOOTSTOOL_SOURCE.rangeWidth * ppu / 2,
    halfHeightPixels: LINK_FOOTSTOOL_SOURCE.rangeHeight * ppu / 2,
    headOffsetPixelsY: LINK_FOOTSTOOL_SOURCE.rangeOffsetY * ppu });
}
/** WORLD positive basis supplied explicitly by actual kinetic consumer.
 * Return WORLD Y-down velocity. No source-height field is treated as speed. */
export function linkFootstoolJumpVelocity(positiveWorldBasis: number, mini = false,
  consecutiveCount = 0): number {
  const basis = positive(positiveWorldBasis, 'footstool world basis');
  counter(consecutiveCount, 'consecutive footstools');
  if (typeof mini !== 'boolean') throw new TypeError('Footstool mini must be boolean');
  return -basis * (mini ? LINK_FOOTSTOOL_SOURCE.miniJumpSpeedYMultiplier
    : LINK_FOOTSTOOL_SOURCE.jumpSpeedYMultiplier) * LINK_FOOTSTOOL_SOURCE.repeatVelocityMultiplier ** consecutiveCount;
}
/** Equality is eligible. Minimum applies to next FULL entry, not a clamp of
 * the later mini velocity. Counter/cooldown reset remains actual actor-owned. */
export function canLinkFootstoolJump(positiveWorldBasis: number, consecutiveCount = 0,
  cooldownRemaining = 0, pixelsPerUnit = 5): boolean {
  counter(cooldownRemaining, 'footstool cooldown');
  const speed = -linkFootstoolJumpVelocity(positiveWorldBasis, false, consecutiveCount) /
    positive(pixelsPerUnit, 'pixelsPerUnit');
  return cooldownRemaining === 0 && speed >= LINK_FOOTSTOOL_SOURCE.minimumNativeVelocity;
}
/** AUTHORED contact presentation chooser selected by coordinator. Actual
 * accepted jumper/victim IDs and generations are latched by the caller. */
export function selectLinkFootstoolRecipientSide(input: {
  readonly jumperX: number; readonly recipientX: number; readonly recipientEntryFacing: 1 | -1;
}): 'front' | 'back' {
  if (!Number.isFinite(input.jumperX) || !Number.isFinite(input.recipientX)
    || input.recipientEntryFacing !== 1 && input.recipientEntryFacing !== -1)
    throw new TypeError('Invalid actual footstool recipient contact');
  return (input.jumperX - input.recipientX) * input.recipientEntryFacing >= 0 ? 'front' : 'back';
}
export interface LinkFootstoolBodyPresentation {
  readonly role: 'performer' | 'recipient';
  readonly phase: 'jump' | 'ground-front' | 'ground-back' | 'air-pose' | 'air-fall';
  /** Phase-local actual actor clock. Air-pose callback versus air-fall clock
   * transition is supplied by the real status consumer, not render-time. */
  readonly framesElapsed: number;
  readonly facing: 1 | -1;
}
export function selectLinkFootstoolBodyRoute(state: LinkFootstoolBodyPresentation) {
  counter(state.framesElapsed, 'footstool presentation age');
  if (state.facing !== 1 && state.facing !== -1) throw new TypeError('Invalid footstool facing');
  if (state.role === 'performer' ? state.phase !== 'jump'
    : state.role !== 'recipient' || state.phase === 'jump') throw new TypeError('Footstool role/phase mismatch');
  const facts = state.phase === 'jump' ? LINK_FOOTSTOOL_SOURCE.motions.jump
    : state.phase === 'ground-front' ? LINK_FOOTSTOOL_SOURCE.motions.front
    : state.phase === 'ground-back' ? LINK_FOOTSTOOL_SOURCE.motions.back
    : state.phase === 'air-pose' ? LINK_FOOTSTOOL_SOURCE.motions.airPose
    : state.phase === 'air-fall' ? LINK_FOOTSTOOL_SOURCE.motions.airFall : null;
  if (!facts) throw new TypeError('Unknown footstool phase');
  return Object.freeze({ motion: facts.motion, rawAge: facts.loop ? state.framesElapsed
    : Math.min(state.framesElapsed, facts.rawEnd), facing: state.facing, terminal: !facts.loop });
}
