/** Source-backed normal/aerial preparation, deliberately outside the roster.
 * UFD supplies gameplay timelines; native captures supply regional records.
 * No non-root bone anchor, art route or animated hurtbox is fabricated here.
 */
import { PIKACHU_NATIVE_ATTACKS } from './pikachuAttackData';
import { pikachuSourceHits, type PikachuPoseProjector, type PikachuSourceMotion } from './pikachuSourceMoves';
import type { AttackCollisionHit, AttackHitWindow, AttackMove } from './attacks';
import type { AttackMoveWithAnimation } from './moveSchema';
import type { AerialDirection, AerialMove, AutoCancelWindow } from './aerialSchema';

export interface PikachuNormalContact {
  /** One-based inclusive gameplay interval, independently checked against UFD. */
  readonly first: number;
  readonly last: number;
  /** Shared across geometry/strength replacements until the actual strike clears. */
  readonly strike: string;
}

export interface PikachuDamageOverride {
  readonly nativeDamage: number;
  readonly ufdDamage: number;
  readonly reason: string;
}

export interface PikachuNormalSpec {
  readonly id: string;
  readonly motion: PikachuSourceMotion;
  readonly type: 'tilt' | 'smash' | 'aerial';
  readonly entry: 'ground' | 'air' | 'landing';
  readonly totalFrames: number;
  readonly contacts: readonly PikachuNormalContact[];
  readonly aerialDirection?: AerialDirection;
  readonly landingLagFrames?: number;
  readonly autoCancelWindows?: readonly AutoCancelWindow[];
  readonly landingMotion?: PikachuSourceMotion;
  readonly damageOverrides?: readonly PikachuDamageOverride[];
  readonly charge?: {
    readonly holdGameFrame: number;
    readonly damageCapFrames: number;
    readonly keepFrames: number;
    readonly maximumMultiplier: number;
  };
  /** Native per-target interval, measured from that target's last successful hit.
   * It is not a periodic global hit window. Native hit-stop counting remains
   * unverified; the engine requires an explicitly injected actor clock. */
  readonly perTargetRehitFrames?: number;
  readonly timingEvidence: string;
}

const intervals = (ranges: readonly (readonly [number, number])[], prefix: string): PikachuNormalContact[] =>
  ranges.map(([first, last], i) => ({ first, last, strike: `${prefix}:${i + 1}` }));
const contact = (first: number, last: number, strike: string): PikachuNormalContact[] => [{ first, last, strike }];
const charge = (holdGameFrame: number) => ({ holdGameFrame, damageCapFrames: 60, keepFrames: 120, maximumMultiplier: 1.4 });
const UFD = 'https://ultimateframedata.com/pikachu (checked 2026-10-06); native script clocks agree for these ordinary contacts, no game-motion-rate commands';

/** Angled tilts are distinct native motions. Early/late strength is per region.
 * Landing records are attached to their parent aerial's touchdown consumer. */
export const PIKACHU_NORMAL_SPECS = [
  { id: 'forward-tilt', motion: 'pikachu/AttackS3', type: 'tilt', entry: 'ground', totalFrames: 29, contacts: contact(6, 8, 'ftilt'), timingEvidence: UFD },
  { id: 'forward-tilt-up', motion: 'pikachu/AttackS3Hi', type: 'tilt', entry: 'ground', totalFrames: 29, contacts: contact(6, 8, 'ftilt-up'), timingEvidence: UFD },
  { id: 'forward-tilt-down', motion: 'pikachu/AttackS3Lw', type: 'tilt', entry: 'ground', totalFrames: 29, contacts: contact(6, 8, 'ftilt-down'), timingEvidence: UFD },
  { id: 'up-tilt', motion: 'pikachu/AttackHi3', type: 'tilt', entry: 'ground', totalFrames: 26, contacts: contact(7, 13, 'utilt'), timingEvidence: UFD },
  { id: 'down-tilt', motion: 'pikachu/AttackLw3', type: 'tilt', entry: 'ground', totalFrames: 18, contacts: contact(7, 8, 'dtilt'), timingEvidence: UFD },
  { id: 'dash-attack', motion: 'pikachu/AttackDash', type: 'tilt', entry: 'ground', totalFrames: 35, contacts: contact(6, 12, 'dash'), timingEvidence: UFD },
  { id: 'forward-smash', motion: 'pikachu/AttackS4', type: 'smash', entry: 'ground', totalFrames: 53, contacts: contact(15, 29, 'fsmash'), charge: charge(9), timingEvidence: UFD },
  { id: 'up-smash', motion: 'pikachu/AttackHi4', type: 'smash', entry: 'ground', totalFrames: 44, contacts: contact(10, 17, 'usmash'), charge: charge(2), timingEvidence: UFD },
  { id: 'down-smash', motion: 'pikachu/AttackLw4', type: 'smash', entry: 'ground', totalFrames: 65,
    contacts: intervals([[8, 9], [11, 12], [14, 15], [17, 18], [20, 21], [23, 23]], 'dsmash'), charge: charge(2),
    timingEvidence: `${UFD}; frame23 finisher present in UFD startup list and native capture, omitted by UFD activeframes text` },
  { id: 'neutral-air', motion: 'pikachu/AttackAirN', type: 'aerial', entry: 'air', totalFrames: 38,
    contacts: intervals([[3, 6], [9, 12], [15, 18], [21, 22]], 'nair'), aerialDirection: 'neutral', landingLagFrames: 9,
    autoCancelWindows: [{ startFrame: 36, endFrame: 38 }],
    damageOverrides: [{ nativeDamage: 1.8, ufdDamage: 1.7, reason: 'Current UFD linker damage preferred; pinned native1.8 discrepancy retained' }], timingEvidence: UFD },
  { id: 'forward-air', motion: 'pikachu/AttackAirF', type: 'aerial', entry: 'air', totalFrames: 41,
    contacts: [{ first: 11, last: 25, strike: 'fair:link' }, { first: 27, last: 27, strike: 'fair:finish' }],
    aerialDirection: 'forward', landingLagFrames: 12, autoCancelWindows: [{ startFrame: 0, endFrame: 4 }, { startFrame: 31, endFrame: 41 }],
    perTargetRehitFrames: 3,
    damageOverrides: [{ nativeDamage: 1.4, ufdDamage: 1.3, reason: 'Current UFD linker damage preferred; pinned native1.4 discrepancy retained' }], timingEvidence: UFD },
  { id: 'back-air', motion: 'pikachu/AttackAirB', type: 'aerial', entry: 'air', totalFrames: 43,
    contacts: intervals([[4, 5], [8, 9], [12, 13], [16, 17], [20, 21], [24, 25]], 'bair'),
    aerialDirection: 'back', landingLagFrames: 18, autoCancelWindows: [{ startFrame: 0, endFrame: 3 }, { startFrame: 37, endFrame: 43 }],
    landingMotion: 'pikachu/LandingAirB', damageOverrides: [{ nativeDamage: 3.6, ufdDamage: 3.5, reason: 'Current UFD finisher damage preferred; pinned native3.6 discrepancy retained' }], timingEvidence: UFD },
  { id: 'up-air', motion: 'pikachu/AttackAirHi', type: 'aerial', entry: 'air', totalFrames: 26,
    contacts: contact(4, 8, 'uair'), aerialDirection: 'up', landingLagFrames: 14,
    autoCancelWindows: [{ startFrame: 0, endFrame: 3 }, { startFrame: 17, endFrame: 26 }], timingEvidence: UFD },
  { id: 'down-air', motion: 'pikachu/AttackAirLw', type: 'aerial', entry: 'air', totalFrames: 47,
    contacts: contact(14, 26, 'dair'), aerialDirection: 'down', landingLagFrames: 22,
    autoCancelWindows: [{ startFrame: 37, endFrame: 47 }], landingMotion: 'pikachu/LandingAirLw', timingEvidence: UFD },
  { id: 'back-air-landing', motion: 'pikachu/LandingAirB', type: 'tilt', entry: 'landing', totalFrames: 18,
    contacts: contact(1, 2, 'bair:landing'), timingEvidence: `${UFD}; UFD landing commitment18; native contact motion1 clear3` },
  { id: 'down-air-landing', motion: 'pikachu/LandingAirLw', type: 'tilt', entry: 'landing', totalFrames: 22,
    contacts: contact(1, 2, 'dair:landing'), timingEvidence: `${UFD}; UFD landing commitment22; native contact motion1 clear3` },
] as const satisfies readonly PikachuNormalSpec[];

export type PikachuNormalId = (typeof PIKACHU_NORMAL_SPECS)[number]['id'];
export interface PikachuNormalBuildOptions {
  /** This opt-in executes an authored actor clock, not verified native hit-stop
   * counting. A collision consumer must explicitly inject that same clock. */
  readonly rehitClockPolicy?: 'authored-attack-elapsed';
}

export function pikachuNormalSpec(id: PikachuNormalId): PikachuNormalSpec {
  return PIKACHU_NORMAL_SPECS.find(spec => spec.id === id)!;
}

/** Samples preserve per-target rehit metadata even where runtime building is refused. */
export function pikachuNormalFrame(id: PikachuNormalId, elapsed: number,
  projectPose?: PikachuPoseProjector, heldFrames = 0): {
    readonly collisionHits: readonly AttackCollisionHit[];
    readonly strike: string | null;
    readonly perTargetRehitFrames?: number;
  } {
  if (!Number.isInteger(elapsed) || elapsed < 0) throw new Error('Pikachu normal elapsed frame must be a non-negative integer');
  if (!Number.isInteger(heldFrames) || heldFrames < 0) throw new Error('Pikachu held frames must be a non-negative integer');
  const spec = pikachuNormalSpec(id);
  const region = spec.contacts.find(c => c.first - 1 <= elapsed && elapsed < c.last);
  if (!region) return { collisionHits: [], strike: null };
  const factor = spec.charge ? 1 + Math.min(heldFrames, spec.charge.damageCapFrames)
    / spec.charge.damageCapFrames * (spec.charge.maximumMultiplier - 1) : 1;
  const hits = pikachuSourceHits(spec.motion, elapsed + 1, projectPose).map(hit => {
    const override = spec.damageOverrides?.find(x => x.nativeDamage === hit.damage);
    return { ...hit, damage: (override?.ufdDamage ?? hit.damage!) * factor };
  });
  if (!hits.length) throw new Error(`Unreconciled Pikachu contact clock: ${id} game frame ${elapsed + 1}`);
  const nativeRehit = spec.perTargetRehitFrames && PIKACHU_NATIVE_ATTACKS[spec.motion].some(row =>
    row.frame <= elapsed + 1 && (row.end_frame === null || elapsed + 1 < row.end_frame) && row.rehit > 0);
  return { collisionHits: hits, strike: region.strike,
    ...(nativeRehit ? { perTargetRehitFrames: spec.perTargetRehitFrames } : {}) };
}

function envelope(hits: readonly AttackCollisionHit[]): AttackMove['hitbox'] {
  const xs = hits.flatMap(h => [h.capsule.start.x - h.capsule.radius, h.capsule.end.x - h.capsule.radius,
    h.capsule.start.x + h.capsule.radius, h.capsule.end.x + h.capsule.radius]);
  const ys = hits.flatMap(h => [h.capsule.start.y - h.capsule.radius, h.capsule.end.y - h.capsule.radius,
    h.capsule.start.y + h.capsule.radius, h.capsule.end.y + h.capsule.radius]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return { offsetX: (minX! + maxX!) / 2, offsetY: (minY! + maxY!) / 2, width: maxX! - minX!, height: maxY! - minY! };
}

/** Explicit posed snapshots at each fixed step; geometry changes do not reset a hit.
 * Fair requires explicit authored clock opt-in while native hit-stop timer
 * behavior remains unverified. Landing actions use the automatic touchdown route. */
export function buildPikachuNormalMove(id: PikachuNormalId,
  projectPose?: PikachuPoseProjector, options: PikachuNormalBuildOptions = {}): AttackMoveWithAnimation | AerialMove {
  const spec = pikachuNormalSpec(id);
  if (options.rehitClockPolicy !== undefined && options.rehitClockPolicy !== 'authored-attack-elapsed')
    throw new Error('Pikachu normal rehit clock policy must be authored-attack-elapsed');
  if (spec.perTargetRehitFrames && options.rehitClockPolicy !== 'authored-attack-elapsed')
    throw new Error(`Unresolved Pikachu per-target rehit: ${id} requires ${spec.perTargetRehitFrames} frames and explicit authored clock opt-in`);
  const firstContact = spec.contacts[0]!;
  const activeEnd = spec.contacts.at(-1)!.last;
  const windows: AttackHitWindow[] = [];
  for (let elapsed = firstContact.first - 1; elapsed < activeEnd; elapsed++) {
    const frame = pikachuNormalFrame(id, elapsed, projectPose);
    if (frame.strike === null) continue;
    const collisionHits = spec.perTargetRehitFrames ? frame.collisionHits.map(hit => {
      const native = PIKACHU_NATIVE_ATTACKS[spec.motion].find(row => row.id === hit.id &&
        row.frame <= elapsed + 1 && (row.end_frame === null || elapsed + 1 < row.end_frame));
      if (native === undefined) throw new Error(`Missing live Pikachu rehit region: ${id} ${hit.id}`);
      return { ...hit, rehitFrames: native.rehit };
    }) : frame.collisionHits;
    windows.push({ startFrame: elapsed, endFrame: elapsed + 1, group: frame.strike,
      collisionHits, hitbox: envelope(collisionHits) });
  }
  const firstHits = windows[0]!.collisionHits!;
  const first = firstHits[0]!;
  // Damage-only charge keeps reference launch on the owning move/regions.
  // These legacy endpoints are inactive and the saved format rejects a
  // reference record on them because interpolating it would lose regional data.
  const { reference: _chargeReference, ...chargeKnockback } = first.knockback!;
  const move: AttackMoveWithAnimation = {
    id: `pikachu.${id}`, type: spec.type, damage: first.damage!, knockback: first.knockback!,
    hitbox: envelope(firstHits), collisionHits: firstHits, hitWindows: windows,
    startupFrames: firstContact.first - 1, activeFrames: activeEnd - (firstContact.first - 1),
    recoveryFrames: spec.totalFrames - activeEnd, cooldownFrames: 0,
    hitlagMultiplier: first.hitlagMultiplier, sdiMultiplier: first.sdiMultiplier,
    tripChance: first.tripChance, setoff: first.setoff,
    ...(spec.charge ? { chargeStartFrame: spec.charge.holdGameFrame - 1, charge: {
      knockbackMode: 'damage-only' as const, minChargeFrames: 0, maxChargeFrames: spec.charge.damageCapFrames,
      minDamage: first.damage!, maxDamage: first.damage! * spec.charge.maximumMultiplier,
      minKnockback: chargeKnockback, maxKnockback: chargeKnockback,
    } } : {}),
  };
  return spec.type === 'aerial' ? { ...move, type: 'aerial', aerialDirection: spec.aerialDirection!,
    landingLagFrames: spec.landingLagFrames!, autoCancelWindows: spec.autoCancelWindows,
    ...(spec.perTargetRehitFrames ? { rehitClockPolicy: options.rehitClockPolicy } : {}),
    ...(spec.landingMotion === 'pikachu/LandingAirB' ? { landingAttack: buildPikachuNormalMove('back-air-landing') }
      : spec.landingMotion === 'pikachu/LandingAirLw' ? { landingAttack: buildPikachuNormalMove('down-air-landing') } : {}),
  } : move;
}

/** Uncharged neutral/angled tilt pack. Every pose-dependent region must resolve. */
export function buildPikachuForwardTilt(projectPose: PikachuPoseProjector): AttackMoveWithAnimation {
  return { ...buildPikachuNormalMove('forward-tilt', projectPose), angledVariants: {
    up: buildPikachuNormalMove('forward-tilt-up', projectPose),
    down: buildPikachuNormalMove('forward-tilt-down', projectPose),
  } };
}

/** Source metadata remains available for unsupported rules such as trip and setoff. */
export function pikachuNormalNativeRegions(id: PikachuNormalId) {
  return PIKACHU_NATIVE_ATTACKS[pikachuNormalSpec(id).motion];
}
