/** Source packet -> shared combat resolver. Geometry and per-target clocks
 * remain owned by the matched source drawing/contact caller. */
import type { HitInfo } from './combat';
import type { LinkNativeAttackPacket } from './linkNativeAttackPacket';
export function nativePacketHit(packet: LinkNativeAttackPacket, input: {
  readonly facing: 1 | -1; readonly damageMultiplier: number;
  readonly forceReaction?: boolean; readonly unblockable?: boolean;
  readonly appliedDamageMultiplier?: number; readonly reactionMultiplier?: number;
  readonly finalSmashRunId?: number;
}): HitInfo {
  const damage = packet.damage * input.damageMultiplier;
  return {
    damage, baseDamage: damage, facing: input.facing,
    knockback: { x: 0, y: 0, scaling: 0, reference: {
      angle: packet.launch.angle, base: packet.launch.base, growth: packet.launch.growth,
      fixed: packet.launch.fixed, setWeight: packet.setWeight,
    } },
    nativeCollisionAttribute: packet.attribute, nativeForceReaction: input.forceReaction,
    direct: packet.direct, reflectable:packet.reflectable,absorbable:packet.absorbable, unblockable: input.unblockable,
    hitlagMultiplier: packet.disableHitlag ? 0 : packet.hitlag, sdiMultiplier: packet.sdi,
    shieldDamage: packet.shieldDamage, tripChance: packet.trip,
    electricCollision: packet.attribute.includes('elec'),
    appliedDamageMultiplier: input.appliedDamageMultiplier,
    referenceKnockbackMultiplier: input.reactionMultiplier, finalSmashRunId: input.finalSmashRunId,
  };
}
