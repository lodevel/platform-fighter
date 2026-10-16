import type { AttackMove, AttackHitWindow } from './attacks';

export function attackHitWindowIndex(move: AttackMove, elapsed: number): number {
  return move.hitWindows?.findIndex(w => elapsed >= w.startFrame && elapsed < w.endFrame) ?? -1;
}

/** Apply a strike's authored values without losing a charged attack's strength. */
export function resolveAttackHitWindow(
  move: AttackMove,
  charged: AttackMove,
  window: AttackHitWindow,
): AttackMove {
  const scale = (base: number, value: number) => base === 0 ? 1 : value / base;
  const kb = window.knockback;
  return {
    ...charged,
    // A selected native strike is authoritative, including unknown metadata.
    nativeCollisionAttribute: window.nativeCollisionAttribute,
    nativeForceReaction: window.nativeForceReaction,
    ...(window.tripChance === undefined ? {} : { tripChance: window.tripChance }),
    ...(window.setoff === undefined ? {} : { setoff: window.setoff }),
    shieldDamage: window.shieldDamage ?? charged.shieldDamage,
    shieldSetoffMultiplier: window.shieldSetoffMultiplier ?? charged.shieldSetoffMultiplier,
    statusEffect: window.statusEffect ?? charged.statusEffect,
    direct: window.direct ?? charged.direct,
    launchDirection: window.launchDirection ?? charged.launchDirection,
    ...(window.hitlagMultiplier === undefined ? {} : { hitlagMultiplier: window.hitlagMultiplier }),
    ...(window.sdiMultiplier === undefined ? {} : { sdiMultiplier: window.sdiMultiplier }),
    ...(window.minHitstunFrames === undefined ? {} : { minHitstunFrames: window.minHitstunFrames }),
    ...(window.airborneVelocityCarry === undefined ? {} : { airborneVelocityCarry: window.airborneVelocityCarry }),
    damage: window.damage === undefined ? charged.damage
      : window.damage * scale(move.damage, charged.damage),
    knockback: kb === undefined ? charged.knockback : {
      ...kb,
      x: kb.x * scale(move.knockback.x, charged.knockback.x),
      y: kb.y * scale(move.knockback.y, charged.knockback.y),
      scaling: kb.scaling * scale(move.knockback.scaling, charged.knockback.scaling),
    },
    hitbox: window.hitbox ?? charged.hitbox,
    // Reused geometry does not establish native metadata for a new strike.
    // A source window must provide its own per-ID packet to qualify armor.
    collisionHits: window.collisionHits === undefined
      ? charged.collisionHits?.map(({nativeCollisionAttribute: _attribute, nativeForceReaction: _force, ...hit}) => hit)
      : window.collisionHits.map(hit => ({
        ...hit, ...(hit.damage === undefined ? {} : { damage: hit.damage * scale(move.damage, charged.damage) }),
      })),
    ...(window.groundedKnockback ? { groundedKnockback: {
      ...window.groundedKnockback,
      x: window.groundedKnockback.x * scale(move.knockback.x, charged.knockback.x),
      y: window.groundedKnockback.y * scale(move.knockback.y, charged.knockback.y),
      scaling: window.groundedKnockback.scaling * scale(move.knockback.scaling, charged.knockback.scaling),
    } } : {}),
    sweetSpot: window.sweetSpot ?? charged.sweetSpot,
  };
}
