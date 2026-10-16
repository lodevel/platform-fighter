/** Registered Pikachu grab/throw data; full visual/status qualification remains partial.
 * UFD gameplay timing is selected explicitly where native script clocks differ.
 * Unsourced hold/escape/momentum policy must be provided by the caller. */
import type { AttackCollisionHit } from './attacks';
import { validateGrabSpec, type GrabSpec, type PummelSpec } from './grabSchema';
import type { ThrowSet, ThrowSpec } from './throwSchema';
import { PIKACHU_NATIVE_ATTACKS } from './pikachuAttackData';
import { PIKACHU_SOURCE_COORDINATES, pikachuSourceKnockback } from './pikachuSourceMoves';
import { PIKACHU_BACK_THROW_ROOT_MOTION_X, PIKACHU_BACK_THROW_ROOT_MOTION_PROVENANCE } from './pikachuBackThrowRootMotion';

export const PIKACHU_GRAB_PROVENANCE = Object.freeze({
  ufd: 'https://ultimateframedata.com/pikachu', checked: '2026-10-06',
  scriptRevision: '59004685238a3f6f93bae905d3a4e079701c40b4',
  losslessRecord: 'docs/review/2026-10-06/pikachu-character/sources/native-grab-records.json',
  geometry: 'Root projection uses authored scale5/root-below-body-centre25 and reviewed posed2D body fits; native3D collision and target attachment remain adaptations',
  backthrowRootMotion: PIKACHU_BACK_THROW_ROOT_MOTION_PROVENANCE,
});

/** Native root-relative CATCH fields, including distinct ground/air geometry. */
export const PIKACHU_CATCH_REGIONS = {
  Catch: [
    { id: 0, bone: 'top', size: 4, x: 0, y: 5.9, z: 4.9, x2: 0, y2: 5.9, z2: 7.9, situation: 'ground' },
    { id: 1, bone: 'top', size: 2, x: 0, y: 5.9, z: 2.9, x2: 0, y2: 5.9, z2: 9.9, situation: 'air' },
  ],
  CatchDash: [
    { id: 0, bone: 'top', size: 2.5, x: 0, y: 5, z: 4, x2: 0, y2: 5, z2: 9, situation: 'ground' },
    { id: 1, bone: 'top', size: 1.25, x: 0, y: 5, z: 2.75, x2: 0, y2: 5, z2: 10.25, situation: 'air' },
  ],
  CatchTurn: [
    { id: 0, bone: 'top', size: 3.1, x: 0, y: 5, z: -4, x2: 0, y2: 5, z2: -12.7, situation: 'ground' },
    { id: 1, bone: 'top', size: 1.55, x: 0, y: 5, z: -2.45, x2: 0, y2: 5, z2: -14.25, situation: 'air' },
  ],
} as const;

export type PikachuCatchMotion = keyof typeof PIKACHU_CATCH_REGIONS;
export const PIKACHU_CATCH_TIMELINES = {
  Catch: { firstGameFrame: 7, lastGameFrame: 8, totalFrames: 36 },
  CatchDash: { firstGameFrame: 11, lastGameFrame: 12, totalFrames: 44 },
  CatchTurn: { firstGameFrame: 12, lastGameFrame: 13, totalFrames: 39 },
} as const;

export function pikachuCatchHits(motion: PikachuCatchMotion): readonly AttackCollisionHit[] {
  const scale = PIKACHU_SOURCE_COORDINATES.pixelsPerUnit;
  const root = PIKACHU_SOURCE_COORDINATES.rootBelowBodyCentre;
  // Character flips to the new facing on pivot entry. Native negative z is
  // relative to the old facing, so it becomes positive in this runtime basis.
  const direction = motion === 'CatchTurn' ? -1 : 1;
  return PIKACHU_CATCH_REGIONS[motion].map(row => ({ id: row.id, situation: row.situation,
    capsule: { start: { x: direction * row.z * scale, y: root - row.y * scale },
      end: { x: direction * row.z2 * scale, y: root - row.y2 * scale }, radius: row.size * scale } }));
}

function envelope(hits: readonly AttackCollisionHit[]): GrabSpec['hitbox'] {
  const xs = hits.flatMap(hit => [hit.capsule.start.x - hit.capsule.radius, hit.capsule.end.x - hit.capsule.radius,
    hit.capsule.start.x + hit.capsule.radius, hit.capsule.end.x + hit.capsule.radius]);
  const ys = hits.flatMap(hit => [hit.capsule.start.y - hit.capsule.radius, hit.capsule.end.y - hit.capsule.radius,
    hit.capsule.start.y + hit.capsule.radius, hit.capsule.end.y + hit.capsule.radius]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return { offsetX: (minX! + maxX!) / 2, offsetY: (minY! + maxY!) / 2,
    width: maxX! - minX!, height: maxY! - minY! };
}

/** Native ABS launch fields and motion application timing. Catch-kind ABS rows
 * are separately retained in the lossless record and never added as release damage. */
export const PIKACHU_THROW_SOURCES = {
  forward: { motion: 'ThrowF', damage: 2, angle: 45, kbg: 110, fkb: 0, bkb: 55,
    releaseHitlag: 0, releaseMotionFrame: 30, selectedGameReleaseFrame: 30, totalFrames: 43 },
  back: { motion: 'ThrowB', damage: 9, angle: 135, kbg: 50, fkb: 0, bkb: 85,
    releaseHitlag: 0, releaseMotionFrame: 26, selectedGameReleaseFrame: 26, totalFrames: 49 },
  up: { motion: 'ThrowHi', damage: 5, angle: 90, kbg: 129, fkb: 0, bkb: 48,
    releaseHitlag: 0, releaseMotionFrame: 16, selectedGameReleaseFrame: 16, totalFrames: 35 },
  down: { motion: 'ThrowLw', damage: 5, angle: 83, kbg: 100, fkb: 0, bkb: 60,
    releaseHitlag: 1, releaseMotionFrame: 21, selectedGameReleaseFrame: 29, totalFrames: 51 },
} as const;

function buildThrow(direction: keyof typeof PIKACHU_THROW_SOURCES): ThrowSpec {
  const source = PIKACHU_THROW_SOURCES[direction];
  // Back throw's runtime release reverses HIT facing while actor facing is
  // separate. Express native135 as relative45 in that reversed launch basis.
  const angle = direction === 'back' ? 180 - source.angle : source.angle;
  const knockback = { x: Math.cos(angle * Math.PI / 180), y: -Math.sin(angle * Math.PI / 180), scaling: 0,
    reference: { angle, base: source.bkb, growth: source.kbg } };
  const animationFrames = source.selectedGameReleaseFrame - 1;
  return { damage: source.damage, knockback, animationFrames,
    hitlagMultiplier: source.releaseHitlag, electricCollision: false,
    // Source F/B/U invincibility lasts through their native release step.
    // Down's selected29 versus native21 action clock needs stop-only event
    // qualification before that source protection can be bound honestly.
    ...(direction !== 'down' ? { invincibilityFrames: source.releaseMotionFrame } : {}),
    recoveryFrames: source.totalFrames - animationFrames,
    // Source-guided beta movement uses exact Trans samples and the existing
    // gameplay age. Native common THROW motion-energy application is unknown.
    ...(direction === 'back' ? { rootMotionX: PIKACHU_BACK_THROW_ROOT_MOTION_X } : {}),
    ...(direction === 'forward' ? { heldTargetHits: [10, 14, 18, 22].map(frame => ({ frame, damage: 2, hitlagMultiplier: 0, electricCollision: true })) }
      : direction === 'up' ? { heldTargetHits: [{ frame: 13, damage: 3, hitlagMultiplier: 1.6 }] } : {}) };
}

/** UFD down-throw release29 is explicitly selected over native motion21.
 * Its native3damage contact at14 clears in the same execute block; it is not
 * a proved hit, and UFD displays only5. No extra held-target3damage is invented. */
export const PIKACHU_THROWS: ThrowSet = {
  forward: buildThrow('forward'), back: buildThrow('back'), up: buildThrow('up'), down: buildThrow('down'),
};

const pummelRow = PIKACHU_NATIVE_ATTACKS['pikachu/CatchAttack'][0];
export const PIKACHU_PUMMEL: PummelSpec = {
  damage: pummelRow.damage, startupFrames: 0, cooldownFrames: 16, hitlagFrames: 11,
  hitlagMultiplier: pummelRow.hitlag, sdiMultiplier: pummelRow.sdi,
  electricCollision: pummelRow.attribute === 'collision_attr_elec',
  knockback: pikachuSourceKnockback(pummelRow),
};

/** These shared-engine choices have no acquired native parameter values.
 * Supplying them is an authored decision, never source coverage. */
export interface PikachuGrabPolicy {
  readonly holdFramesMax: number;
  readonly escapeRecoveryFrames: number;
  readonly dashMomentumRetain: number;
}

export function buildPikachuGrab(policy: PikachuGrabPolicy): GrabSpec {
  if (!Number.isInteger(policy.holdFramesMax) || policy.holdFramesMax <= 0)
    throw new Error('Pikachu grab requires an explicit positive authored hold cap');
  if (!Number.isInteger(policy.escapeRecoveryFrames) || policy.escapeRecoveryFrames < 0)
    throw new Error('Pikachu grab requires an explicit non-negative authored escape recovery');
  if (!Number.isFinite(policy.dashMomentumRetain) || policy.dashMomentumRetain < 0 || policy.dashMomentumRetain > 1)
    throw new Error('Pikachu grab requires an explicit authored momentum fraction');
  const variant = (motion: PikachuCatchMotion) => {
    const timeline = PIKACHU_CATCH_TIMELINES[motion];
    const collisionHits = pikachuCatchHits(motion);
    return { collisionHits, hitbox: envelope(collisionHits), startupFrames: timeline.firstGameFrame - 1,
      activeFrames: timeline.lastGameFrame - timeline.firstGameFrame + 1,
      whiffRecoveryFrames: timeline.totalFrames - timeline.lastGameFrame };
  };
  return validateGrabSpec({ id: 'pikachu.grab', ...variant('Catch'),
    holdFramesMax: policy.holdFramesMax, throwRecoveryFrames: policy.escapeRecoveryFrames,
    pummel: PIKACHU_PUMMEL, throws: PIKACHU_THROWS,
    dashGrab: { ...variant('CatchDash'), rangeBonusX: 0, momentumRetain: policy.dashMomentumRetain },
    // Current Character applies dashGrab's momentum rule to pivot entry too.
    pivotGrab: { ...variant('CatchTurn'), rangeBonusX: 0, momentumRetain: policy.dashMomentumRetain },
  });
}
