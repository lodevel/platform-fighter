/** DK native tread parameters with an explicit 2D contact/kinetic adapter.
 * Additional-range selector and accelerated jump basis remain unavailable;
 * published repeat velocity and minimum-speed rules are separately retained.
 * Evidence: mechanics/context-source-contract.json. Pika's reviewed selector
 * stays byte-for-byte equivalent in behavior; one global resolver prevents a
 * participant being claimed by two different fighter-specific passes.
 */
import type { FootstoolParticipant, FootstoolResolution } from './pikachuFootstool';
import {linkFootstoolContactProfile} from './linkFootstool';

export const DONKEYKONG_FOOTSTOOL_PARAMETERS = Object.freeze({
  jumpSpeedYMultiplier: 1.3, miniJumpSpeedYMultiplier: 0.7,
  rangeOffsetY: 1, rangeWidth: 8, rangeHeight: 6,
  additionalRangeWidth: 4, additionalRangeHeight: 2,
  airRecipientRecoveryFrames: 36, postAttackLockoutFrames: 16,
});
/** Original research page75: repeat multiplier applies to initial velocity,
 * not height. The computed next jump must be at least .5 native units/frame.
 * The common native accelerated full-jump basis remains a separate beta adapter.
 */
export const DONKEYKONG_FOOTSTOOL_REPEAT_RULES = Object.freeze({
  velocityMultiplier: .75, minimumNativeVelocity: .5, cooldownFrames: 8,
});
export interface SourceFootstoolParticipant extends FootstoolParticipant {
  /** Fresh revision only. Legacy Link cannot enter the rebuilt source kit. */
  readonly sourceLinkFootstool?:boolean;
  /** DK's observed attack-end/interruption clock; absent means caller's
   * mayJump has already applied that eligibility gate. */
  readonly footstoolAttackLockoutRemaining?: number;
}

/** Dimensions treated as full base dimensions; additional4/+2 are retained
 * but their native status selector is unresolved. This is explicitly beta
 * base-only geometry, not native 3D tread collision parity. */
export function donkeyKongFootstoolContactProfile() {
  const p = DONKEYKONG_FOOTSTOOL_PARAMETERS;
  return { halfWidthPixels: p.rangeWidth * 5 / 2,
    halfHeightPixels: p.rangeHeight * 5 / 2, headOffsetPixelsY: p.rangeOffsetY * 5 };
}

export function resolvePikachuAndDonkeyKongFootstools(
  participants: readonly SourceFootstoolParticipant[]): readonly FootstoolResolution[] {
  const result: FootstoolResolution[] = [], usedParticipants = new Set<number>();
  for (const jumper of [...participants].sort((a, b) => a.playerIndex - b.playerIndex)) {
    const isDk = jumper.characterId === 'donkeykong';
    const isLink=jumper.characterId==='link'&&jumper.sourceLinkFootstool===true;
    if (usedParticipants.has(jumper.playerIndex) || (!isDk && !isLink && jumper.characterId !== 'pikachu')
      || !jumper.freshJump || !jumper.mayJump || jumper.grounded || jumper.velocityY < 0
      || (isDk && (jumper.footstoolAttackLockoutRemaining ?? 0) > 0)) continue;
    const profile = isLink?linkFootstoolContactProfile():isDk ? donkeyKongFootstoolContactProfile()
      : { halfWidthPixels: 15, halfHeightPixels: 15, headOffsetPixelsY: 5 };
    const candidates = participants.filter(target => target.playerIndex !== jumper.playerIndex
      && target.mayReceive && !usedParticipants.has(target.playerIndex)
      && jumper.y < target.head.top
      && Math.abs(jumper.x - target.head.x) <= profile.halfWidthPixels
      && Math.abs(jumper.feetY - (target.head.top - profile.headOffsetPixelsY)) <= profile.halfHeightPixels)
      .sort((a, b) => Math.abs(jumper.feetY - (a.head.top - profile.headOffsetPixelsY))
        - Math.abs(jumper.feetY - (b.head.top - profile.headOffsetPixelsY)) || a.playerIndex - b.playerIndex);
    const target = candidates[0];
    if (!target) continue;
    usedParticipants.add(jumper.playerIndex); usedParticipants.add(target.playerIndex);
    result.push({ jumperIndex: jumper.playerIndex, recipientIndex: target.playerIndex,
      phantom: target.attacking, groundedRecipient: target.grounded });
  }
  return result;
}

/** Source multipliers applied to the explicitly selected beta jump basis.
 * Published repetition reduces velocity by .75 per prior consecutive footstool.
 * Caller owns count/reset, phantom no-mini restriction and actual state input. */
export function donkeyKongFootstoolJumpVelocity(ordinaryJumpImpulse: number,
  mini = false, consecutiveFootstools = 0): number {
  if (!Number.isFinite(ordinaryJumpImpulse) || ordinaryJumpImpulse <= 0
    || !Number.isInteger(consecutiveFootstools) || consecutiveFootstools < 0) {
    throw new RangeError('Footstool requires a positive jump basis and nonnegative consecutive count');
  }
  const multiplier = mini ? DONKEYKONG_FOOTSTOOL_PARAMETERS.miniJumpSpeedYMultiplier
    : DONKEYKONG_FOOTSTOOL_PARAMETERS.jumpSpeedYMultiplier;
  return -ordinaryJumpImpulse * multiplier
    * DONKEYKONG_FOOTSTOOL_REPEAT_RULES.velocityMultiplier ** consecutiveFootstools;
}

/** Evaluate before selecting a recipient. Mini/full is resolved later from
 * held jump; entry eligibility uses the next computed full-footstool speed. */
export function canDonkeyKongFootstoolJump(ordinaryJumpImpulse: number,
  consecutiveFootstools = 0, cooldownRemaining = 0): boolean {
  if (!Number.isInteger(cooldownRemaining) || cooldownRemaining < 0) {
    throw new RangeError('Footstool cooldown must be a nonnegative integer');
  }
  return cooldownRemaining === 0
    && -donkeyKongFootstoolJumpVelocity(ordinaryJumpImpulse, false, consecutiveFootstools) / 5
    >= DONKEYKONG_FOOTSTOOL_REPEAT_RULES.minimumNativeVelocity;
}
