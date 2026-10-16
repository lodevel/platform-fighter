import { PIKACHU_NATIVE_ATTACKS } from './pikachuAttackData';
import { pikachuAttackForceReaction } from './pikachuAttackForceReaction';
import type { AttackCollisionHit, AttackHitWindow, AttackMove } from './attacks';
import type { AttackMoveWithAnimation } from './moveSchema';

export type PikachuSourceMotion = keyof typeof PIKACHU_NATIVE_ATTACKS;
export type PikachuNativeAttack = (typeof PIKACHU_NATIVE_ATTACKS)[PikachuSourceMotion][number];
type Segment = Pick<AttackCollisionHit['capsule'], 'start' | 'end'>;

/** Non-root bones require a reviewed pose transform. Never substitute a generic anchor. */
export type PikachuPoseProjector = (row: PikachuNativeAttack, motionFrame: number) => Segment;

export const PIKACHU_SOURCE_COORDINATES = Object.freeze({ pixelsPerUnit: 5, rootBelowBodyCentre: 25 });

export function pikachuSourceKnockback(row: PikachuNativeAttack): AttackMove['knockback'] {
  const angle = row.angle <= 360 ? row.angle : 0;
  return { x: Math.cos(angle * Math.PI / 180), y: -Math.sin(angle * Math.PI / 180) || 0, scaling: 0,
    reference: { angle: row.angle, base: row.bkb, growth: row.kbg,
      ...(row.fkb ? { fixed: row.fkb } : {}), ...(row.set_weight ? { setWeight: true } : {}) } };
}

function pikachuSourceSetoff(native: PikachuNativeAttack['setoff']): NonNullable<AttackCollisionHit['setoff']> {
  if (native === 'ATTACK_SETOFF_KIND_ON') return 'on';
  if (native === 'ATTACK_SETOFF_KIND_OFF') return 'off';
  if (native === 'ATTACK_SETOFF_KIND_THRU') return 'through';
  throw new Error(`Unresolved native Pikachu setoff: ${native}`);
}

/** Return only live regions; source clear gaps must never inherit an earlier contact. */
export function pikachuSourceHits(motion: PikachuSourceMotion, motionFrame: number,
  projectPose?: PikachuPoseProjector): readonly AttackCollisionHit[] {
  const rows: readonly PikachuNativeAttack[] = PIKACHU_NATIVE_ATTACKS[motion];
  return rows.filter(row => row.frame <= motionFrame && (row.end_frame === null || motionFrame < row.end_frame))
    .map((row): AttackCollisionHit => {
      if (row.conditions.length || row.part !== 0) throw new Error(`Unresolved Pikachu source branch: ${motion} region ${row.id}`);
      if (typeof row.shield_damage !== 'number') throw new Error(`Unresolved Pikachu shield-damage expression: ${motion} region ${row.id}`);
      if (row.bone !== 'top' && !projectPose) throw new Error(`Missing posed Pikachu bone: ${motion} frame ${motionFrame} ${row.bone}`);
      const scale = PIKACHU_SOURCE_COORDINATES.pixelsPerUnit;
      const rootY = PIKACHU_SOURCE_COORDINATES.rootBelowBodyCentre;
      const segment = row.bone === 'top'
        ? { start: { x: row.z * scale, y: rootY - row.y * scale },
          end: { x: (row.z2 ?? row.z) * scale, y: rootY - (row.y2 ?? row.y) * scale } }
        : projectPose!(row, motionFrame);
      const nativeForceReaction = pikachuAttackForceReaction(motion, row.frame, row.id);
      return { id: row.id, nativeCollisionAttribute: row.attribute,
        ...(nativeForceReaction === undefined ? {} : { nativeForceReaction }),
        capsule: { ...segment, radius: row.size * scale }, damage: row.damage,
        knockback: pikachuSourceKnockback(row), shieldDamage: row.shield_damage,
        tripChance: row.trip, setoff: pikachuSourceSetoff(row.setoff),
        hitlagMultiplier: row.hitlag, sdiMultiplier: row.sdi,
        ...(row.attribute === 'collision_attr_elec' ? { electricCollision: true } : {}),
        launchDirection: row.lr_check === 'ATTACK_LR_CHECK_POS' ? 'position'
          : row.lr_check === 'ATTACK_LR_CHECK_B' ? 'back' : 'forward',
        targetCategory: 'all',
        ...(row.situation === 'COLLISION_SITUATION_MASK_G' ? { situation: 'ground' as const }
          : row.situation === 'COLLISION_SITUATION_MASK_A' ? { situation: 'air' as const } : {}) };
    });
}

function envelope(hits: readonly AttackCollisionHit[]): AttackMove['hitbox'] {
  const minX = Math.min(...hits.flatMap(h => [h.capsule.start.x - h.capsule.radius, h.capsule.end.x - h.capsule.radius]));
  const maxX = Math.max(...hits.flatMap(h => [h.capsule.start.x + h.capsule.radius, h.capsule.end.x + h.capsule.radius]));
  const minY = Math.min(...hits.flatMap(h => [h.capsule.start.y - h.capsule.radius, h.capsule.end.y - h.capsule.radius]));
  const maxY = Math.max(...hits.flatMap(h => [h.capsule.start.y + h.capsule.radius, h.capsule.end.y + h.capsule.radius]));
  return { offsetX: (minX + maxX) / 2, offsetY: (minY + maxY) / 2, width: maxX - minX, height: maxY - minY };
}

/** Source-backed jab preparation. This is not a registered complete fighter.
 * UFD supplies total17/startup2/restart7; native supplies all three regional records.
 * Exact trip/setoff and electric collision metadata reach the shared schema.
 * Metadata transport alone does not qualify its runtime or native sound parity. */
export const PIKACHU_JAB: AttackMoveWithAnimation = (() => {
  const collisionHits = pikachuSourceHits('pikachu/Attack11', 2);
  const first = collisionHits[0]!;
  const window: AttackHitWindow = { startFrame: 1, endFrame: 3, group: 'jab', collisionHits };
  return { id: 'pikachu.jab', type: 'jab', damage: first.damage!, knockback: first.knockback!,
    hitbox: envelope(collisionHits), collisionHits, hitWindows: [window],
    startupFrames: 1, activeFrames: 2, recoveryFrames: 14, cooldownFrames: 0,
    hitlagMultiplier: first.hitlagMultiplier, sdiMultiplier: first.sdiMultiplier,
    tripChance: first.tripChance, setoff: first.setoff,
    jabChain: { nextId: 'pikachu.jab', advanceWindowStart: 6 } };
})();
