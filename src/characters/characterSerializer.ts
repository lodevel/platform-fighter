import {parseAttackHeightMetadata} from './attackHeightMetadata';
import { LINK_FORMAT_CURRENT, LINK_FORMAT_FIELD } from './persistedFormatMarker';
import { parseLinkSourcePoseId } from './linkSourceMoveIdentity';
/**
 * Character data-file serializer — post-M2 architecture pass.
 *
 * On-disk source-of-truth for per-character identity + movement
 * profile + body geometry. Files live under `data/characters/<id>.json`
 * (one per fighter). The format is JSON-compatible YAML — when a YAML
 * parser is added to the project the same files can be renamed
 * `.yaml` and the parser swapped in here without any schema changes.
 *
 * # What's serialized
 *
 *   • Identity: `id`, `displayName`, `role`.
 *   • Movement profile: every field of {@link FighterMovementProfile}
 *     (top speed, accel, damping, jump impulse, max jumps, mass).
 *   • Body geometry: `width`, `height`, `chamfer` — the hurtbox shape
 *     the Matter body is built with.
 *
 * # What's NOT serialized (intentionally — follow-up scope)
 *
 *   • Per-move data (jab / tilts / smashes / aerials / specials).
 *     Each move family has its own discriminated-union schema with
 *     character-specific fields (charge specs, projectile lifetimes,
 *     counter windows, command-grab throws). Adding moves to this
 *     format is a separate sub-task with its own per-family
 *     validators.
 *   • Sprite atlas references. Today they live in `roster.ts` and
 *     `palettes.ts` and are resolved at scene load.
 *
 * # Determinism
 *
 * Pure parse + validate. No `Math.random()`, no `Date.now()`, no
 * Phaser side effects. Identical file bytes always produce identical
 * spec records.
 */

import {parseAttackAbsorbWindow} from './attackAbsorber';
import { validateLedgeRootMotion, type LedgeRootPoint } from './ledgeRootMotionSchema';
import { validateTauntSet, type TauntSet } from './tauntSchema';
import { CHARACTER_IDS, type CharacterId } from '../types';
import type { AirMovementTuning, FighterMovementProfile, LandingTuning } from './movesetContract';
import { getFighterMovementProfile } from './fighterMovementProfiles';
import type { AttackMoveWithAnimation, KnockbackSpec, MoveAnimation, MoveHurtboxModifier } from './moveSchema';
import type { AttackCollisionHit } from './attacks';
import { getDonkeyKongPairedProtectionTimeline } from './donkeykongPairedProtectionClock';
import { resolveDodgeTuning, type DodgeTuning, type DodgeVariantTuning } from './dodgeState';
import { resolveLedgeHangTuning, type LedgeHangTuning } from './ledgeHangState';
import { validateAerialLandingAttack, type AerialMove, type LegacyNeutralAerialMove } from './aerialSchema';
import type { GrabSpec } from './grabSchema';
import type { ThrowSet, ThrowSpec } from './throwSchema';
import type {
  ChargeSpecialMove,
  CommandGrabSpecialMove,
  CounterSpecialMove,
  NeutralSpecialMove,
  ProjectileSpecialMove,
  SummonSpecialMove,
} from './specialSchema';
import type {
  CommandDashSideSpecialMove,
  DashStrikeSideSpecialMove,
  MultiHitSideSpecialMove,
  ReflectorSideSpecialMove,
  SideSpecialMove,
} from './sideSpecialSchema';
import type {
  DirectionalJumpUpSpecialMove,
  MultiHitRisingUpSpecialMove,
  TeleportUpSpecialMove,
  TetherUpSpecialMove,
  UpSpecialMove,
} from './upSpecialSchema';
import type {
  CounterDownSpecialMove,
  DownSpecialMove,
  GroundPoundDownSpecialMove,
  StallAndFallDownSpecialMove,
  TrapDownSpecialMove,
} from './downSpecialSchema';
import type { ChargeSpec } from './chargeSchema';
import type { ReferenceLaunchProfile } from './referenceLaunchEnergy';
import type { LocomotionTuning } from './locomotionState';
import { validateGrabSpec } from './grabSchema';
import {parseAuthoredCaptureMotionFamily} from './authoredCaptureMotionFamily';
import {parseCaptureAttachmentCalibration,type CaptureAttachmentCalibration} from './captureAttachmentCalibration';
import { validateThrowSet } from './throwSchema';
import { validateNeutralSpecialMove } from './specialSchema';
import { validateSideSpecialMove } from './sideSpecialSchema';
import { validateUpSpecialMove } from './upSpecialSchema';
import { validateDownSpecialMove } from './downSpecialSchema';
import { validateChargeSpec } from './chargeSchema';
import { validatePikachuSpecialPreset } from './pikachuSpecialMoves';

/**
 * On-disk record shape — what `data/characters/<id>.json` carries.
 * Mirrors {@link CharacterDataSpec} exactly; the type is shared so the
 * `JSON.parse(...)` happy-path narrows directly.
 */
export interface CharacterDataFile {
  /** JSON Schema reference for editor tooling — unused at runtime. */
  readonly $schema?: string;
  /** Write-only persisted-format marker on Link; see persistedFormatMarker.ts. */
  readonly linkFormat?: string;
  readonly id: CharacterId;
  readonly displayName: string;
  readonly role: string;
  readonly body: {
    readonly width: number;
    readonly height: number;
    readonly chamfer: number;
  };
  /**
   * Movement block. The fall-shaping fields added by the Smash-feel
   * pack (`fallAccel` / `maxFallSpeed` / `fastFallSpeed` /
   * `jumpCutFactor`) are OPTIONAL in the on-disk format — files
   * authored before the pack landed keep parsing, with missing values
   * defaulted from the fighter's registered movement profile by
   * {@link parseCharacterDataFile}. The validated
   * {@link CharacterDataSpec} always carries the full profile.
   */
  readonly movement: Omit<
    FighterMovementProfile,
    'fallAccel' | 'maxFallSpeed' | 'fastFallSpeed' | 'jumpCutFactor'
  > &
    Partial<
      Pick<
        FighterMovementProfile,
        'fallAccel' | 'maxFallSpeed' | 'fastFallSpeed' | 'jumpCutFactor'
      >
    >;
  /**
   * Optional move-set authoring block. When present, carries the
   * core 4 grounded normals (jab + tilt + smash + fair) plus the
   * optional extended slots (sideLight / upLight / downLight / nair
   * / uair / dair) plus the optional grab + throws. Specials live in
   * their own discriminated-union schemas and aren't authored here
   * yet — that's the M5.5 follow-up.
   */
  readonly moves?: CharacterMovesData;
  readonly captureAttachmentCalibration?:CaptureAttachmentCalibration;
}

/**
 * Validated, runtime-ready character spec. Today this is structurally
 * identical to {@link CharacterDataFile} (minus `$schema`), but
 * keeping the two separate gives us room to add computed / resolved
 * fields later (e.g. `bodyVertices` derived from `width × height ×
 * chamfer`) without breaking the on-disk format.
 */
export interface CharacterDataSpec {
  readonly id: CharacterId;
  readonly displayName: string;
  readonly role: string;
  readonly body: {
    readonly width: number;
    readonly height: number;
    readonly chamfer: number;
  };
  readonly movement: FighterMovementProfile;
  /** Validated moves (optional — character may ship without them in the data file). */
  readonly moves?: CharacterMovesSpec;
  readonly captureAttachmentCalibration?:CaptureAttachmentCalibration;
}

/**
 * Optional move-set block on the on-disk file. Every field is
 * optional so a character can author one slice at a time (jab first,
 * then tilt, etc.).
 *
 * The grab block is an optional whole — if present, it must be
 * complete (all 4 throw directions + range hitbox + frame data).
 */
export interface CharacterMovesData {
  readonly taunts?: TauntSet;
  readonly getupAttack?: AttackMoveWithAnimation;
  readonly getupAttackFaceDown?: AttackMoveWithAnimation;
  readonly tripAttack?: AttackMoveWithAnimation;
  readonly ledgeAttack?: AttackMoveWithAnimation;
  readonly jab?: AttackMoveWithAnimation;
  readonly jab2?: AttackMoveWithAnimation;
  readonly jab3?: AttackMoveWithAnimation;
  readonly smash2?: AttackMoveWithAnimation;
  readonly tilt?: AttackMoveWithAnimation;
  readonly smash?: AttackMoveWithAnimation;
  readonly sideLight?: AttackMoveWithAnimation;
  readonly upLight?: AttackMoveWithAnimation;
  readonly upSmash?: AttackMoveWithAnimation;
  readonly downLight?: AttackMoveWithAnimation;
  readonly downSmash?: AttackMoveWithAnimation;
  readonly dashAttack?: AttackMoveWithAnimation;
  readonly fair?: AerialMove;
  readonly bair?: AerialMove;
  readonly nair?: AerialMove | LegacyNeutralAerialMove;
  readonly uair?: AerialMove;
  readonly dair?: AerialMove;
  readonly grab?: GrabSpec;
  /**
   * Neutral special — discriminated on `specialKind` (one of
   * `'projectile' | 'charge' | 'commandGrab' | 'counter'`). Each
   * kind carries its own sub-record. Side / up / down specials are
   * separate schemas with different per-direction kinds and aren't
   * authored here yet (see M5.6 follow-up).
   */
  readonly neutralSpecial?: NeutralSpecialMove;
  /**
   * Side special — discriminated on `sideSpecialKind` (one of
   * `'dashStrike' | 'multiHit' | 'reflector' | 'commandDash'`).
   */
  readonly sideSpecial?: SideSpecialMove;
  /**
   * Up special — discriminated on `upSpecialKind` (one of
   * `'multiHitRising' | 'teleport' | 'directionalJump' | 'tether'`).
   */
  readonly upSpecial?: UpSpecialMove;
  /**
   * Down special — discriminated on `downSpecialKind` (one of
   * `'groundPound' | 'trap' | 'stallAndFall' | 'counter'`).
   */
  readonly downSpecial?: DownSpecialMove;
}

/** Validated move-set block — same shape, narrowed by the parser's invariants. */
export type CharacterMovesSpec = CharacterMovesData;

const VALID_CHARACTER_IDS: ReadonlySet<CharacterId> = new Set(CHARACTER_IDS);

function ensureFiniteNumber(
  value: unknown,
  field: string,
  contextLabel: string,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(
      `${contextLabel}: '${field}' must be a finite number, got ${String(value)}`,
    );
  }
  return value;
}

function ensurePositiveNumber(
  value: unknown,
  field: string,
  contextLabel: string,
): number {
  const n = ensureFiniteNumber(value, field, contextLabel);
  if (n <= 0) {
    throw new Error(
      `${contextLabel}: '${field}' must be > 0, got ${n}`,
    );
  }
  return n;
}

/**
 * Finite AND `>= 0`. Zero IS valid — for the optional knockback
 * components it's the legacy identity (`baseMagnitude: 0` adds no
 * launch floor; `damageGrowth: 0` leaves percent-scaling untouched).
 * Negative values are rejected: a negative `damageGrowth` would flip
 * the growth term past a percent threshold and reverse the launch
 * direction at high percent — never an authored intent.
 */
function ensureNonNegativeNumber(
  value: unknown,
  field: string,
  contextLabel: string,
): number {
  const n = ensureFiniteNumber(value, field, contextLabel);
  if (n < 0) {
    throw new Error(
      `${contextLabel}: '${field}' must be >= 0, got ${n}`,
    );
  }
  return n;
}

function ensureNonNegativeInteger(
  value: unknown,
  field: string,
  contextLabel: string,
): number {
  const n = ensureFiniteNumber(value, field, contextLabel);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(
      `${contextLabel}: '${field}' must be a non-negative integer, got ${n}`,
    );
  }
  return n;
}

function ensureString(
  value: unknown,
  field: string,
  contextLabel: string,
): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `${contextLabel}: '${field}' must be a non-empty string, got ${String(value)}`,
    );
  }
  return value;
}

function ensureCharacterId(
  value: unknown,
  contextLabel: string,
): CharacterId {
  if (typeof value !== 'string' || !VALID_CHARACTER_IDS.has(value as CharacterId)) {
    throw new Error(
      `${contextLabel}: 'id' must be one of [${CHARACTER_IDS.join(', ')}], got ${String(value)}`,
    );
  }
  return value as CharacterId;
}

function parseLedgeTuning(raw: unknown, defaults: LedgeHangTuning | undefined, ctx: string): LedgeHangTuning {
  const r = asObject(raw, 'movement.ledge', ctx);
  const parsed: { -readonly [K in keyof LedgeHangTuning]: LedgeHangTuning[K] } = { ...defaults };
  for (const key of ['maxHangFrames', 'hangIframeFrames', 'climbFrames', 'tetherCooldownFrames',
    'rollFrames', 'rollIframes', 'attackIframes', 'jumpIframes', 'getupIframes',
    'grabVulnerableFrames', 'regrabIframeThreshold', 'regrabIframePenalty', 'catchFrames', 'maxGrabsWithoutGround'] as const) {
    if (r[key] !== undefined) parsed[key] = ensureNonNegativeInteger(r[key], `movement.ledge.${key}`, ctx);
  }
  for (const key of ['dropDownClearance', 'rollDistance'] as const)
    if (r[key] !== undefined) parsed[key] = ensureNonNegativeNumber(r[key], `movement.ledge.${key}`, ctx);
  for (const key of ['catchMotionRatesByGrab', 'attackProtectionFramesByGrab', 'optionIntangibilityScaleByGrab'] as const) {
    if (r[key] === undefined) continue;
    if (!Array.isArray(r[key])) throw new Error(`${ctx}: movement.ledge.${key} must be an array`);
    parsed[key] = Object.freeze(r[key].map((value, index) => key === 'catchMotionRatesByGrab'
      ? ensurePositiveNumber(value, `movement.ledge.${key}[${index}]`, ctx)
      : key === 'optionIntangibilityScaleByGrab'
        ? ensureNonNegativeNumber(value, `movement.ledge.${key}[${index}]`, ctx)
        : ensureNonNegativeInteger(value, `movement.ledge.${key}[${index}]`, ctx)));
  }
  const resolved = resolveLedgeHangTuning(parsed);
  if (resolved.getupIframes > resolved.climbFrames || resolved.rollIframes > resolved.rollFrames)
    throw new Error(`${ctx}: movement.ledge option protection must fit its complete action window`);
  return Object.freeze(parsed);
}

function parseDodgeTuning(raw: unknown, defaults: DodgeTuning | undefined, ctx: string): DodgeTuning {
  const r = asObject(raw, 'movement.dodge', ctx);
  const parsed: { -readonly [K in keyof DodgeTuning]: DodgeTuning[K] } = {};
  const resolvedDefaults = resolveDodgeTuning(defaults);
  for (const key of ['spot', 'roll', 'backwardRoll', 'air', 'directionalAir'] as const) {
    if (r[key] === undefined) continue;
    const path = `movement.dodge.${key}`, variant = asObject(r[key], path, ctx);
    const out: { -readonly [K in keyof DodgeVariantTuning]?: DodgeVariantTuning[K] } = {};
    for (const field of ['activeFrames', 'iframeStartFrame', 'iframeFrames', 'recoveryFrames', 'cooldownFrames', 'reverseFacingFrame', 'fullyStaleIframeEndFrame'] as const) {
      if (variant[field] !== undefined) out[field] = ensureNonNegativeInteger(variant[field], `${path}.${field}`, ctx);
    }
    if (variant.slideSpeed !== undefined) out.slideSpeed = ensureNonNegativeNumber(variant.slideSpeed, `${path}.slideSpeed`, ctx);
    // A new directional/backward variant inherits the effective authored
    // air/roll window. Existing profiles retain their resolved own defaults.
    const inherited = key === 'directionalAir'
      ? resolvedDefaults.directionalAir ?? { ...resolvedDefaults.air, ...parsed.air }
      : key === 'backwardRoll'
        ? resolvedDefaults.backwardRoll ?? { ...resolvedDefaults.roll, ...parsed.roll }
        : resolvedDefaults[key];
    const resolved = { ...inherited, ...out };
    if (resolved.activeFrames < 1 || (resolved.iframeStartFrame ?? 0) + resolved.iframeFrames > resolved.activeFrames) {
      throw new Error(`${ctx}: ${path} requires a positive active window containing its entire iframe window`);
    }
    parsed[key] = out;
  }
  for (const key of ['directionalAirUpRecoveryFrames', 'directionalAirDownRecoveryFrames',
    'directionalAirUpDiagonalRecoveryFrames', 'directionalAirDownDiagonalRecoveryFrames'] as const) {
    if (r[key] !== undefined) parsed[key] = ensureNonNegativeInteger(r[key], `movement.dodge.${key}`, ctx);
  }
  if (r.stickThreshold !== undefined) {
    parsed.stickThreshold = ensureNonNegativeNumber(r.stickThreshold, 'movement.dodge.stickThreshold', ctx);
    if (parsed.stickThreshold > 1) throw new Error(`${ctx}: movement.dodge.stickThreshold must not exceed 1`);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Per-move parsers — pure validators that narrow `unknown` to a typed move
// ---------------------------------------------------------------------------

function parseKnockback(
  raw: unknown,
  fieldPath: string,
  ctx: string,
): KnockbackSpec {
  if (raw === null || typeof raw !== 'object') {
    throw new Error(`${ctx}: ${fieldPath} must be an object`);
  }
  const r = raw as Record<string, unknown>;
  let reference: KnockbackSpec['reference'];
  if (r.reference !== undefined) {
    if (r.reference === null || typeof r.reference !== 'object' || Array.isArray(r.reference)) {
      throw new Error(`${ctx}: ${fieldPath}.reference must be an object`);
    }
    const ref = r.reference as Record<string, unknown>;
    const angle = ensureFiniteNumber(ref.angle, `${fieldPath}.reference.angle`, ctx);
    if (angle < 0 || (angle > 360 && angle !== 361 && angle !== 366 && angle !== 367)) {
      throw new Error(`${ctx}: ${fieldPath}.reference.angle must be between 0 and 360, or 361/366/367`);
    }
    if (ref.setWeight !== undefined && typeof ref.setWeight !== 'boolean') {
      throw new Error(`${ctx}: ${fieldPath}.reference.setWeight must be a boolean`);
    }
    reference = {
      base: ensureNonNegativeNumber(ref.base, `${fieldPath}.reference.base`, ctx),
      growth: ensureNonNegativeNumber(ref.growth, `${fieldPath}.reference.growth`, ctx),
      angle,
      ...(ref.fixed === undefined ? {} : {
        fixed: ensureNonNegativeNumber(ref.fixed, `${fieldPath}.reference.fixed`, ctx),
      }),
      ...(ref.setWeight === undefined ? {} : { setWeight: ref.setWeight as boolean }),
      ...(ref.additionalHitstunFrames === undefined ? {} : {
        additionalHitstunFrames: ensureNonNegativeInteger(
          ref.additionalHitstunFrames, `${fieldPath}.reference.additionalHitstunFrames`, ctx,
        ),
      }),
    };
  }
  return {
    x: ensureFiniteNumber(r.x, `${fieldPath}.x`, ctx),
    y: ensureFiniteNumber(r.y, `${fieldPath}.y`, ctx),
    scaling: ensureFiniteNumber(r.scaling, `${fieldPath}.scaling`, ctx),
    ...(reference === undefined ? {} : { reference }),
    // Optional Smash-style components round-trip when authored;
    // omitted fields stay omitted so legacy files re-serialise
    // byte-identically. Both must be >= 0 — zero is the legacy
    // identity, but negatives would invert the knockback math
    // (negative damageGrowth reverses launch direction at high
    // percent).
    ...(r.baseMagnitude !== undefined
      ? {
          baseMagnitude: ensureNonNegativeNumber(
            r.baseMagnitude,
            `${fieldPath}.baseMagnitude`,
            ctx,
          ),
        }
      : {}),
    ...(r.damageGrowth !== undefined
      ? {
          damageGrowth: ensureNonNegativeNumber(
            r.damageGrowth,
            `${fieldPath}.damageGrowth`,
            ctx,
          ),
        }
      : {}),
  };
}

function parseHitbox(
  raw: unknown,
  fieldPath: string,
  ctx: string,
): { offsetX: number; offsetY: number; width: number; height: number } {
  if (raw === null || typeof raw !== 'object') {
    throw new Error(`${ctx}: ${fieldPath} must be an object`);
  }
  const r = raw as Record<string, unknown>;
  return {
    offsetX: ensureFiniteNumber(r.offsetX, `${fieldPath}.offsetX`, ctx),
    offsetY: ensureFiniteNumber(r.offsetY, `${fieldPath}.offsetY`, ctx),
    width: ensurePositiveNumber(r.width, `${fieldPath}.width`, ctx),
    height: ensurePositiveNumber(r.height, `${fieldPath}.height`, ctx),
  };
}

function parseAnimationBlock(
  raw: unknown,
  fieldPath: string,
  ctx: string,
  totalFrames: number,
): MoveAnimation {
  if (raw === null || typeof raw !== 'object') {
    throw new Error(`${ctx}: ${fieldPath} must be an object`);
  }
  const r = raw as Record<string, unknown>;
  const counts = {
    startupFrames: ensureNonNegativeInteger(
      r.startupFrames,
      `${fieldPath}.startupFrames`,
      ctx,
    ),
    activeFrames: ensureNonNegativeInteger(
      r.activeFrames,
      `${fieldPath}.activeFrames`,
      ctx,
    ),
    recoveryFrames: ensureNonNegativeInteger(
      r.recoveryFrames,
      `${fieldPath}.recoveryFrames`,
      ctx,
    ),
  };
  if (r.frameWindows === undefined) return counts;
  if (!Array.isArray(r.frameWindows) || !r.frameWindows.length)
    throw new Error(`${ctx}: ${fieldPath}.frameWindows must be a non-empty array`);
  const count = counts.startupFrames + counts.activeFrames + counts.recoveryFrames;
  let previousEnd = 0;
  const frameWindows = r.frameWindows.map((rawWindow, index) => {
    const path = `${fieldPath}.frameWindows[${index}]`;
    if (rawWindow === null || typeof rawWindow !== 'object' || Array.isArray(rawWindow))
      throw new Error(`${ctx}: ${path} must be an object`);
    const window = rawWindow as Record<string, unknown>;
    const startFrame = ensureNonNegativeInteger(window.startFrame, `${path}.startFrame`, ctx);
    const endFrame = ensureNonNegativeInteger(window.endFrame, `${path}.endFrame`, ctx);
    const artFrameIndex = ensureNonNegativeInteger(window.artFrameIndex, `${path}.artFrameIndex`, ctx);
    if (startFrame !== previousEnd || endFrame <= startFrame || endFrame > totalFrames || artFrameIndex >= count)
      throw new Error(`${ctx}: ${path} requires contiguous gameplay windows within ${totalFrames} frames and an art index below ${count}`);
    previousEnd = endFrame;
    return { startFrame, endFrame, artFrameIndex };
  });
  if (previousEnd !== totalFrames)
    throw new Error(`${ctx}: ${fieldPath}.frameWindows must cover all ${totalFrames} gameplay frames`);
  return { ...counts, frameWindows };
}

/**
 * Parse a grounded normal move (jab / tilt / smash / sideLight /
 * upLight / downLight). Validates every field declared on
 * {@link AttackMoveWithAnimation}. The `type` field is read verbatim
 * — callers are responsible for asserting it matches the slot they're
 * authoring (e.g. `parseGroundedAttack(json, ..., 'jab')` should
 * reject a record with `type: 'smash'`).
 */
function parseGroundedAttack(
  raw: unknown,
  fieldPath: string,
  ctx: string,
): AttackMoveWithAnimation {
  const base = parseAttackBase(raw, fieldPath, ctx);
  const r = raw as Record<string, unknown>;
  return { ...base,
    ...(r.animation === undefined ? {} : { animation: parseAnimationBlock(r.animation, `${fieldPath}.animation`, ctx,
      base.startupFrames + base.activeFrames + base.recoveryFrames) }),
    ...(r.hurtboxModifiers === undefined ? {} : { hurtboxModifiers: parseHurtboxModifiers(r.hurtboxModifiers, `${fieldPath}.hurtboxModifiers`, ctx,
      base.startupFrames + base.activeFrames + base.recoveryFrames) }),
  };
}

function parseHurtboxModifiers(raw: unknown, fieldPath: string, ctx: string, totalFrames: number): readonly MoveHurtboxModifier[] {
  if (!Array.isArray(raw)) throw new Error(`${ctx}: ${fieldPath} must be an array`);
  return raw.map((entry, index) => {
    const path = `${fieldPath}[${index}]`, r = asObject(entry, path, ctx);
    const phase = r.phase;
    if (phase !== undefined) {
      const phases = Array.isArray(phase) ? phase : [phase];
      if (!phases.length || phases.some(value => !['startup', 'active', 'recovery'].includes(String(value))))
        throw new Error(`${ctx}: ${path}.phase must contain startup, active or recovery`);
    }
    if (r.replaceBody !== undefined && typeof r.replaceBody !== 'boolean')
      throw new Error(`${ctx}: ${path}.replaceBody must be a boolean`);
    let frameWindow: MoveHurtboxModifier['frameWindow'];
    if (r.frameWindow !== undefined) {
      const w = asObject(r.frameWindow, `${path}.frameWindow`, ctx);
      const startFrame = ensureNonNegativeInteger(w.startFrame, `${path}.frameWindow.startFrame`, ctx);
      const endFrame = ensureNonNegativeInteger(w.endFrame, `${path}.frameWindow.endFrame`, ctx);
      if (endFrame <= startFrame || endFrame > totalFrames)
        throw new Error(`${ctx}: ${path}.frameWindow must be nonempty and within the move's ${totalFrames} frames`);
      frameWindow = { startFrame, endFrame };
    }
    const hurtbox = asObject(r.hurtbox, `${path}.hurtbox`, ctx);
    if (hurtbox.intangible !== undefined && typeof hurtbox.intangible !== 'boolean')
      throw new Error(`${ctx}: ${path}.hurtbox.intangible must be a boolean`);
    return {
      ...(phase === undefined ? {} : { phase: phase as MoveHurtboxModifier['phase'] }),
      ...(frameWindow === undefined ? {} : { frameWindow }),
      ...(r.replaceBody === undefined ? {} : { replaceBody: r.replaceBody as boolean }),
      hurtbox: { id: ensureString(hurtbox.id, `${path}.hurtbox.id`, ctx),
        ...(hurtbox.region === undefined ? {} : { region: ensureString(hurtbox.region, `${path}.hurtbox.region`, ctx) }),
        ...parseHitbox(hurtbox, `${path}.hurtbox`, ctx),
        ...(hurtbox.capsule === undefined ? {} : { capsule: parseCollisionCapsule(hurtbox.capsule, `${path}.hurtbox.capsule`, ctx) }),
        ...(hurtbox.intangible === undefined ? {} : { intangible: hurtbox.intangible as boolean }),
        ...(hurtbox.damageMultiplier === undefined ? {} : { damageMultiplier: ensureNonNegativeNumber(hurtbox.damageMultiplier, `${path}.hurtbox.damageMultiplier`, ctx) }),
      },
    };
  });
}

function parseCollisionCapsule(raw: unknown, path: string, ctx: string) {
  const capsule = asObject(raw, path, ctx);
  const point = (key: 'start' | 'end') => {
    const p = asObject(capsule[key], `${path}.${key}`, ctx);
    return { x: ensureFiniteNumber(p.x, `${path}.${key}.x`, ctx),
      y: ensureFiniteNumber(p.y, `${path}.${key}.y`, ctx) };
  };
  return { start: point('start'), end: point('end'), radius: ensurePositiveNumber(capsule.radius, `${path}.radius`, ctx) };
}

/** Explicit linking-hit behavior remains authorable through save/load. */
/** Optional launch side of a hit: forward, back or position (away from the attacker). */
function parseLaunchDirection(r: Record<string, unknown>, fieldPath: string, ctx: string) {
  if (r.launchDirection === undefined) return {};
  if (!['forward', 'back', 'position'].includes(String(r.launchDirection))) {
    throw new Error(`${ctx}: ${fieldPath}.launchDirection must be forward, back or position`);
  }
  return { launchDirection: r.launchDirection as 'forward' | 'back' | 'position' };
}
function parseHitLinkFields(r: Record<string, unknown>, fieldPath: string, ctx: string) {
  const tripChance = r.tripChance === undefined ? undefined
    : ensureNonNegativeNumber(r.tripChance, `${fieldPath}.tripChance`, ctx);
  if (tripChance !== undefined && tripChance > 1) throw new Error(`${ctx}: ${fieldPath}.tripChance must not exceed 1`);
  if (r.setoff !== undefined && !['on', 'off', 'through'].includes(String(r.setoff))) {
    throw new Error(`${ctx}: ${fieldPath}.setoff must be on, off or through`);
  }
  const minHitstunFrames = r.minHitstunFrames === undefined ? undefined
    : ensureNonNegativeInteger(r.minHitstunFrames, `${fieldPath}.minHitstunFrames`, ctx);
  if (minHitstunFrames !== undefined && minHitstunFrames > 120) {
    throw new Error(`${ctx}: ${fieldPath}.minHitstunFrames must not exceed 120`);
  }
  if (r.airborneVelocityCarry !== undefined && typeof r.airborneVelocityCarry !== 'boolean') {
    throw new Error(`${ctx}: ${fieldPath}.airborneVelocityCarry must be a boolean`);
  }
  if (r.electricCollision !== undefined && typeof r.electricCollision !== 'boolean') {
    throw new Error(`${ctx}: ${fieldPath}.electricCollision must be a boolean`);
  }
  if(r.sourcePoseRequired!==undefined&&typeof r.sourcePoseRequired!=='boolean')throw new Error(`${ctx}: ${fieldPath}.sourcePoseRequired must be boolean`);
  if(r.sourceRuntimeOwned!==undefined&&typeof r.sourceRuntimeOwned!=='boolean')throw new Error(`${ctx}: ${fieldPath}.sourceRuntimeOwned must be boolean`);
  if (r.nativeCollisionAttribute !== undefined && (typeof r.nativeCollisionAttribute !== 'string' || !r.nativeCollisionAttribute.trim()))
    throw new Error(`${ctx}: ${fieldPath}.nativeCollisionAttribute must be a nonempty string`);
  if (r.nativeForceReaction !== undefined && typeof r.nativeForceReaction !== 'boolean')
    throw new Error(`${ctx}: ${fieldPath}.nativeForceReaction must be boolean`);
  if(r.direct!==undefined&&typeof r.direct!=='boolean')throw new Error(`${ctx}: ${fieldPath}.direct must be boolean`);
  for(const flag of ['reflectable','absorbable'])if(r[flag]!==undefined&&typeof r[flag]!=='boolean')throw new Error(`${ctx}: ${fieldPath}.${flag} must be boolean`);
  if(r.statusEffect!==undefined&&r.statusEffect!=='bury')throw new Error(`${ctx}: ${fieldPath}.statusEffect only supports bury`);
  return {
    ...parseAttackHeightMetadata(r,`${ctx}.${fieldPath}`),
    ...(r.sourcePoseId===undefined?{}:{sourcePoseId:parseLinkSourcePoseId(r.sourcePoseId,`${ctx}.${fieldPath}.sourcePoseId`)}),
    ...(r.sourcePoseRequired===undefined?{}:{sourcePoseRequired:r.sourcePoseRequired as boolean}),
    ...(r.sourceRuntimeOwned===undefined?{}:{sourceRuntimeOwned:r.sourceRuntimeOwned as boolean}),
    ...(r.statusEffect===undefined?{}:{statusEffect:'bury' as const}),
    ...(r.direct===undefined?{}:{direct:r.direct as boolean}),
    ...(r.reflectable===undefined?{}:{reflectable:r.reflectable as boolean}),
    ...(r.absorbable===undefined?{}:{absorbable:r.absorbable as boolean}),
    ...(r.nativeCollisionAttribute === undefined ? {} : {nativeCollisionAttribute:r.nativeCollisionAttribute as string}),
    ...(r.nativeForceReaction === undefined ? {} : {nativeForceReaction:r.nativeForceReaction as boolean}),
    ...(tripChance === undefined ? {} : { tripChance }),
    ...(r.setoff === undefined ? {} : { setoff: r.setoff as 'on' | 'off' | 'through' }),
    ...(r.electricCollision === undefined ? {} : { electricCollision: r.electricCollision as boolean }),
    ...(r.shieldDamage === undefined ? {} : { shieldDamage: ensureFiniteNumber(r.shieldDamage, `${fieldPath}.shieldDamage`, ctx) }),
    ...(r.shieldSetoffMultiplier===undefined?{}:{shieldSetoffMultiplier:ensureNonNegativeNumber(r.shieldSetoffMultiplier,`${fieldPath}.shieldSetoffMultiplier`,ctx)}),
    ...parseLaunchDirection(r, fieldPath, ctx),
    ...(minHitstunFrames === undefined ? {} : { minHitstunFrames }),
    ...(r.hitlagMultiplier === undefined ? {} : { hitlagMultiplier:
      ensureNonNegativeNumber(r.hitlagMultiplier, `${fieldPath}.hitlagMultiplier`, ctx) }),
    ...(r.sdiMultiplier === undefined ? {} : { sdiMultiplier:
      ensureNonNegativeNumber(r.sdiMultiplier, `${fieldPath}.sdiMultiplier`, ctx) }),
    ...(r.airborneVelocityCarry === undefined ? {} : { airborneVelocityCarry: r.airborneVelocityCarry as boolean }),
  };
}

/** `allowEmpty` admits the Lab's explicit "harmless empty geometry" (a move-level `[]`). */
function parseCollisionHits(raw: unknown, fieldPath: string, ctx: string, allowEmpty = false): readonly AttackCollisionHit[] {
  if (!Array.isArray(raw) || (raw.length === 0 && !allowEmpty)) throw new Error(`${ctx}: ${fieldPath} must be a non-empty array`);
  const ids = new Set<number>();
  return raw.map((value, i) => {
    const path = `${fieldPath}[${i}]`, r = asObject(value, path, ctx);
    const id = ensureNonNegativeInteger(r.id, `${path}.id`, ctx);
    if (ids.has(id)) throw new Error(`${ctx}: ${path}.id must be unique within the strike`);
    ids.add(id);
    if (r.part !== undefined && r.part !== 0) throw new Error(`${ctx}: ${path}.part only supports source part zero`);
    if (r.situation !== undefined && r.situation !== 'ground' && r.situation !== 'air') {
      throw new Error(`${ctx}: ${path}.situation must be ground or air`);
    }
    if (r.targetCategory !== undefined && r.targetCategory !== 'fighter' && r.targetCategory !== 'all') {
      throw new Error(`${ctx}: ${path}.targetCategory must be fighter or all`);
    }
    return { id, ...parseHitLinkFields(r, path, ctx), capsule: parseCollisionCapsule(r.capsule, `${path}.capsule`, ctx),
      ...(r.rehitFrames === undefined ? {} : { rehitFrames: ensureNonNegativeInteger(r.rehitFrames, `${path}.rehitFrames`, ctx) }),
      ...(r.situation === undefined ? {} : { situation: r.situation as 'ground' | 'air' }),
      ...(r.targetCategory === undefined ? {} : { targetCategory: r.targetCategory as 'fighter' | 'all' }),
      ...(r.damage === undefined ? {} : { damage: ensureNonNegativeNumber(r.damage, `${path}.damage`, ctx) }),
      ...(r.knockback === undefined ? {} : { knockback: parseKnockback(r.knockback, `${path}.knockback`, ctx) }),
      ...(r.groundedKnockback === undefined ? {} : { groundedKnockback: parseKnockback(r.groundedKnockback, `${path}.groundedKnockback`, ctx) }),
      ...(r.hitlagMultiplier === undefined ? {} : { hitlagMultiplier: ensureNonNegativeNumber(r.hitlagMultiplier, `${path}.hitlagMultiplier`, ctx) }),
      ...(r.sdiMultiplier === undefined ? {} : { sdiMultiplier: ensureNonNegativeNumber(r.sdiMultiplier, `${path}.sdiMultiplier`, ctx) }),
    };
  });
}

/** Endpoint interpolation supports the legacy launch model only. */
function rejectChargedReferenceKnockback(raw: unknown, fieldPath: string, ctx: string): void {
  if (raw !== null && typeof raw === 'object'
    && (raw as Record<string, unknown>).reference !== undefined) {
    throw new Error(`${ctx}: ${fieldPath}.reference is not supported for charged attacks`);
  }
}

/** Shared numerical attack fields, also used by the legacy neutral aerials. */
function parseAttackBase(
  raw: unknown,
  fieldPath: string,
  ctx: string,
): Omit<AttackMoveWithAnimation, 'animation'> {
  if (raw === null || typeof raw !== 'object') {
    throw new Error(`${ctx}: ${fieldPath} must be an object`);
  }
  const r = raw as Record<string, unknown>;
  if (r.launchAwayFromSource !== undefined && typeof r.launchAwayFromSource !== 'boolean') {
    throw new Error(`${ctx}: ${fieldPath}.launchAwayFromSource must be a boolean`);
  }
  const charge = r.charge === undefined ? undefined : parseChargeSpecRecord(
    asObject(r.charge, `${fieldPath}.charge`, ctx), `${fieldPath}.charge`, ctx,
  );
  const damageOnly = charge?.knockbackMode === 'damage-only';
  const chargedProjectile = r.chargedProjectile === undefined ? undefined
    : asObject(r.chargedProjectile, `${fieldPath}.chargedProjectile`, ctx);
  const projectileCharge = chargedProjectile?.charge === undefined ? undefined
    : asObject(chargedProjectile.charge, `${fieldPath}.chargedProjectile.charge`, ctx);
  const projectileDamageOnly = projectileCharge?.knockbackMode === 'damage-only';
  if (projectileDamageOnly && r.specialKind !== 'projectile') {
    throw new Error(`${ctx}: ${fieldPath}.chargedProjectile.charge.knockbackMode requires a projectile special`);
  }
  if (projectileDamageOnly && (r.knockback === null || typeof r.knockback !== 'object'
    || (r.knockback as Record<string, unknown>).reference === undefined)) {
    throw new Error(`${ctx}: ${fieldPath}.chargedProjectile.charge.knockbackMode 'damage-only' requires ${fieldPath}.knockback.reference`);
  }
  if (damageOnly) {
    if (r.specialKind === 'projectile' || r.projectile !== undefined || r.chargedProjectile !== undefined) {
      throw new Error(`${ctx}: ${fieldPath}.charge.knockbackMode is only supported for melee charges`);
    }
    // This explicit mode is the reference-launch charge contract. Keep legacy
    // saves on their existing endpoint interpolation path unless migrated.
    if (r.knockback === null || typeof r.knockback !== 'object'
      || (r.knockback as Record<string, unknown>).reference === undefined) {
      throw new Error(`${ctx}: ${fieldPath}.charge.knockbackMode 'damage-only' requires ${fieldPath}.knockback.reference`);
    }
  }
  if ((!damageOnly && charge !== undefined) || r.chargedProjectile !== undefined && !projectileDamageOnly) {
    const rejectCollisionReferences = (rawHits: unknown, path: string) => {
      if (!Array.isArray(rawHits)) return;
      rawHits.forEach((value, i) => {
        const hit = asObject(value, `${path}[${i}]`, ctx);
        for (const key of ['knockback', 'groundedKnockback']) rejectChargedReferenceKnockback(hit[key], `${path}[${i}].${key}`, ctx);
      });
    };
    rejectCollisionReferences(r.collisionHits, `${fieldPath}.collisionHits`);
    for (const key of ['knockback', 'groundedKnockback']) {
      rejectChargedReferenceKnockback(r[key], `${fieldPath}.${key}`, ctx);
    }
    if (r.sweetSpot !== null && typeof r.sweetSpot === 'object') {
      rejectChargedReferenceKnockback((r.sweetSpot as Record<string, unknown>).knockback,
        `${fieldPath}.sweetSpot.knockback`, ctx);
    }
    if (Array.isArray(r.hitWindows)) {
      r.hitWindows.forEach((window: unknown, i: number) => {
        if (window === null || typeof window !== 'object') return;
        rejectCollisionReferences((window as Record<string, unknown>).collisionHits, `${fieldPath}.hitWindows[${i}].collisionHits`);
        for (const key of ['knockback', 'groundedKnockback']) {
          rejectChargedReferenceKnockback((window as Record<string, unknown>)[key],
            `${fieldPath}.hitWindows[${i}].${key}`, ctx);
        }
        const sweet = (window as Record<string, unknown>).sweetSpot;
        if (sweet !== null && typeof sweet === 'object') {
          rejectChargedReferenceKnockback((sweet as Record<string, unknown>).knockback,
            `${fieldPath}.hitWindows[${i}].sweetSpot.knockback`, ctx);
        }
      });
    }
  }
  const ledgeRootMotion = r.ledgeRootMotion === undefined ? undefined : (() => {
    if (!Array.isArray(r.ledgeRootMotion)) throw new Error(`${ctx}: ${fieldPath}.ledgeRootMotion must be an array`);
    const points: readonly LedgeRootPoint[] = r.ledgeRootMotion.map((value, index) => {
      const point = asObject(value, `${fieldPath}.ledgeRootMotion[${index}]`, ctx);
      return {x: ensureFiniteNumber(point.x, `${fieldPath}.ledgeRootMotion[${index}].x`, ctx),
        y: ensureFiniteNumber(point.y, `${fieldPath}.ledgeRootMotion[${index}].y`, ctx)};
    });
    validateLedgeRootMotion(points, Number(r.startupFrames) + Number(r.activeFrames) + Number(r.recoveryFrames));
    return points;
  })();
  return {
    ...(r.absorber===undefined?{}:{absorber:parseAttackAbsorbWindow(r.absorber,`${ctx}.${fieldPath}.absorber`)}),
    ...(ledgeRootMotion === undefined ? {} : {ledgeRootMotion}),
    ...(r.gravityScale === undefined ? {} : {gravityScale: ensureNonNegativeNumber(r.gravityScale, `${fieldPath}.gravityScale`, ctx)}),
    ...(r.entryVelocityScale === undefined ? {} : {entryVelocityScale: (() => {
      const row = asObject(r.entryVelocityScale, `${fieldPath}.entryVelocityScale`, ctx);
      return {xGround: ensureNonNegativeNumber(row.xGround, `${fieldPath}.entryVelocityScale.xGround`, ctx),
        xAir: ensureNonNegativeNumber(row.xAir, `${fieldPath}.entryVelocityScale.xAir`, ctx),
        yGround: ensureNonNegativeNumber(row.yGround, `${fieldPath}.entryVelocityScale.yGround`, ctx),
        yAir: ensureNonNegativeNumber(row.yAir, `${fieldPath}.entryVelocityScale.yAir`, ctx)};
    })()}),
    ...(r.groundedMotion === undefined ? {} : {groundedMotion: (() => {
      const row = asObject(r.groundedMotion, `${fieldPath}.groundedMotion`, ctx);
      return {acceleration: ensureNonNegativeNumber(row.acceleration, `${fieldPath}.groundedMotion.acceleration`, ctx),
        friction: ensureNonNegativeNumber(row.friction, `${fieldPath}.groundedMotion.friction`, ctx),
        maxSpeed: ensurePositiveNumber(row.maxSpeed, `${fieldPath}.groundedMotion.maxSpeed`, ctx),
        ...(row.postHitFriction === undefined ? {} : {postHitFriction: ensureNonNegativeNumber(row.postHitFriction, `${fieldPath}.groundedMotion.postHitFriction`, ctx)}),
        ...(row.postHitFrame === undefined ? {} : {postHitFrame: ensureNonNegativeInteger(row.postHitFrame, `${fieldPath}.groundedMotion.postHitFrame`, ctx)})};
    })()}),
    ...(r.protectionWindows === undefined ? {} : { protectionWindows: (() => {
      if (!Array.isArray(r.protectionWindows)) throw new Error(`${ctx}: ${fieldPath}.protectionWindows must be an array`);
      return r.protectionWindows.map((value, index) => {
        const path = `${fieldPath}.protectionWindows[${index}]`, row = asObject(value, path, ctx);
        const startFrame = ensureNonNegativeInteger(row.startFrame, `${path}.startFrame`, ctx);
        const endFrame = ensureNonNegativeInteger(row.endFrame, `${path}.endFrame`, ctx);
        const paired=getDonkeyKongPairedProtectionTimeline({id:typeof r.id==='string'?r.id:undefined,type:typeof r.type==='string'?r.type:undefined,
          sheetVariant:typeof r.sheetVariant==='string'?r.sheetVariant:undefined,aerialDirection:typeof r.aerialDirection==='string'?r.aerialDirection:undefined});
        const extent=paired?.timeline.endFrame??Number(r.startupFrames)+Number(r.activeFrames)+Number(r.recoveryFrames);
        if (endFrame <= startFrame || endFrame > extent)
          throw new Error(`${ctx}: ${path} must fit the ${paired?'paired source-animation':'action'} timeline`);
        if (!Array.isArray(row.regions) || !row.regions.length)
          throw new Error(`${ctx}: ${path}.regions must be a nonempty array`);
        const regions = row.regions.map((region, i) => ensureString(region, `${path}.regions[${i}]`, ctx));
        if (regions.some(region => !region.trim()) || new Set(regions).size !== regions.length)
          throw new Error(`${ctx}: ${path}.regions must contain unique nonempty identities`);
        return { startFrame, endFrame, regions };
      });
    })() }),
    ...parseHitLinkFields(r, fieldPath, ctx),
    ...(r.airborneVariant === undefined ? {} : { airborneVariant: parseGroundedAttack(r.airborneVariant, `${fieldPath}.airborneVariant`, ctx) }),
    ...(r.pikachuSpecial === undefined ? {} : { pikachuSpecial: validatePikachuSpecialPreset(r.pikachuSpecial) }),
    ...(r.fullChargeVariant === undefined ? {} : { fullChargeVariant: parseGroundedAttack(r.fullChargeVariant, `${fieldPath}.fullChargeVariant`, ctx) }),
    ...(r.angledVariants === undefined ? {} : { angledVariants: (() => {
      const a = asObject(r.angledVariants, `${fieldPath}.angledVariants`, ctx);
      return { up: parseGroundedAttack(a.up, `${fieldPath}.angledVariants.up`, ctx), down: parseGroundedAttack(a.down, `${fieldPath}.angledVariants.down`, ctx) };
    })() }),
    ...(r.collisionHits === undefined ? {} : { collisionHits: parseCollisionHits(r.collisionHits, `${fieldPath}.collisionHits`, ctx, true) }),
    ...(r.launchAwayFromSource === undefined ? {} : { launchAwayFromSource: r.launchAwayFromSource as boolean }),
    ...(r.sheetVariant === undefined ? {} : { sheetVariant: ensureString(r.sheetVariant, `${fieldPath}.sheetVariant`, ctx) as AttackMoveWithAnimation['sheetVariant'] }),
    id: ensureString(r.id, `${fieldPath}.id`, ctx),
    type: ensureString(r.type, `${fieldPath}.type`, ctx) as AttackMoveWithAnimation['type'],
    damage: ensureFiniteNumber(r.damage, `${fieldPath}.damage`, ctx),
    knockback: parseKnockback(r.knockback, `${fieldPath}.knockback`, ctx),
    ...(r.groundedKnockback === undefined ? {} : { groundedKnockback: parseKnockback(r.groundedKnockback, `${fieldPath}.groundedKnockback`, ctx) }),
    hitbox: parseHitbox(r.hitbox, `${fieldPath}.hitbox`, ctx),
    startupFrames: ensureNonNegativeInteger(
      r.startupFrames,
      `${fieldPath}.startupFrames`,
      ctx,
    ),
    activeFrames: ensureNonNegativeInteger(
      r.activeFrames,
      `${fieldPath}.activeFrames`,
      ctx,
    ),
    recoveryFrames: ensureNonNegativeInteger(
      r.recoveryFrames,
      `${fieldPath}.recoveryFrames`,
      ctx,
    ),
    cooldownFrames: ensureNonNegativeInteger(
      r.cooldownFrames,
      `${fieldPath}.cooldownFrames`,
      ctx,
    ),
    ...(r.specialLandingLagFrames === undefined ? {} : {
      specialLandingLagFrames: ensureNonNegativeInteger(
        r.specialLandingLagFrames, `${fieldPath}.specialLandingLagFrames`, ctx,
      ),
    }),
    ...(r.armorWindows === undefined ? {} : { armorWindows: parseArmorWindows(r.armorWindows,
      `${fieldPath}.armorWindows`, ctx,
      Number(r.startupFrames) + Number(r.activeFrames) + Number(r.recoveryFrames)) }),
    // Optional Tier-4 enrichments — carried through verbatim so a smash's
    // hold-to-charge ramp and a jab's combo link round-trip from the data
    // file. Omitted-stays-omitted keeps every legacy move byte-identical.
    ...(charge === undefined ? {} : { charge }),
    ...(r.chargeStartFrame === undefined ? {} : { chargeStartFrame: (() => {
      const frame = ensureNonNegativeInteger(r.chargeStartFrame, `${fieldPath}.chargeStartFrame`, ctx);
      if (!r.charge || frame >= Number(r.startupFrames)) throw new Error(`${ctx}: ${fieldPath}.chargeStartFrame requires charge and must precede the active window`);
      return frame;
    })() }),
    ...(r.jabChain !== undefined
      ? { jabChain: parseJabChainRecord(r.jabChain, `${fieldPath}.jabChain`, ctx) }
      : {}),
    ...(r.followUp === undefined ? {} : { followUp: (() => {
      const follow = asObject(r.followUp, `${fieldPath}.followUp`, ctx);
      const windowStart = ensureNonNegativeInteger(follow.windowStart, `${fieldPath}.followUp.windowStart`, ctx);
      const windowEnd = ensureNonNegativeInteger(follow.windowEnd, `${fieldPath}.followUp.windowEnd`, ctx);
      if (windowEnd <= windowStart || windowEnd > Number(r.startupFrames) + Number(r.activeFrames) + Number(r.recoveryFrames)) {
        throw new Error(`${ctx}: ${fieldPath}.followUp must fit inside the move timeline`);
      }
      return { nextId: ensureString(follow.nextId, `${fieldPath}.followUp.nextId`, ctx), windowStart, windowEnd };
    })() }),
    ...(r.hitWindows === undefined ? {} : { hitWindows: (() => {
      if (!Array.isArray(r.hitWindows) || r.hitWindows.length === 0) {
        throw new Error(`${ctx}: ${fieldPath}.hitWindows must be a non-empty array`);
      }
      let previousEnd = Number(r.startupFrames);
      return r.hitWindows.map((rawWindow, i) => {
        const path = `${fieldPath}.hitWindows[${i}]`;
        const w = asObject(rawWindow, path, ctx);
        const startFrame = ensureNonNegativeInteger(w.startFrame, `${path}.startFrame`, ctx);
        const endFrame = ensureNonNegativeInteger(w.endFrame, `${path}.endFrame`, ctx);
        if (startFrame < previousEnd || endFrame <= startFrame
          || endFrame > Number(r.startupFrames) + Number(r.activeFrames)) {
          throw new Error(`${ctx}: ${path} must be ordered, non-overlapping and inside the active envelope`);
        }
        previousEnd = endFrame;
        if (w.facing !== undefined && w.facing !== 1 && w.facing !== -1) {
          throw new Error(`${ctx}: ${path}.facing must be 1 or -1`);
        }
        return {
          startFrame, endFrame,
          ...parseHitLinkFields(w, path, ctx),
          ...(w.collisionHits === undefined ? {} : { collisionHits: parseCollisionHits(w.collisionHits, `${path}.collisionHits`, ctx) }),
          ...(w.group === undefined ? {} : { group: ensureString(w.group, `${path}.group`, ctx) }),
          ...(w.facing === undefined ? {} : { facing: w.facing as 1 | -1 }),
          ...(w.damage === undefined ? {} : { damage: ensureNonNegativeNumber(w.damage, `${path}.damage`, ctx) }),
          ...(w.knockback === undefined ? {} : { knockback: parseKnockback(w.knockback, `${path}.knockback`, ctx) }),
          ...(w.groundedKnockback === undefined ? {} : { groundedKnockback: parseKnockback(w.groundedKnockback, `${path}.groundedKnockback`, ctx) }),
          ...(w.hitbox === undefined ? {} : { hitbox: parseHitbox(w.hitbox, `${path}.hitbox`, ctx) }),
          ...(w.sweetSpot === undefined ? {} : { sweetSpot: (() => {
            const sweet = asObject(w.sweetSpot, `${path}.sweetSpot`, ctx);
            return {
              hitbox: parseHitbox(sweet.hitbox, `${path}.sweetSpot.hitbox`, ctx),
              ...(sweet.damageMultiplier === undefined ? {} : { damageMultiplier: ensureNonNegativeNumber(sweet.damageMultiplier, `${path}.sweetSpot.damageMultiplier`, ctx) }),
              ...(sweet.knockbackMultiplier === undefined ? {} : { knockbackMultiplier: ensureNonNegativeNumber(sweet.knockbackMultiplier, `${path}.sweetSpot.knockbackMultiplier`, ctx) }),
              ...(sweet.knockback === undefined ? {} : { knockback: parseKnockback(sweet.knockback, `${path}.sweetSpot.knockback`, ctx) }),
            };
          })() }),
        };
      });
    })() }),
    ...(r.sweetSpot !== undefined ? { sweetSpot: (() => {
      const sweetSpot = asObject(r.sweetSpot, `${fieldPath}.sweetSpot`, ctx);
      return {
        hitbox: parseHitbox(sweetSpot.hitbox, `${fieldPath}.sweetSpot.hitbox`, ctx),
        ...(sweetSpot.damageMultiplier === undefined ? {} : { damageMultiplier:
          ensureNonNegativeNumber(sweetSpot.damageMultiplier, `${fieldPath}.sweetSpot.damageMultiplier`, ctx) }),
        ...(sweetSpot.knockbackMultiplier === undefined ? {} : { knockbackMultiplier:
          ensureNonNegativeNumber(sweetSpot.knockbackMultiplier, `${fieldPath}.sweetSpot.knockbackMultiplier`, ctx) }),
        ...(sweetSpot.knockback === undefined ? {} : { knockback:
          parseKnockback(sweetSpot.knockback, `${fieldPath}.sweetSpot.knockback`, ctx) }),
      };
    })() } : {}),
  };
}

/** Narrow an unknown to a record, throwing a contextual error otherwise. */
function asObject(
  raw: unknown,
  fieldPath: string,
  ctx: string,
): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object') {
    throw new Error(`${ctx}: ${fieldPath} must be an object`);
  }
  return raw as Record<string, unknown>;
}

/** Parse a jab-combo link `{ nextId, advanceWindowStart? }`. */
/**
 * Super-armour windows: a non-empty array of `{ startFrame, endFrame }`
 * zero-based half-open elapsed intervals inside the move's busy timeline.
 */
function parseArmorWindows(
  raw: unknown,
  fieldPath: string,
  ctx: string,
  busyTotal: number,
): ReadonlyArray<{ readonly startFrame: number; readonly endFrame: number; readonly minChargeRatio?: number }> {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`${ctx}: ${fieldPath} must be a non-empty array`);
  }
  return raw.map((entry, i) => {
    const w = asObject(entry, `${fieldPath}[${i}]`, ctx);
    const startFrame = ensureNonNegativeInteger(w.startFrame, `${fieldPath}[${i}].startFrame`, ctx);
    const endFrame = ensureNonNegativeInteger(w.endFrame, `${fieldPath}[${i}].endFrame`, ctx);
    if (endFrame <= startFrame || endFrame > busyTotal) {
      throw new Error(`${ctx}: ${fieldPath}[${i}] must satisfy startFrame < endFrame <= ${busyTotal}`);
    }
    if (w.minChargeRatio === undefined) return { startFrame, endFrame };
    const minChargeRatio = ensureNonNegativeNumber(w.minChargeRatio, `${fieldPath}[${i}].minChargeRatio`, ctx);
    if (minChargeRatio > 1) throw new Error(`${ctx}: ${fieldPath}[${i}].minChargeRatio must not exceed 1`);
    return { startFrame, endFrame, minChargeRatio };
  });
}

function parseJabChainRecord(
  raw: unknown,
  fieldPath: string,
  ctx: string,
): { nextId: string; advanceWindowStart?: number; continuationWindowEndFrame?:number } {
  const r = asObject(raw, fieldPath, ctx);
  const end=r.continuationWindowEndFrame===undefined?undefined:ensureNonNegativeInteger(
    r.continuationWindowEndFrame,`${fieldPath}.continuationWindowEndFrame`,ctx);
  if(end!==undefined&&(end===0||end<=Number(r.advanceWindowStart??0)))
    throw new Error(`${ctx}: ${fieldPath}.continuationWindowEndFrame must exceed the source advance age`);
  return {
    nextId: ensureString(r.nextId, `${fieldPath}.nextId`, ctx),
    ...(end===undefined?{}:{continuationWindowEndFrame:end}),
    ...(r.advanceWindowStart !== undefined
      ? {
          advanceWindowStart: ensureNonNegativeInteger(
            r.advanceWindowStart,
            `${fieldPath}.advanceWindowStart`,
            ctx,
          ),
        }
      : {}),
  };
}

/**
 * Parse an aerial move (fair / nair / uair / dair). Same fields as
 * {@link parseGroundedAttack} plus `landingLagFrames` and the
 * optional `autoCancelWindows`.
 */
function parseAerial(
  raw: unknown,
  fieldPath: string,
  ctx: string,
): AerialMove {
  const base = parseGroundedAttack(raw, fieldPath, ctx);
  const r = raw as Record<string, unknown>;
  const aerialDirection = ensureString(
    r.aerialDirection,
    `${fieldPath}.aerialDirection`,
    ctx,
  );
  if (
    aerialDirection !== 'neutral' &&
    aerialDirection !== 'forward' &&
    aerialDirection !== 'back' &&
    aerialDirection !== 'up' &&
    aerialDirection !== 'down'
  ) {
    throw new Error(
      `${ctx}: ${fieldPath}.aerialDirection must be one of [neutral, forward, back, up, down], got '${aerialDirection}'`,
    );
  }
  const landingLagFrames = ensureNonNegativeInteger(
    r.landingLagFrames,
    `${fieldPath}.landingLagFrames`,
    ctx,
  );
  if (r.geometryFacing !== undefined && r.geometryFacing !== 'fighter' && r.geometryFacing !== 'attack-direction')
    throw new Error(`${ctx}: ${fieldPath}.geometryFacing must be fighter or attack-direction`);
  if (r.rehitClockPolicy !== undefined && r.rehitClockPolicy !== 'authored-attack-elapsed')
    throw new Error(`${ctx}: ${fieldPath}.rehitClockPolicy must be authored-attack-elapsed`);
  const autoCancelRaw = r.autoCancelWindows;
  let autoCancelWindows: ReadonlyArray<{
    startFrame: number;
    endFrame: number;
  }> = [];
  if (autoCancelRaw !== undefined) {
    if (!Array.isArray(autoCancelRaw)) {
      throw new Error(`${ctx}: ${fieldPath}.autoCancelWindows must be an array`);
    }
    autoCancelWindows = autoCancelRaw.map((entry, idx) => {
      if (entry === null || typeof entry !== 'object') {
        throw new Error(
          `${ctx}: ${fieldPath}.autoCancelWindows[${idx}] must be an object`,
        );
      }
      const e = entry as Record<string, unknown>;
      const startFrame = ensureNonNegativeInteger(
        e.startFrame,
        `${fieldPath}.autoCancelWindows[${idx}].startFrame`,
        ctx,
      );
      const endFrame = ensureNonNegativeInteger(
        e.endFrame,
        `${fieldPath}.autoCancelWindows[${idx}].endFrame`,
        ctx,
      );
      if (endFrame <= startFrame) {
        throw new Error(
          `${ctx}: ${fieldPath}.autoCancelWindows[${idx}] requires endFrame > startFrame, got [${startFrame}, ${endFrame})`,
        );
      }
      return { startFrame, endFrame };
    });
  }
  const result = {
    ...base,
    aerialDirection,
    ...(r.geometryFacing === undefined ? {} : { geometryFacing: r.geometryFacing as 'fighter' | 'attack-direction' }),
    landingLagFrames,
    autoCancelWindows,
    ...(r.rehitClockPolicy === undefined ? {} : { rehitClockPolicy: r.rehitClockPolicy as 'authored-attack-elapsed' }),
    ...(r.landingAttack === undefined ? {} : { landingAttack: parseGroundedAttack(r.landingAttack, `${fieldPath}.landingAttack`, ctx) }),
    ...(r.rebound === undefined ? {} : { rebound: (() => {
      const rebound = asObject(r.rebound, `${fieldPath}.rebound`, ctx);
      const upwardSpeed = ensurePositiveNumber(rebound.upwardSpeed, `${fieldPath}.rebound.upwardSpeed`, ctx);
      const rehitFrames = ensureNonNegativeInteger(rebound.rehitFrames, `${fieldPath}.rebound.rehitFrames`, ctx);
      if (rehitFrames === 0) throw new Error(`${ctx}: ${fieldPath}.rebound.rehitFrames must be a positive integer`);
      if (rebound.disableOnFastFall !== undefined && typeof rebound.disableOnFastFall !== 'boolean') {
        throw new Error(`${ctx}: ${fieldPath}.rebound.disableOnFastFall must be a boolean`);
      }
      return {
        upwardSpeed, rehitFrames,
        ...(rebound.disableOnFastFall === undefined ? {} : { disableOnFastFall: rebound.disableOnFastFall as boolean }),
        ...(rebound.returnHit === undefined ? {} : { returnHit: (() => {
          const hit = asObject(rebound.returnHit, `${fieldPath}.rebound.returnHit`, ctx);
          return {
            damage: ensureNonNegativeNumber(hit.damage, `${fieldPath}.rebound.returnHit.damage`, ctx),
            knockback: parseKnockback(hit.knockback, `${fieldPath}.rebound.returnHit.knockback`, ctx),
            hitbox: parseHitbox(hit.hitbox, `${fieldPath}.rebound.returnHit.hitbox`, ctx),
            ...parseLaunchDirection(hit, `${fieldPath}.rebound.returnHit`, ctx),
          };
        })() }),
      };
    })() }),
  } as AerialMove;
  validateAerialLandingAttack(result);
  return result;
}

/** Only the neutral slot accepts the existing plain attack shape. A partial
 * authored aerial must still satisfy the full schema instead of silently
 * dropping its animation or landing behavior. */
function parseNeutralAerial(raw: unknown, fieldPath: string, ctx: string): AerialMove | LegacyNeutralAerialMove {
  const r = asObject(raw, fieldPath, ctx);
  const legacy = ['animation', 'aerialDirection', 'geometryFacing', 'landingLagFrames', 'autoCancelWindows', 'rebound', 'landingAttack', 'rehitClockPolicy']
    .every(key => r[key] === undefined);
  if (!legacy) return parseAerial(raw, fieldPath, ctx);
  const base = parseAttackBase(raw, fieldPath, ctx);
  if (base.type !== 'aerial') throw new Error(`${ctx}: ${fieldPath}.type must be 'aerial'`);
  return { ...base, type: 'aerial' };
}

/**
 * Parse a single throw spec. Delegates the value-range checks to
 * {@link validateThrowSpec} (which `validateThrowSet` calls inside
 * {@link parseGrab} via the throws block).
 */
function parseThrow(
  raw: unknown,
  fieldPath: string,
  ctx: string,
): ThrowSpec {
  if (raw === null || typeof raw !== 'object') {
    throw new Error(`${ctx}: ${fieldPath} must be an object`);
  }
  const r = raw as Record<string, unknown>;
  if (r.electricCollision !== undefined && typeof r.electricCollision !== 'boolean')
    throw new Error(`${ctx}: ${fieldPath}.electricCollision must be a boolean`);
  if(r.launchFacing!==undefined&&r.launchFacing!=='actor'&&r.launchFacing!=='opposite')throw new Error(`${ctx}: ${fieldPath}.launchFacing must be actor or opposite`);
  if(r.reverseFacingAtRelease!==undefined&&typeof r.reverseFacingAtRelease!=='boolean')throw new Error(`${ctx}: ${fieldPath}.reverseFacingAtRelease must be a boolean`);
  return {
    ...(r.launchFacing===undefined?{}:{launchFacing:r.launchFacing as 'actor'|'opposite'}),
    ...(r.reverseFacingAtRelease===undefined?{}:{reverseFacingAtRelease:r.reverseFacingAtRelease as boolean}),
    ...(r.releaseVelocity===undefined?{}:{releaseVelocity:(()=>{
      const v=asObject(r.releaseVelocity,`${fieldPath}.releaseVelocity`,ctx);
      if(v.situation!==undefined&&v.situation!=='ground'&&v.situation!=='air')throw new Error(`${ctx}: ${fieldPath}.releaseVelocity.situation must be ground or air`);
      return{x:ensureFiniteNumber(v.x,`${fieldPath}.releaseVelocity.x`,ctx),y:ensureFiniteNumber(v.y,`${fieldPath}.releaseVelocity.y`,ctx),
        ...(v.situation===undefined?{}:{situation:v.situation as 'ground'|'air'})};
    })()}),
    damage: ensureFiniteNumber(r.damage, `${fieldPath}.damage`, ctx),
    knockback: parseKnockback(r.knockback, `${fieldPath}.knockback`, ctx),
    ...(r.hitlagMultiplier === undefined ? {} : { hitlagMultiplier:
      ensureNonNegativeNumber(r.hitlagMultiplier, `${fieldPath}.hitlagMultiplier`, ctx) }),
    ...(r.invincibilityFrames === undefined ? {} : { invincibilityFrames:
      ensureNonNegativeInteger(r.invincibilityFrames, `${fieldPath}.invincibilityFrames`, ctx) }),
    ...(r.knockbackArmor === undefined ? {} : { knockbackArmor:
      ensureNonNegativeNumber(r.knockbackArmor, `${fieldPath}.knockbackArmor`, ctx) }),
    ...(r.electricCollision === undefined ? {} : { electricCollision: r.electricCollision as boolean }),
    ...(r.rootMotionX === undefined ? {} : { rootMotionX: (() => {
      if (!Array.isArray(r.rootMotionX)) throw new Error(`${ctx}: ${fieldPath}.rootMotionX must be an array`);
      return r.rootMotionX.map((value, index) => ensureFiniteNumber(value, `${fieldPath}.rootMotionX[${index}]`, ctx));
    })() }),
    ...(r.heldTargetHits === undefined ? {} : { heldTargetHits: (() => {
      if (!Array.isArray(r.heldTargetHits)) throw new Error(`${ctx}: ${fieldPath}.heldTargetHits must be an array`);
      return r.heldTargetHits.map((hit, index) => {
        const path = `${fieldPath}.heldTargetHits[${index}]`;
        const value = asObject(hit, path, ctx);
        if (value.electricCollision !== undefined && typeof value.electricCollision !== 'boolean') throw new Error(`${ctx}: ${path}.electricCollision must be a boolean`);
        return { frame: ensureNonNegativeInteger(value.frame, `${path}.frame`, ctx),
          damage: ensureNonNegativeNumber(value.damage, `${path}.damage`, ctx),
          ...(value.hitlagDamage === undefined ? {} : { hitlagDamage:
            ensureNonNegativeNumber(value.hitlagDamage, `${path}.hitlagDamage`, ctx) }),
          ...(value.electricCollision === undefined ? {} : { electricCollision: value.electricCollision as boolean }),
          ...(value.hitlagMultiplier === undefined ? {} : { hitlagMultiplier:
            ensureNonNegativeNumber(value.hitlagMultiplier, `${path}.hitlagMultiplier`, ctx) }) };
      });
    })() }),
    ...(r.recoveryFrames === undefined ? {} : { recoveryFrames: ensureNonNegativeInteger(r.recoveryFrames, `${fieldPath}.recoveryFrames`, ctx) }),
    animationFrames: ensureNonNegativeInteger(
      r.animationFrames,
      `${fieldPath}.animationFrames`,
      ctx,
    ),
  };
}

function parseThrowSet(
  raw: unknown,
  fieldPath: string,
  ctx: string,
): ThrowSet {
  if (raw === null || typeof raw !== 'object') {
    throw new Error(`${ctx}: ${fieldPath} must be an object`);
  }
  const r = raw as Record<string, unknown>;
  const set: ThrowSet = {
    forward: parseThrow(r.forward, `${fieldPath}.forward`, ctx),
    back: parseThrow(r.back, `${fieldPath}.back`, ctx),
    up: parseThrow(r.up, `${fieldPath}.up`, ctx),
    down: parseThrow(r.down, `${fieldPath}.down`, ctx),
  };
  validateThrowSet(set, `${ctx} ${fieldPath}`);
  return set;
}

/**
 * Parse a grab spec. Delegates the deep value validation to
 * {@link validateGrabSpec} after building the typed record from raw
 * JSON.
 */
function parseGrabVariant(raw: unknown, path: string, ctx: string): NonNullable<GrabSpec['dashGrab']> {
  const d = asObject(raw, path, ctx);
  return { rangeBonusX: ensureNonNegativeNumber(d.rangeBonusX, `${path}.rangeBonusX`, ctx),
    ...(d.collisionHits === undefined ? {} : { collisionHits: parseCollisionHits(d.collisionHits, `${path}.collisionHits`, ctx) }),
    momentumRetain: ensureFiniteNumber(d.momentumRetain, `${path}.momentumRetain`, ctx),
    ...(d.hitbox === undefined ? {} : { hitbox: parseHitbox(d.hitbox, `${path}.hitbox`, ctx) }),
    ...Object.fromEntries(['startupFrames', 'activeFrames', 'whiffRecoveryFrames'].filter(k => d[k] !== undefined)
      .map(k => [k, ensureNonNegativeInteger(d[k], `${path}.${k}`, ctx)])) };
}

function parseGrab(raw: unknown, fieldPath: string, ctx: string): GrabSpec {
  if (raw === null || typeof raw !== 'object') {
    throw new Error(`${ctx}: ${fieldPath} must be an object`);
  }
  const r = raw as Record<string, unknown>;
  const pummelRaw = r.pummel;
  const pummel =
    pummelRaw === undefined
      ? undefined
      : (() => {
          if (pummelRaw === null || typeof pummelRaw !== 'object') {
            throw new Error(`${ctx}: ${fieldPath}.pummel must be an object`);
          }
          const p = pummelRaw as Record<string, unknown>;
          return {
            ...(p.motionFrames === undefined ? {} : {motionFrames:ensureNonNegativeInteger(p.motionFrames,`${fieldPath}.pummel.motionFrames`,ctx)}),
            ...(p.hitlagFrames === undefined ? {} : { hitlagFrames: ensureNonNegativeInteger(p.hitlagFrames, `${fieldPath}.pummel.hitlagFrames`, ctx) }),
            ...parseHitLinkFields(p, `${fieldPath}.pummel`, ctx),
            ...(p.startupFrames === undefined ? {} : { startupFrames: ensureNonNegativeInteger(p.startupFrames, `${fieldPath}.pummel.startupFrames`, ctx) }),
            ...(p.knockback === undefined ? {} : { knockback: parseKnockback(p.knockback, `${fieldPath}.pummel.knockback`, ctx) }),
            damage: ensureFiniteNumber(p.damage, `${fieldPath}.pummel.damage`, ctx),
            cooldownFrames: ensureNonNegativeInteger(
              p.cooldownFrames,
              `${fieldPath}.pummel.cooldownFrames`,
              ctx,
            ),
          };
        })();
  if (r.ultimateCapture !== undefined && typeof r.ultimateCapture !== 'boolean') throw new Error(`${ctx}: ${fieldPath}.ultimateCapture must be a boolean`);
  const spec: GrabSpec = {
    ...(parseAuthoredCaptureMotionFamily(r,`${ctx}.${fieldPath}`)??{}),
    ...(r.attachmentPolicy===undefined?{}:{attachmentPolicy:(()=>{if(r.attachmentPolicy!=='pose-anchors-beta-v1')throw new Error(`${ctx}: ${fieldPath}.attachmentPolicy must be pose-anchors-beta-v1`);return 'pose-anchors-beta-v1' as const;})()}),
    ...(r.throwClock===undefined?{}:{throwClock:(()=>{if(r.throwClock!=='native-sample-one')throw new Error(`${ctx}: ${fieldPath}.throwClock must be native-sample-one`);return 'native-sample-one' as const;})()}),
    ...(r.ultimateCapture === undefined ? {} : {ultimateCapture: r.ultimateCapture as boolean}),
    ...(r.collisionHits === undefined ? {} : { collisionHits: parseCollisionHits(r.collisionHits, `${fieldPath}.collisionHits`, ctx) }),
    id: ensureString(r.id, `${fieldPath}.id`, ctx),
    hitbox: parseHitbox(r.hitbox, `${fieldPath}.hitbox`, ctx),
    startupFrames: ensureNonNegativeInteger(
      r.startupFrames,
      `${fieldPath}.startupFrames`,
      ctx,
    ),
    activeFrames: ensureNonNegativeInteger(
      r.activeFrames,
      `${fieldPath}.activeFrames`,
      ctx,
    ),
    whiffRecoveryFrames: ensureNonNegativeInteger(
      r.whiffRecoveryFrames,
      `${fieldPath}.whiffRecoveryFrames`,
      ctx,
    ),
    holdFramesMax: ensureNonNegativeInteger(
      r.holdFramesMax,
      `${fieldPath}.holdFramesMax`,
      ctx,
    ),
    throwRecoveryFrames: ensureNonNegativeInteger(
      r.throwRecoveryFrames,
      `${fieldPath}.throwRecoveryFrames`,
      ctx,
    ),
    pummel,
    ...(r.cargo === undefined ? {} : { cargo: (() => {
      const c = asObject(r.cargo, `${fieldPath}.cargo`, ctx);
      return { startupFrames: ensureNonNegativeInteger(c.startupFrames, `${fieldPath}.cargo.startupFrames`, ctx),
        ...(c.entryMotionFrames===undefined?{}:{entryMotionFrames:ensureNonNegativeInteger(c.entryMotionFrames,`${fieldPath}.cargo.entryMotionFrames`,ctx)}),
        holdFramesMax: ensureNonNegativeInteger(c.holdFramesMax, `${fieldPath}.cargo.holdFramesMax`, ctx),
        offsetX: ensureFiniteNumber(c.offsetX, `${fieldPath}.cargo.offsetX`, ctx),
        offsetY: ensureFiniteNumber(c.offsetY, `${fieldPath}.cargo.offsetY`, ctx),
        ...(c.breakDamage===undefined?{}:{breakDamage:ensureNonNegativeNumber(c.breakDamage,`${fieldPath}.cargo.breakDamage`,ctx)}),
        ...(c.walkMultiplier===undefined?{}:{walkMultiplier:ensurePositiveNumber(c.walkMultiplier,`${fieldPath}.cargo.walkMultiplier`,ctx)}),
        throws: parseThrowSet(c.throws, `${fieldPath}.cargo.throws`, ctx),
        ...(c.airThrows===undefined?{}:{airThrows:parseThrowSet(c.airThrows,`${fieldPath}.cargo.airThrows`,ctx)}) };
    })() }),
    ...(r.pivotGrab === undefined ? {} : { pivotGrab: parseGrabVariant(r.pivotGrab, `${fieldPath}.pivotGrab`, ctx) }),
    ...(r.dashGrab === undefined ? {} : { dashGrab: parseGrabVariant(r.dashGrab, `${fieldPath}.dashGrab`, ctx) }),
    throws: parseThrowSet(r.throws, `${fieldPath}.throws`, ctx),
  };
  validateGrabSpec(spec, `${ctx} ${fieldPath}`);
  return spec;
}

// ---------------------------------------------------------------------------
// Neutral-special per-kind parsers
// ---------------------------------------------------------------------------

function parseProjectileSpec(
  raw: Record<string, unknown>,
  fieldPath: string,
  ctx: string,
): ProjectileSpecialMove['projectile'] {
  return {
    speed: ensureFiniteNumber(raw.speed, `${fieldPath}.speed`, ctx),
    lifetimeFrames: ensureNonNegativeInteger(
      raw.lifetimeFrames,
      `${fieldPath}.lifetimeFrames`,
      ctx,
    ),
    width: ensurePositiveNumber(raw.width, `${fieldPath}.width`, ctx),
    height: ensurePositiveNumber(raw.height, `${fieldPath}.height`, ctx),
    spawnOffsetX: ensureFiniteNumber(
      raw.spawnOffsetX,
      `${fieldPath}.spawnOffsetX`,
      ctx,
    ),
    spawnOffsetY: ensureFiniteNumber(
      raw.spawnOffsetY,
      `${fieldPath}.spawnOffsetY`,
      ctx,
    ),
  };
}

function parseChargeSpecRecord(
  raw: Record<string, unknown>,
  fieldPath: string,
  ctx: string,
  allowDamageOnly = true,
): ChargeSpec {
  if (raw.knockbackMode !== undefined && raw.knockbackMode !== 'damage-only') {
    throw new Error(`${ctx}: ${fieldPath}.knockbackMode must be 'damage-only' when specified`);
  }
  if (raw.knockbackMode === 'damage-only' && !allowDamageOnly) {
    throw new Error(`${ctx}: ${fieldPath}.knockbackMode is only supported for melee charges`);
  }
  for (const key of ['minKnockback', 'maxKnockback']) {
    rejectChargedReferenceKnockback(raw[key], `${fieldPath}.${key}`, ctx);
  }
  const spec: ChargeSpec = {
    ...(raw.maxHoldFrames === undefined ? {} : { maxHoldFrames: ensureNonNegativeInteger(raw.maxHoldFrames, `${fieldPath}.maxHoldFrames`, ctx) }),
    ...(raw.inputBehavior===undefined?{}:{inputBehavior:(()=>{if(raw.inputBehavior!=='press-wind-fire')throw new Error(`${ctx}: ${fieldPath}.inputBehavior must be press-wind-fire`);return 'press-wind-fire' as const;})()}),
    ...Object.fromEntries(['entryFrames', 'cancelFrames'].filter(k => raw[k] !== undefined).map(k => [k, ensureNonNegativeInteger(raw[k], `${fieldPath}.${k}`, ctx)])),
    ...(raw.airCharge === undefined ? {} : { airCharge: (() => { if (typeof raw.airCharge !== 'boolean') throw new Error(`${ctx}: ${fieldPath}.airCharge must be boolean`); return raw.airCharge; })() }),
    ...(raw.partialMaxDamage === undefined ? {} : { partialMaxDamage: ensureNonNegativeNumber(raw.partialMaxDamage, `${fieldPath}.partialMaxDamage`, ctx) }),
    ...(raw.damageStep === undefined ? {} : { damageStep: ensurePositiveNumber(raw.damageStep, `${fieldPath}.damageStep`, ctx) }),
    ...(raw.knockbackMode === undefined ? {} : { knockbackMode: raw.knockbackMode }),
    ...(raw.fullChargeKnockback === undefined ? {} : {
      fullChargeKnockback: parseKnockback(raw.fullChargeKnockback, `${fieldPath}.fullChargeKnockback`, ctx),
    }),
    minChargeFrames: ensureNonNegativeInteger(
      raw.minChargeFrames,
      `${fieldPath}.minChargeFrames`,
      ctx,
    ),
    maxChargeFrames: ensureNonNegativeInteger(
      raw.maxChargeFrames,
      `${fieldPath}.maxChargeFrames`,
      ctx,
    ),
    minDamage: ensureFiniteNumber(raw.minDamage, `${fieldPath}.minDamage`, ctx),
    maxDamage: ensureFiniteNumber(raw.maxDamage, `${fieldPath}.maxDamage`, ctx),
    minKnockback: parseKnockback(raw.minKnockback, `${fieldPath}.minKnockback`, ctx),
    maxKnockback: parseKnockback(raw.maxKnockback, `${fieldPath}.maxKnockback`, ctx),
  };
  validateChargeSpec(spec, `${ctx} ${fieldPath}`);
  return spec;
}

function parseCommandGrabSpec(
  raw: Record<string, unknown>,
  fieldPath: string,
  ctx: string,
): CommandGrabSpecialMove['grab'] {
  if (typeof raw.ignoresShield !== 'boolean') {
    throw new Error(
      `${ctx}: ${fieldPath}.ignoresShield must be a boolean, got ${String(raw.ignoresShield)}`,
    );
  }
  return {
    grabHoldFrames: ensureNonNegativeInteger(
      raw.grabHoldFrames,
      `${fieldPath}.grabHoldFrames`,
      ctx,
    ),
    throwDamage: ensureFiniteNumber(raw.throwDamage, `${fieldPath}.throwDamage`, ctx),
    throwKnockback: parseKnockback(raw.throwKnockback, `${fieldPath}.throwKnockback`, ctx),
    ignoresShield: raw.ignoresShield,
  };
}

function parseSummonSpec(
  raw: Record<string, unknown>,
  fieldPath: string,
  ctx: string,
): SummonSpecialMove['summon'] {
  return {
    creatureId: ensureString(raw.creatureId, `${fieldPath}.creatureId`, ctx),
    spawnOffsetX: ensureFiniteNumber(
      raw.spawnOffsetX,
      `${fieldPath}.spawnOffsetX`,
      ctx,
    ),
    spawnOffsetY: ensureFiniteNumber(
      raw.spawnOffsetY,
      `${fieldPath}.spawnOffsetY`,
      ctx,
    ),
    maxConcurrent: ensureNonNegativeInteger(
      raw.maxConcurrent,
      `${fieldPath}.maxConcurrent`,
      ctx,
    ),
    cooldownFrames: ensureNonNegativeInteger(
      raw.cooldownFrames,
      `${fieldPath}.cooldownFrames`,
      ctx,
    ),
  };
}

function parseCounterSpec(
  raw: Record<string, unknown>,
  fieldPath: string,
  ctx: string,
): CounterSpecialMove['counter'] {
  if (raw.counterHitbox === null || typeof raw.counterHitbox !== 'object') {
    throw new Error(`${ctx}: ${fieldPath}.counterHitbox must be an object`);
  }
  const ch = raw.counterHitbox as Record<string, unknown>;
  return {
    counterWindowStart: ensureNonNegativeInteger(
      raw.counterWindowStart,
      `${fieldPath}.counterWindowStart`,
      ctx,
    ),
    counterWindowEnd: ensureNonNegativeInteger(
      raw.counterWindowEnd,
      `${fieldPath}.counterWindowEnd`,
      ctx,
    ),
    damageMultiplier: ensureFiniteNumber(
      raw.damageMultiplier,
      `${fieldPath}.damageMultiplier`,
      ctx,
    ),
    minCounterDamage: ensureFiniteNumber(
      raw.minCounterDamage,
      `${fieldPath}.minCounterDamage`,
      ctx,
    ),
    maxCounterDamage: ensureFiniteNumber(
      raw.maxCounterDamage,
      `${fieldPath}.maxCounterDamage`,
      ctx,
    ),
    counterKnockback: parseKnockback(
      raw.counterKnockback,
      `${fieldPath}.counterKnockback`,
      ctx,
    ),
    counterHitbox: {
      offsetX: ensureFiniteNumber(ch.offsetX, `${fieldPath}.counterHitbox.offsetX`, ctx),
      offsetY: ensureFiniteNumber(ch.offsetY, `${fieldPath}.counterHitbox.offsetY`, ctx),
      width: ensurePositiveNumber(ch.width, `${fieldPath}.counterHitbox.width`, ctx),
      height: ensurePositiveNumber(ch.height, `${fieldPath}.counterHitbox.height`, ctx),
    },
  };
}

/**
 * Parse a neutral special move. Builds the base AttackMoveWithAnimation
 * fields, narrows on `specialKind`, parses the matching per-kind
 * sub-record, then defers to {@link validateNeutralSpecialMove} for
 * the deep cross-field invariants (e.g. counter window inside busy
 * frames).
 */
function parseNeutralSpecial(
  raw: unknown,
  fieldPath: string,
  ctx: string,
): NeutralSpecialMove {
  if (raw === null || typeof raw !== 'object') {
    throw new Error(`${ctx}: ${fieldPath} must be an object`);
  }
  const r = raw as Record<string, unknown>;
  const base = parseGroundedAttack(raw, fieldPath, ctx);
  if (base.type !== 'special') {
    throw new Error(
      `${ctx}: ${fieldPath}.type must be 'special' for a neutral special, got '${base.type}'`,
    );
  }
  const kind = ensureString(r.specialKind, `${fieldPath}.specialKind`, ctx);
  let move: NeutralSpecialMove;
  switch (kind) {
    case 'projectile': {
      if (r.projectile === null || typeof r.projectile !== 'object') {
        throw new Error(`${ctx}: ${fieldPath}.projectile must be an object`);
      }
      const projectileMove: ProjectileSpecialMove = {
        ...base,
        type: 'special',
        specialKind: 'projectile',
        projectile: parseProjectileSpec(
          r.projectile as Record<string, unknown>,
          `${fieldPath}.projectile`,
          ctx,
        ),
        ...(r.chargedProjectile === undefined ? {} : { chargedProjectile: (() => {
          const cp = asObject(r.chargedProjectile, `${fieldPath}.chargedProjectile`, ctx);
          for (const key of ['airCharge', 'storeCharge', 'autoFire']) {
            if (cp[key] !== undefined && typeof cp[key] !== 'boolean') throw new Error(`${ctx}: ${fieldPath}.chargedProjectile.${key} must be boolean`);
          }
          return { charge: parseChargeSpecRecord(asObject(cp.charge, `${fieldPath}.chargedProjectile.charge`, ctx), `${fieldPath}.chargedProjectile.charge`, ctx),
            maxSpeed: ensureFiniteNumber(cp.maxSpeed, `${fieldPath}.chargedProjectile.maxSpeed`, ctx),
            maxWidth: ensurePositiveNumber(cp.maxWidth, `${fieldPath}.chargedProjectile.maxWidth`, ctx),
            maxHeight: ensurePositiveNumber(cp.maxHeight, `${fieldPath}.chargedProjectile.maxHeight`, ctx),
            ...(cp.airCharge === undefined ? {} : { airCharge: cp.airCharge as boolean }),
            ...(cp.storeCharge === undefined ? {} : { storeCharge: cp.storeCharge as boolean }),
            ...(cp.autoFire === undefined ? {} : { autoFire: cp.autoFire as boolean }) };
        })() }),
      };
      move = projectileMove;
      break;
    }
    case 'charge': {
      if (r.charge === null || typeof r.charge !== 'object') {
        throw new Error(`${ctx}: ${fieldPath}.charge must be an object`);
      }
      const chargeMove: ChargeSpecialMove = {
        ...base,
        type: 'special',
        specialKind: 'charge',
        charge: parseChargeSpecRecord(
          r.charge as Record<string, unknown>,
          `${fieldPath}.charge`,
          ctx,
        ),
      };
      move = chargeMove;
      break;
    }
    case 'commandGrab': {
      if (r.grab === null || typeof r.grab !== 'object') {
        throw new Error(`${ctx}: ${fieldPath}.grab must be an object`);
      }
      const grabMove: CommandGrabSpecialMove = {
        ...base,
        type: 'special',
        specialKind: 'commandGrab',
        grab: parseCommandGrabSpec(
          r.grab as Record<string, unknown>,
          `${fieldPath}.grab`,
          ctx,
        ),
      };
      move = grabMove;
      break;
    }
    case 'counter': {
      if (r.counter === null || typeof r.counter !== 'object') {
        throw new Error(`${ctx}: ${fieldPath}.counter must be an object`);
      }
      const counterMove: CounterSpecialMove = {
        ...base,
        type: 'special',
        specialKind: 'counter',
        counter: parseCounterSpec(
          r.counter as Record<string, unknown>,
          `${fieldPath}.counter`,
          ctx,
        ),
      };
      move = counterMove;
      break;
    }
    case 'summon': {
      if (r.summon === null || typeof r.summon !== 'object') {
        throw new Error(`${ctx}: ${fieldPath}.summon must be an object`);
      }
      const summonMove: SummonSpecialMove = {
        ...base,
        type: 'special',
        specialKind: 'summon',
        summon: parseSummonSpec(
          r.summon as Record<string, unknown>,
          `${fieldPath}.summon`,
          ctx,
        ),
      };
      move = summonMove;
      break;
    }
    default:
      throw new Error(
        `${ctx}: ${fieldPath}.specialKind must be one of [projectile, charge, commandGrab, counter, summon], got '${kind}'`,
      );
  }
  validateNeutralSpecialMove(move);
  return move;
}

// ---------------------------------------------------------------------------
// Side-special per-kind parsers
// ---------------------------------------------------------------------------

function parseSideDashStrikeSpec(
  raw: Record<string, unknown>,
  fieldPath: string,
  ctx: string,
): DashStrikeSideSpecialMove['dashStrike'] {
  if (typeof raw.helplessAfterDash !== 'boolean') {
    throw new Error(
      `${ctx}: ${fieldPath}.helplessAfterDash must be a boolean, got ${String(raw.helplessAfterDash)}`,
    );
  }
  return {
    dashSpeed: ensureFiniteNumber(raw.dashSpeed, `${fieldPath}.dashSpeed`, ctx),
    dashFrames: ensureNonNegativeInteger(raw.dashFrames, `${fieldPath}.dashFrames`, ctx),
    helplessAfterDash: raw.helplessAfterDash,
  };
}

function parseSideMultiHitSpec(
  raw: Record<string, unknown>,
  fieldPath: string,
  ctx: string,
): MultiHitSideSpecialMove['multiHit'] {
  const hitCount = ensureNonNegativeInteger(raw.hitCount, `${fieldPath}.hitCount`, ctx);
  if (hitCount < 1) {
    throw new Error(`${ctx}: ${fieldPath}.hitCount must be >= 1, got ${hitCount}`);
  }
  const hitInterval = ensureNonNegativeInteger(
    raw.hitInterval,
    `${fieldPath}.hitInterval`,
    ctx,
  );
  if (hitInterval < 1) {
    throw new Error(`${ctx}: ${fieldPath}.hitInterval must be >= 1, got ${hitInterval}`);
  }
  if (!Array.isArray(raw.damagePerHit)) {
    throw new Error(`${ctx}: ${fieldPath}.damagePerHit must be an array`);
  }
  if (!Array.isArray(raw.knockbackPerHit)) {
    throw new Error(`${ctx}: ${fieldPath}.knockbackPerHit must be an array`);
  }
  if (raw.damagePerHit.length !== hitCount) {
    throw new Error(
      `${ctx}: ${fieldPath}.damagePerHit.length (${raw.damagePerHit.length}) must equal hitCount (${hitCount})`,
    );
  }
  if (raw.knockbackPerHit.length !== hitCount) {
    throw new Error(
      `${ctx}: ${fieldPath}.knockbackPerHit.length (${raw.knockbackPerHit.length}) must equal hitCount (${hitCount})`,
    );
  }
  const damagePerHit = raw.damagePerHit.map((d, i) =>
    ensureFiniteNumber(d, `${fieldPath}.damagePerHit[${i}]`, ctx),
  );
  const knockbackPerHit = raw.knockbackPerHit.map((kb, i) =>
    parseKnockback(kb, `${fieldPath}.knockbackPerHit[${i}]`, ctx),
  );
  return {
    hitCount,
    hitInterval,
    damagePerHit,
    knockbackPerHit,
    chainWindowFrames: ensureNonNegativeInteger(
      raw.chainWindowFrames,
      `${fieldPath}.chainWindowFrames`,
      ctx,
    ),
  };
}

function parseSideReflectorSpec(
  raw: Record<string, unknown>,
  fieldPath: string,
  ctx: string,
): ReflectorSideSpecialMove['reflector'] {
  if (raw.reflectorBody === null || typeof raw.reflectorBody !== 'object') {
    throw new Error(`${ctx}: ${fieldPath}.reflectorBody must be an object`);
  }
  const rb = raw.reflectorBody as Record<string, unknown>;
  return {
    reflectMultiplier: ensureFiniteNumber(
      raw.reflectMultiplier,
      `${fieldPath}.reflectMultiplier`,
      ctx,
    ),
    velocityScale: ensureFiniteNumber(
      raw.velocityScale,
      `${fieldPath}.velocityScale`,
      ctx,
    ),
    contactDamage: ensureFiniteNumber(
      raw.contactDamage,
      `${fieldPath}.contactDamage`,
      ctx,
    ),
    contactKnockback: parseKnockback(
      raw.contactKnockback,
      `${fieldPath}.contactKnockback`,
      ctx,
    ),
    reflectorBody: {
      offsetX: ensureFiniteNumber(rb.offsetX, `${fieldPath}.reflectorBody.offsetX`, ctx),
      offsetY: ensureFiniteNumber(rb.offsetY, `${fieldPath}.reflectorBody.offsetY`, ctx),
      width: ensurePositiveNumber(rb.width, `${fieldPath}.reflectorBody.width`, ctx),
      height: ensurePositiveNumber(rb.height, `${fieldPath}.reflectorBody.height`, ctx),
    },
  };
}

function parseSideCommandDashSpec(
  raw: Record<string, unknown>,
  fieldPath: string,
  ctx: string,
): CommandDashSideSpecialMove['commandDash'] {
  if (typeof raw.ignoresShield !== 'boolean') {
    throw new Error(
      `${ctx}: ${fieldPath}.ignoresShield must be a boolean, got ${String(raw.ignoresShield)}`,
    );
  }
  if (typeof raw.helplessOnWhiff !== 'boolean') {
    throw new Error(
      `${ctx}: ${fieldPath}.helplessOnWhiff must be a boolean, got ${String(raw.helplessOnWhiff)}`,
    );
  }
  return {
    dashSpeed: ensureFiniteNumber(raw.dashSpeed, `${fieldPath}.dashSpeed`, ctx),
    dashFrames: ensureNonNegativeInteger(raw.dashFrames, `${fieldPath}.dashFrames`, ctx),
    grabHoldFrames: ensureNonNegativeInteger(
      raw.grabHoldFrames,
      `${fieldPath}.grabHoldFrames`,
      ctx,
    ),
    throwDamage: ensureFiniteNumber(raw.throwDamage, `${fieldPath}.throwDamage`, ctx),
    throwKnockback: parseKnockback(
      raw.throwKnockback,
      `${fieldPath}.throwKnockback`,
      ctx,
    ),
    ignoresShield: raw.ignoresShield,
    helplessOnWhiff: raw.helplessOnWhiff,
  };
}

/**
 * Parse a side special move. Same overall shape as
 * {@link parseNeutralSpecial} but discriminates on `sideSpecialKind`
 * and routes to the matching per-kind parser. Defers deep
 * cross-field validation to {@link validateSideSpecialMove}.
 */
function parseSideSpecial(
  raw: unknown,
  fieldPath: string,
  ctx: string,
): SideSpecialMove {
  if (raw === null || typeof raw !== 'object') {
    throw new Error(`${ctx}: ${fieldPath} must be an object`);
  }
  const r = raw as Record<string, unknown>;
  const base = parseGroundedAttack(raw, fieldPath, ctx);
  if (base.type !== 'sideSpecial') {
    throw new Error(
      `${ctx}: ${fieldPath}.type must be 'sideSpecial', got '${base.type}'`,
    );
  }
  const kind = ensureString(r.sideSpecialKind, `${fieldPath}.sideSpecialKind`, ctx);
  let move: SideSpecialMove;
  switch (kind) {
    case 'boomerang': {
      if (!r.projectile || typeof r.projectile !== 'object' || !r.boomerang || typeof r.boomerang !== 'object') {
        throw new Error(`${ctx}: ${fieldPath} requires projectile and boomerang data`);
      }
      const b = r.boomerang as Record<string, unknown>;
      move = { ...base, type: 'sideSpecial', sideSpecialKind: 'boomerang',
        projectile: parseProjectileSpec(r.projectile as Record<string, unknown>, `${fieldPath}.projectile`, ctx),
        boomerang: {
          outboundFrames: ensureNonNegativeInteger(b.outboundFrames, `${fieldPath}.boomerang.outboundFrames`, ctx),
          returnSpeed: ensurePositiveNumber(b.returnSpeed, `${fieldPath}.boomerang.returnSpeed`, ctx),
          returnDamage: ensureFiniteNumber(b.returnDamage, `${fieldPath}.boomerang.returnDamage`, ctx),
          ...(b.returnKnockback === undefined ? {} : { returnKnockback: parseKnockback(b.returnKnockback, `${fieldPath}.boomerang.returnKnockback`, ctx) }),
          ...(b.lateOutbound === undefined ? {} : { lateOutbound: (() => {
            const path = `${fieldPath}.boomerang.lateOutbound`, late = asObject(b.lateOutbound, path, ctx);
            return { startFrame: ensureNonNegativeInteger(late.startFrame, `${path}.startFrame`, ctx),
              damage: ensureNonNegativeNumber(late.damage, `${path}.damage`, ctx),
              knockback: parseKnockback(late.knockback, `${path}.knockback`, ctx) };
          })() }),
        } };
      break;
    }
    case 'dashStrike': {
      if (r.dashStrike === null || typeof r.dashStrike !== 'object') {
        throw new Error(`${ctx}: ${fieldPath}.dashStrike must be an object`);
      }
      move = {
        ...base,
        type: 'sideSpecial',
        sideSpecialKind: 'dashStrike',
        dashStrike: parseSideDashStrikeSpec(
          r.dashStrike as Record<string, unknown>,
          `${fieldPath}.dashStrike`,
          ctx,
        ),
      };
      break;
    }
    case 'multiHit': {
      if (r.multiHit === null || typeof r.multiHit !== 'object') {
        throw new Error(`${ctx}: ${fieldPath}.multiHit must be an object`);
      }
      move = {
        ...base,
        type: 'sideSpecial',
        sideSpecialKind: 'multiHit',
        multiHit: parseSideMultiHitSpec(
          r.multiHit as Record<string, unknown>,
          `${fieldPath}.multiHit`,
          ctx,
        ),
      };
      break;
    }
    case 'reflector': {
      if (r.reflector === null || typeof r.reflector !== 'object') {
        throw new Error(`${ctx}: ${fieldPath}.reflector must be an object`);
      }
      move = {
        ...base,
        type: 'sideSpecial',
        sideSpecialKind: 'reflector',
        reflector: parseSideReflectorSpec(
          r.reflector as Record<string, unknown>,
          `${fieldPath}.reflector`,
          ctx,
        ),
      };
      break;
    }
    case 'commandDash': {
      if (r.commandDash === null || typeof r.commandDash !== 'object') {
        throw new Error(`${ctx}: ${fieldPath}.commandDash must be an object`);
      }
      move = {
        ...base,
        type: 'sideSpecial',
        sideSpecialKind: 'commandDash',
        commandDash: parseSideCommandDashSpec(
          r.commandDash as Record<string, unknown>,
          `${fieldPath}.commandDash`,
          ctx,
        ),
      };
      break;
    }
    default:
      throw new Error(
        `${ctx}: ${fieldPath}.sideSpecialKind must be one of [dashStrike, multiHit, reflector, commandDash], got '${kind}'`,
      );
  }
  validateSideSpecialMove(move);
  return move;
}

// ---------------------------------------------------------------------------
// Up-special per-kind parsers
// ---------------------------------------------------------------------------

function parseUpMultiHitRisingSpec(
  raw: Record<string, unknown>,
  fieldPath: string,
  ctx: string,
): MultiHitRisingUpSpecialMove['multiHitRising'] {
  const optionalNumbers = (key: 'hitFrames' | 'damagePerHit'): ReadonlyArray<number> | undefined => {
    if (raw[key] === undefined) return undefined;
    if (!Array.isArray(raw[key])) throw new Error(`${ctx}: ${fieldPath}.${key} must be an array`);
    return (raw[key] as unknown[]).map((n, i) => key === 'hitFrames'
      ? ensureNonNegativeInteger(n, `${fieldPath}.${key}[${i}]`, ctx)
      : ensureFiniteNumber(n, `${fieldPath}.${key}[${i}]`, ctx));
  };
  const hitFrames = optionalNumbers('hitFrames'), damagePerHit = optionalNumbers('damagePerHit');
  const perHit = <T>(key: string, parse: (entry: unknown, path: string) => T): readonly T[] | undefined => {
    if (raw[key] === undefined) return undefined;
    if (!Array.isArray(raw[key]) || raw[key].length !== raw.hitCount) {
      throw new Error(`${ctx}: ${fieldPath}.${key} must contain hitCount entries`);
    }
    return raw[key].map((entry, i) => parse(entry, `${fieldPath}.${key}[${i}]`));
  };
  const collisionHitsPerHit = perHit('collisionHitsPerHit', (entry, path) => parseCollisionHits(entry, path, ctx));
  const knockbackPerHit = perHit('knockbackPerHit', (entry, path) => parseKnockback(entry, path, ctx));
  const hitlagMultiplierPerHit = perHit('hitlagMultiplierPerHit', (entry, path) => ensureNonNegativeNumber(entry, path, ctx));
  const sdiMultiplierPerHit = perHit('sdiMultiplierPerHit', (entry, path) => ensureNonNegativeNumber(entry, path, ctx));
  const activeFramesPerHit = perHit('activeFramesPerHit', (entry, path) => {
    const frames = ensureNonNegativeInteger(entry, path, ctx);
    if (frames < 1) throw new Error(`${ctx}: ${path} must be positive`);
    return frames;
  });
  const sustainedRise = raw.sustainedRise === undefined ? undefined : (() => {
    const path = `${fieldPath}.sustainedRise`;
    if (Array.isArray(raw.sustainedRise)) throw new Error(`${ctx}: ${path} must be an object`);
    const flight = asObject(raw.sustainedRise, path, ctx);
    const gravityFrames = ensureNonNegativeInteger(flight.gravityFrames, `${path}.gravityFrames`, ctx);
    if (gravityFrames < 1) throw new Error(`${ctx}: ${path}.gravityFrames must be positive`);
    return {
      gravityFrames,
      gravity: ensurePositiveNumber(flight.gravity, `${path}.gravity`, ctx),
      airAcceleration: ensureNonNegativeNumber(flight.airAcceleration, `${path}.airAcceleration`, ctx),
      maxAirSpeed: ensurePositiveNumber(flight.maxAirSpeed, `${path}.maxAirSpeed`, ctx),
    };
  })();
  return {
    ...(sustainedRise === undefined ? {} : { sustainedRise }),
    ...(collisionHitsPerHit ? { collisionHitsPerHit } : {}),
    ...(knockbackPerHit ? { knockbackPerHit } : {}),
    ...(hitlagMultiplierPerHit ? { hitlagMultiplierPerHit } : {}),
    ...(sdiMultiplierPerHit ? { sdiMultiplierPerHit } : {}),
    ...(activeFramesPerHit ? { activeFramesPerHit } : {}),
    ...(hitFrames ? { hitFrames } : {}),
    ...(damagePerHit ? { damagePerHit } : {}),
    riseImpulse: ensureFiniteNumber(raw.riseImpulse, `${fieldPath}.riseImpulse`, ctx),
    driftImpulse: ensureFiniteNumber(raw.driftImpulse, `${fieldPath}.driftImpulse`, ctx),
    hitCount: ensureNonNegativeInteger(raw.hitCount, `${fieldPath}.hitCount`, ctx),
    hitInterval: ensureNonNegativeInteger(raw.hitInterval, `${fieldPath}.hitInterval`, ctx),
    linkDamage: ensureFiniteNumber(raw.linkDamage, `${fieldPath}.linkDamage`, ctx),
    linkKnockback: parseKnockback(raw.linkKnockback, `${fieldPath}.linkKnockback`, ctx),
    launcherDamage: ensureFiniteNumber(
      raw.launcherDamage,
      `${fieldPath}.launcherDamage`,
      ctx,
    ),
    launcherKnockback: parseKnockback(
      raw.launcherKnockback,
      `${fieldPath}.launcherKnockback`,
      ctx,
    ),
  };
}

function parseUpTeleportSpec(
  raw: Record<string, unknown>,
  fieldPath: string,
  ctx: string,
): TeleportUpSpecialMove['teleport'] {
  if (typeof raw.snapToOctant !== 'boolean') {
    throw new Error(
      `${ctx}: ${fieldPath}.snapToOctant must be a boolean, got ${String(raw.snapToOctant)}`,
    );
  }
  return {
    teleportDistance: ensureFiniteNumber(
      raw.teleportDistance,
      `${fieldPath}.teleportDistance`,
      ctx,
    ),
    invincibilityFrames: ensureNonNegativeInteger(
      raw.invincibilityFrames,
      `${fieldPath}.invincibilityFrames`,
      ctx,
    ),
    snapToOctant: raw.snapToOctant,
  };
}

function parseUpDirectionalJumpSpec(
  raw: Record<string, unknown>,
  fieldPath: string,
  ctx: string,
): DirectionalJumpUpSpecialMove['directionalJump'] {
  if (typeof raw.snapToOctant !== 'boolean') {
    throw new Error(
      `${ctx}: ${fieldPath}.snapToOctant must be a boolean, got ${String(raw.snapToOctant)}`,
    );
  }
  if (typeof raw.helplessAfterBurst !== 'boolean') {
    throw new Error(
      `${ctx}: ${fieldPath}.helplessAfterBurst must be a boolean, got ${String(raw.helplessAfterBurst)}`,
    );
  }
  return {
    burstSpeed: ensureFiniteNumber(raw.burstSpeed, `${fieldPath}.burstSpeed`, ctx),
    burstFrames: ensureNonNegativeInteger(
      raw.burstFrames,
      `${fieldPath}.burstFrames`,
      ctx,
    ),
    snapToOctant: raw.snapToOctant,
    helplessAfterBurst: raw.helplessAfterBurst,
  };
}

function parseUpTetherSpec(
  raw: Record<string, unknown>,
  fieldPath: string,
  ctx: string,
): TetherUpSpecialMove['tether'] {
  return {
    maxRange: ensureFiniteNumber(raw.maxRange, `${fieldPath}.maxRange`, ctx),
    extensionSpeed: ensureFiniteNumber(
      raw.extensionSpeed,
      `${fieldPath}.extensionSpeed`,
      ctx,
    ),
    extensionFrames: ensureNonNegativeInteger(
      raw.extensionFrames,
      `${fieldPath}.extensionFrames`,
      ctx,
    ),
    reelSpeed: ensureFiniteNumber(raw.reelSpeed, `${fieldPath}.reelSpeed`, ctx),
    reelFrames: ensureNonNegativeInteger(
      raw.reelFrames,
      `${fieldPath}.reelFrames`,
      ctx,
    ),
    tetherTipDamage: ensureFiniteNumber(
      raw.tetherTipDamage,
      `${fieldPath}.tetherTipDamage`,
      ctx,
    ),
    tetherTipKnockback: parseKnockback(
      raw.tetherTipKnockback,
      `${fieldPath}.tetherTipKnockback`,
      ctx,
    ),
    lineWidth: ensurePositiveNumber(raw.lineWidth, `${fieldPath}.lineWidth`, ctx),
  };
}

function parseUpSpecial(
  raw: unknown,
  fieldPath: string,
  ctx: string,
): UpSpecialMove {
  if (raw === null || typeof raw !== 'object') {
    throw new Error(`${ctx}: ${fieldPath} must be an object`);
  }
  const r = raw as Record<string, unknown>;
  const base = parseGroundedAttack(raw, fieldPath, ctx);
  if (base.type !== 'upSpecial') {
    throw new Error(
      `${ctx}: ${fieldPath}.type must be 'upSpecial', got '${base.type}'`,
    );
  }
  const kind = ensureString(r.upSpecialKind, `${fieldPath}.upSpecialKind`, ctx);
  let move: UpSpecialMove;
  switch (kind) {
    case 'multiHitRising':
      if (r.multiHitRising === null || typeof r.multiHitRising !== 'object') {
        throw new Error(`${ctx}: ${fieldPath}.multiHitRising must be an object`);
      }
      move = {
        ...base,
        type: 'upSpecial',
        upSpecialKind: 'multiHitRising',
        ...(r.groundedVariant === undefined ? {} : {
          groundedVariant: parseGroundedAttack(r.groundedVariant, `${fieldPath}.groundedVariant`, ctx),
        }),
        ...(r.groundedChargeStartFrame === undefined ? {} : {
          groundedChargeStartFrame: ensureNonNegativeInteger(r.groundedChargeStartFrame, `${fieldPath}.groundedChargeStartFrame`, ctx),
        }),
        ...(r.groundedLandingFrame === undefined ? {} : {
          groundedLandingFrame: ensureNonNegativeInteger(r.groundedLandingFrame, `${fieldPath}.groundedLandingFrame`, ctx),
        }),
        multiHitRising: parseUpMultiHitRisingSpec(
          r.multiHitRising as Record<string, unknown>,
          `${fieldPath}.multiHitRising`,
          ctx,
        ),
      };
      break;
    case 'teleport':
      if (r.teleport === null || typeof r.teleport !== 'object') {
        throw new Error(`${ctx}: ${fieldPath}.teleport must be an object`);
      }
      move = {
        ...base,
        type: 'upSpecial',
        upSpecialKind: 'teleport',
        teleport: parseUpTeleportSpec(
          r.teleport as Record<string, unknown>,
          `${fieldPath}.teleport`,
          ctx,
        ),
      };
      break;
    case 'directionalJump':
      if (r.directionalJump === null || typeof r.directionalJump !== 'object') {
        throw new Error(`${ctx}: ${fieldPath}.directionalJump must be an object`);
      }
      move = {
        ...base,
        type: 'upSpecial',
        upSpecialKind: 'directionalJump',
        directionalJump: parseUpDirectionalJumpSpec(
          r.directionalJump as Record<string, unknown>,
          `${fieldPath}.directionalJump`,
          ctx,
        ),
      };
      break;
    case 'tether':
      if (r.tether === null || typeof r.tether !== 'object') {
        throw new Error(`${ctx}: ${fieldPath}.tether must be an object`);
      }
      move = {
        ...base,
        type: 'upSpecial',
        upSpecialKind: 'tether',
        tether: parseUpTetherSpec(
          r.tether as Record<string, unknown>,
          `${fieldPath}.tether`,
          ctx,
        ),
      };
      break;
    default:
      throw new Error(
        `${ctx}: ${fieldPath}.upSpecialKind must be one of [multiHitRising, teleport, directionalJump, tether], got '${kind}'`,
      );
  }
  validateUpSpecialMove(move);
  return move;
}

// ---------------------------------------------------------------------------
// Down-special per-kind parsers
// ---------------------------------------------------------------------------

function parseFourFieldHitbox(
  raw: unknown,
  fieldPath: string,
  ctx: string,
): { offsetX: number; offsetY: number; width: number; height: number } {
  return parseHitbox(raw, fieldPath, ctx);
}

function parseDownGroundPoundSpec(
  raw: Record<string, unknown>,
  fieldPath: string,
  ctx: string,
): GroundPoundDownSpecialMove['groundPound'] {
  return {
    hopFrames: ensureNonNegativeInteger(raw.hopFrames, `${fieldPath}.hopFrames`, ctx),
    hopImpulse: ensureFiniteNumber(raw.hopImpulse, `${fieldPath}.hopImpulse`, ctx),
    slamVelocity: ensureFiniteNumber(raw.slamVelocity, `${fieldPath}.slamVelocity`, ctx),
    shockwaveDamage: ensureFiniteNumber(
      raw.shockwaveDamage,
      `${fieldPath}.shockwaveDamage`,
      ctx,
    ),
    shockwaveKnockback: parseKnockback(
      raw.shockwaveKnockback,
      `${fieldPath}.shockwaveKnockback`,
      ctx,
    ),
    shockwaveHitbox: parseFourFieldHitbox(
      raw.shockwaveHitbox,
      `${fieldPath}.shockwaveHitbox`,
      ctx,
    ),
  };
}

function parseDownTrapSpec(
  raw: Record<string, unknown>,
  fieldPath: string,
  ctx: string,
): TrapDownSpecialMove['trap'] {
  if (raw.launchAwayFromSource !== undefined && typeof raw.launchAwayFromSource !== 'boolean') {
    throw new Error(`${ctx}: ${fieldPath}.launchAwayFromSource must be boolean`);
  }
  return {
    ...(raw.launchAwayFromSource === undefined ? {} : { launchAwayFromSource: raw.launchAwayFromSource as boolean }),
    ...(raw.hitlagMultiplier === undefined ? {} : { hitlagMultiplier: ensureNonNegativeNumber(raw.hitlagMultiplier, `${fieldPath}.hitlagMultiplier`, ctx) }),
    ...(raw.sdiMultiplier === undefined ? {} : { sdiMultiplier: ensureNonNegativeNumber(raw.sdiMultiplier, `${fieldPath}.sdiMultiplier`, ctx) }),
    trapWidth: ensurePositiveNumber(raw.trapWidth, `${fieldPath}.trapWidth`, ctx),
    trapHeight: ensurePositiveNumber(raw.trapHeight, `${fieldPath}.trapHeight`, ctx),
    spawnOffsetX: ensureFiniteNumber(raw.spawnOffsetX, `${fieldPath}.spawnOffsetX`, ctx),
    spawnOffsetY: ensureFiniteNumber(raw.spawnOffsetY, `${fieldPath}.spawnOffsetY`, ctx),
    armDelayFrames: ensureNonNegativeInteger(
      raw.armDelayFrames,
      `${fieldPath}.armDelayFrames`,
      ctx,
    ),
    trapLifetimeFrames: ensureNonNegativeInteger(
      raw.trapLifetimeFrames,
      `${fieldPath}.trapLifetimeFrames`,
      ctx,
    ),
    trapDamage: ensureFiniteNumber(raw.trapDamage, `${fieldPath}.trapDamage`, ctx),
    trapKnockback: parseKnockback(raw.trapKnockback, `${fieldPath}.trapKnockback`, ctx),
    maxActiveTraps: ensureNonNegativeInteger(
      raw.maxActiveTraps,
      `${fieldPath}.maxActiveTraps`,
      ctx,
    ),
    ...(raw.fuseDetonateFrames !== undefined ? {
      fuseDetonateFrames: ensureNonNegativeInteger(raw.fuseDetonateFrames, `${fieldPath}.fuseDetonateFrames`, ctx),
    } : {}),
    ...(raw.selfBounceVelocity !== undefined ? {
      selfBounceVelocity: ensureFiniteNumber(raw.selfBounceVelocity, `${fieldPath}.selfBounceVelocity`, ctx),
    } : {}),
    ...(raw.throwSpeedX !== undefined ? { throwSpeedX:
      ensureFiniteNumber(raw.throwSpeedX, `${fieldPath}.throwSpeedX`, ctx) } : {}),
    ...(raw.throwSpeedY !== undefined ? { throwSpeedY:
      ensureFiniteNumber(raw.throwSpeedY, `${fieldPath}.throwSpeedY`, ctx) } : {}),
  };
}

function parseDownStallAndFallSpec(
  raw: Record<string, unknown>,
  fieldPath: string,
  ctx: string,
): StallAndFallDownSpecialMove['stallAndFall'] {
  if (raw.armorDuringFall !== undefined && typeof raw.armorDuringFall !== 'boolean') {
    throw new Error(`${ctx}: ${fieldPath}.armorDuringFall must be a boolean`);
  }
  if (typeof raw.helplessAfterFall !== 'boolean') {
    throw new Error(
      `${ctx}: ${fieldPath}.helplessAfterFall must be a boolean, got ${String(raw.helplessAfterFall)}`,
    );
  }
  return {
    stallFrames: ensureNonNegativeInteger(raw.stallFrames, `${fieldPath}.stallFrames`, ctx),
    stallVelocity: ensureFiniteNumber(
      raw.stallVelocity,
      `${fieldPath}.stallVelocity`,
      ctx,
    ),
    fallVelocity: ensureFiniteNumber(raw.fallVelocity, `${fieldPath}.fallVelocity`, ctx),
    shockwaveDamage: ensureFiniteNumber(
      raw.shockwaveDamage,
      `${fieldPath}.shockwaveDamage`,
      ctx,
    ),
    shockwaveKnockback: parseKnockback(
      raw.shockwaveKnockback,
      `${fieldPath}.shockwaveKnockback`,
      ctx,
    ),
    shockwaveHitbox: parseFourFieldHitbox(
      raw.shockwaveHitbox,
      `${fieldPath}.shockwaveHitbox`,
      ctx,
    ),
    helplessAfterFall: raw.helplessAfterFall,
    ...(raw.armorDuringFall !== undefined ? { armorDuringFall: raw.armorDuringFall } : {}),
  };
}

function parseDownCounterSpec(
  raw: Record<string, unknown>,
  fieldPath: string,
  ctx: string,
): CounterDownSpecialMove['counter'] {
  return {
    counterWindowStart: ensureNonNegativeInteger(
      raw.counterWindowStart,
      `${fieldPath}.counterWindowStart`,
      ctx,
    ),
    counterWindowEnd: ensureNonNegativeInteger(
      raw.counterWindowEnd,
      `${fieldPath}.counterWindowEnd`,
      ctx,
    ),
    damageMultiplier: ensureFiniteNumber(
      raw.damageMultiplier,
      `${fieldPath}.damageMultiplier`,
      ctx,
    ),
    minCounterDamage: ensureFiniteNumber(
      raw.minCounterDamage,
      `${fieldPath}.minCounterDamage`,
      ctx,
    ),
    maxCounterDamage: ensureFiniteNumber(
      raw.maxCounterDamage,
      `${fieldPath}.maxCounterDamage`,
      ctx,
    ),
    counterKnockback: parseKnockback(
      raw.counterKnockback,
      `${fieldPath}.counterKnockback`,
      ctx,
    ),
    counterHitbox: parseFourFieldHitbox(
      raw.counterHitbox,
      `${fieldPath}.counterHitbox`,
      ctx,
    ),
  };
}

function parseDownSpecial(
  raw: unknown,
  fieldPath: string,
  ctx: string,
): DownSpecialMove {
  if (raw === null || typeof raw !== 'object') {
    throw new Error(`${ctx}: ${fieldPath} must be an object`);
  }
  const r = raw as Record<string, unknown>;
  const base = parseGroundedAttack(raw, fieldPath, ctx);
  if (base.type !== 'downSpecial') {
    throw new Error(
      `${ctx}: ${fieldPath}.type must be 'downSpecial', got '${base.type}'`,
    );
  }
  const kind = ensureString(r.downSpecialKind, `${fieldPath}.downSpecialKind`, ctx);
  let move: DownSpecialMove;
  switch (kind) {
    case 'thunder':
      if (base.pikachuSpecial?.kind !== 'thunder') throw new Error(`${ctx}: Thunder requires the published mechanic preset`);
      move = { ...base, type: 'downSpecial', downSpecialKind: 'thunder', pikachuSpecial: base.pikachuSpecial };
      break;
    case 'groundPound':
      if (r.groundPound === null || typeof r.groundPound !== 'object') {
        throw new Error(`${ctx}: ${fieldPath}.groundPound must be an object`);
      }
      move = {
        ...base,
        type: 'downSpecial',
        downSpecialKind: 'groundPound',
        groundPound: parseDownGroundPoundSpec(
          r.groundPound as Record<string, unknown>,
          `${fieldPath}.groundPound`,
          ctx,
        ),
      };
      break;
    case 'trap':
      if (r.trap === null || typeof r.trap !== 'object') {
        throw new Error(`${ctx}: ${fieldPath}.trap must be an object`);
      }
      move = {
        ...base,
        type: 'downSpecial',
        downSpecialKind: 'trap',
        trap: parseDownTrapSpec(
          r.trap as Record<string, unknown>,
          `${fieldPath}.trap`,
          ctx,
        ),
      };
      break;
    case 'stallAndFall':
      if (r.stallAndFall === null || typeof r.stallAndFall !== 'object') {
        throw new Error(`${ctx}: ${fieldPath}.stallAndFall must be an object`);
      }
      move = {
        ...base,
        type: 'downSpecial',
        downSpecialKind: 'stallAndFall',
        stallAndFall: parseDownStallAndFallSpec(
          r.stallAndFall as Record<string, unknown>,
          `${fieldPath}.stallAndFall`,
          ctx,
        ),
      };
      break;
    case 'counter':
      if (r.counter === null || typeof r.counter !== 'object') {
        throw new Error(`${ctx}: ${fieldPath}.counter must be an object`);
      }
      move = {
        ...base,
        type: 'downSpecial',
        downSpecialKind: 'counter',
        counter: parseDownCounterSpec(
          r.counter as Record<string, unknown>,
          `${fieldPath}.counter`,
          ctx,
        ),
      };
      break;
    case 'shockwave': {
      const rawSw = r.shockwave;
      if (rawSw === null || typeof rawSw !== 'object') {
        throw new Error(`${ctx}: ${fieldPath}.shockwave must be an object`);
      }
      const sw = rawSw as Record<string, unknown>;
      const aerialVariant = sw.aerialVariant === undefined ? undefined
        : parseGroundedAttack(sw.aerialVariant, `${fieldPath}.shockwave.aerialVariant`, ctx);
      const repeat = sw.repeat === undefined ? undefined : (() => {
        const rr = asObject(sw.repeat, `${fieldPath}.shockwave.repeat`, ctx);
        return {
          windowStart: ensureNonNegativeInteger(rr.windowStart, `${fieldPath}.shockwave.repeat.windowStart`, ctx),
          windowEnd: ensureNonNegativeInteger(rr.windowEnd, `${fieldPath}.shockwave.repeat.windowEnd`, ctx),
          loopFrame: ensureNonNegativeInteger(rr.loopFrame, `${fieldPath}.shockwave.repeat.loopFrame`, ctx),
          entryFrame: ensureNonNegativeInteger(rr.entryFrame, `${fieldPath}.shockwave.repeat.entryFrame`, ctx),
          ...(rr.maxRepeats === undefined ? {} : { maxRepeats: ensureNonNegativeInteger(rr.maxRepeats, `${fieldPath}.shockwave.repeat.maxRepeats`, ctx) }),
          ...(rr.doubleRepeatFrom === undefined ? {} : { doubleRepeatFrom: ensureNonNegativeInteger(rr.doubleRepeatFrom, `${fieldPath}.shockwave.repeat.doubleRepeatFrom`, ctx) }),
        };
      })();
      move = {
        ...base,
        type: 'downSpecial',
        downSpecialKind: 'shockwave',
        shockwave: {
          ...(aerialVariant === undefined ? {} : { aerialVariant }),
          ...(repeat === undefined ? {} : { repeat }),
        },
      };
      break;
    }
    default:
      throw new Error(
        `${ctx}: ${fieldPath}.downSpecialKind must be one of [groundPound, trap, stallAndFall, counter, shockwave], got '${kind}'`,
      );
  }
  validateDownSpecialMove(move);
  return move;
}

/**
 * Parse the optional `moves` block from the on-disk file. Every
 * sub-field is optional so a character can author moves piecemeal.
 * Returns `undefined` if the block is absent.
 */
function parseMovesBlock(
  raw: unknown,
  ctx: string,
): CharacterMovesSpec | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || typeof raw !== 'object') {
    throw new Error(`${ctx}: 'moves' must be an object when present`);
  }
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (r.taunts !== undefined) {
    const t = asObject(r.taunts, `moves.taunts`, ctx);
    const parsed: Record<string, unknown> = {};
    for (const kind of ['up', 'side', 'down'] as const) {
      const row = asObject(t[kind], `moves.taunts.${kind}`, ctx);
      parsed[kind] = {cancelAfterFrames: row.cancelAfterFrames, presentationFrames: row.presentationFrames};
    }
    validateTauntSet(parsed as unknown as TauntSet);
    out.taunts = parsed;
  }
  for (const slot of ['getupAttack', 'getupAttackFaceDown', 'tripAttack', 'ledgeAttack']) {
    if (r[slot] !== undefined) out[slot] = parseGroundedAttack(r[slot], `moves.${slot}`, ctx);
  }
  if (r.jab !== undefined) out.jab = parseGroundedAttack(r.jab, 'moves.jab', ctx);
  if (r.jab2 !== undefined) out.jab2 = parseGroundedAttack(r.jab2, 'moves.jab2', ctx);
  if (r.jab3 !== undefined) out.jab3 = parseGroundedAttack(r.jab3, 'moves.jab3', ctx);
  if (r.smash2 !== undefined) out.smash2 = parseGroundedAttack(r.smash2, 'moves.smash2', ctx);
  if (r.tilt !== undefined) out.tilt = parseGroundedAttack(r.tilt, 'moves.tilt', ctx);
  if (r.smash !== undefined) out.smash = parseGroundedAttack(r.smash, 'moves.smash', ctx);
  if (r.sideLight !== undefined)
    out.sideLight = parseGroundedAttack(r.sideLight, 'moves.sideLight', ctx);
  if (r.upLight !== undefined)
    out.upLight = parseGroundedAttack(r.upLight, 'moves.upLight', ctx);
  if (r.upSmash !== undefined)
    out.upSmash = parseGroundedAttack(r.upSmash, 'moves.upSmash', ctx);
  if (r.downLight !== undefined)
    out.downLight = parseGroundedAttack(r.downLight, 'moves.downLight', ctx);
  if (r.downSmash !== undefined)
    out.downSmash = parseGroundedAttack(r.downSmash, 'moves.downSmash', ctx);
  if (r.dashAttack !== undefined)
    out.dashAttack = parseGroundedAttack(r.dashAttack, 'moves.dashAttack', ctx);
  if (r.fair !== undefined) out.fair = parseAerial(r.fair, 'moves.fair', ctx);
  if (r.bair !== undefined) out.bair = parseAerial(r.bair, 'moves.bair', ctx);
  if (r.nair !== undefined) out.nair = parseNeutralAerial(r.nair, 'moves.nair', ctx);
  if (r.uair !== undefined) out.uair = parseAerial(r.uair, 'moves.uair', ctx);
  if (r.dair !== undefined) out.dair = parseAerial(r.dair, 'moves.dair', ctx);
  if (r.grab !== undefined) out.grab = parseGrab(r.grab, 'moves.grab', ctx);
  if (r.neutralSpecial !== undefined)
    out.neutralSpecial = parseNeutralSpecial(
      r.neutralSpecial,
      'moves.neutralSpecial',
      ctx,
    );
  if (r.sideSpecial !== undefined)
    out.sideSpecial = parseSideSpecial(
      r.sideSpecial,
      'moves.sideSpecial',
      ctx,
    );
  if (r.upSpecial !== undefined)
    out.upSpecial = parseUpSpecial(r.upSpecial, 'moves.upSpecial', ctx);
  if (r.downSpecial !== undefined)
    out.downSpecial = parseDownSpecial(r.downSpecial, 'moves.downSpecial', ctx);
  return Object.freeze(out) as CharacterMovesSpec;
}

/** The same authoring parser at live checkpoint boundaries. No fake animation
 * envelope or renderer data is added to make an invalid move parse. */
export function parseAttackMoveSnapshot(value:unknown,path='checkpoint.move'):AttackMoveWithAnimation {
  const row=asObject(value,path,'runtime checkpoint');
  const ctx='runtime checkpoint';
  if(row.type==='special')return parseNeutralSpecial(value,path,ctx);
  if(row.type==='sideSpecial')return parseSideSpecial(value,path,ctx);
  if(row.type==='upSpecial')return parseUpSpecial(value,path,ctx);
  if(row.type==='downSpecial')return parseDownSpecial(value,path,ctx);
  if(row.type==='aerial')return parseAerial(value,path,ctx);
  if(!['jab','tilt','smash'].includes(String(row.type)))throw new Error(`${path} unsupported saved attack type`);
  return parseGroundedAttack(value,path,ctx);
}
export function parseAttackCollisionHitsSnapshot(value:unknown,path='checkpoint.collisionHits'){
  return parseCollisionHits(value,path,'runtime checkpoint');
}
export function parseKnockbackSnapshot(value:unknown,path='checkpoint.knockback'){
  return parseKnockback(value,path,'runtime checkpoint');
}

/** A present launch profile is complete; only an absent profile inherits defaults. */
function parseReferenceLaunch(raw: unknown, fieldPath: string, ctx: string): ReferenceLaunchProfile {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${ctx}: ${fieldPath} must be an object`);
  }
  const r = raw as Record<string, unknown>;
  return Object.freeze({
    gravity: ensureNonNegativeNumber(r.gravity, `${fieldPath}.gravity`, ctx),
    fallSpeed: ensurePositiveNumber(r.fallSpeed, `${fieldPath}.fallSpeed`, ctx),
    verticalGravity: ensureNonNegativeNumber(r.verticalGravity, `${fieldPath}.verticalGravity`, ctx),
    verticalFallSpeed: ensurePositiveNumber(r.verticalFallSpeed, `${fieldPath}.verticalFallSpeed`, ctx),
  });
}

/** Preserve authored ground movement when importing or reloading a tune. */
function parseLocomotionTuning(
  raw: unknown, defaults: LocomotionTuning | undefined, ctx: string,
): LocomotionTuning {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${ctx}: movement.locomotion must be an object`);
  }
  const source = raw as Record<string, unknown>;
  const result: { -readonly [K in keyof LocomotionTuning]: LocomotionTuning[K] } = { ...defaults };
  for (const key of ['walkMaxSpeed', 'initialDashSpeed', 'runMaxSpeed'] as const) {
    if (source[key] !== undefined) result[key] = ensureNonNegativeNumber(source[key], `movement.locomotion.${key}`, ctx);
  }
  for (const key of ['dashDanceWindowFrames', 'pivotStopFrames'] as const) {
    if (source[key] !== undefined) result[key] = ensureNonNegativeInteger(source[key], `movement.locomotion.${key}`, ctx);
  }
  for (const key of ['pivotDamping', 'walkStickThreshold', 'dashStickThreshold', 'crouchStickThreshold'] as const) {
    if (source[key] === undefined) continue;
    const value = ensureNonNegativeNumber(source[key], `movement.locomotion.${key}`, ctx);
    if (value > 1) throw new Error(`${ctx}: movement.locomotion.${key} must be <= 1`);
    result[key] = value;
  }
  for (const key of ['initialDashInstantStart', 'crouchEnabled', 'jumpsquatKeepsFacing'] as const) {
    if (source[key] === undefined) continue;
    if (typeof source[key] !== 'boolean') throw new Error(`${ctx}: movement.locomotion.${key} must be a boolean`);
    result[key] = source[key];
  }
  return Object.freeze(result);
}

/**
 * Parse a {@link CharacterDataFile} record into a validated {@link CharacterDataSpec}.
 * Throws with the field path and caller-supplied context on the first violation.
 * Pure: same input always yields the same result or error.
 */
export function parseCharacterDataFile(
  raw: unknown,
  contextLabel = 'character data',
): CharacterDataSpec {
  if (raw === null || typeof raw !== 'object') {
    throw new Error(`${contextLabel}: top-level value must be an object`);
  }
  const r = raw as Record<string, unknown>;

  const id = ensureCharacterId(r.id, contextLabel);
  const ctx = `${contextLabel} '${id}'`;
  const displayName = ensureString(r.displayName, 'displayName', ctx);
  const role = ensureString(r.role, 'role', ctx);

  // body
  if (r.body === null || typeof r.body !== 'object') {
    throw new Error(`${ctx}: 'body' must be an object`);
  }
  const b = r.body as Record<string, unknown>;
  const body = {
    width: ensurePositiveNumber(b.width, 'body.width', ctx),
    height: ensurePositiveNumber(b.height, 'body.height', ctx),
    chamfer: ensureFiniteNumber(b.chamfer, 'body.chamfer', ctx),
  };
  if (body.chamfer < 0) {
    throw new Error(`${ctx}: 'body.chamfer' must be >= 0, got ${body.chamfer}`);
  }

  // movement
  if (r.movement === null || typeof r.movement !== 'object') {
    throw new Error(`${ctx}: 'movement' must be an object`);
  }
  const m = r.movement as Record<string, unknown>;
  // Fall-shaping fields (Smash-feel pack) are OPTIONAL in the JSON so
  // character files saved before the pack landed keep parsing; missing
  // values default to the fighter's registered movement profile, which
  // is the same source the runtime resolves at construction time.
  const profileDefaults = getFighterMovementProfile(id);
  const dkVerticalRaw=m.donkeykongOrdinaryVertical===undefined?profileDefaults.donkeykongOrdinaryVertical:m.donkeykongOrdinaryVertical;
  let donkeykongOrdinaryVertical:FighterMovementProfile['donkeykongOrdinaryVertical'];
  if(dkVerticalRaw!==undefined){
    if(id!=='donkeykong'||dkVerticalRaw===null||typeof dkVerticalRaw!=='object')
      throw new Error(`${ctx}: movement.donkeykongOrdinaryVertical requires DK and an object`);
    const v=dkVerticalRaw as Record<string,unknown>;
    if(!Array.isArray(v.fullHopStepVelocitiesY)||v.fullHopStepVelocitiesY.length!==4)
      throw new Error(`${ctx}: movement.donkeykongOrdinaryVertical requires four opening samples`);
    const samples=v.fullHopStepVelocitiesY.map((sample,i)=>{
      const velocity=ensureFiniteNumber(sample,`movement.donkeykongOrdinaryVertical.fullHopStepVelocitiesY[${i}]`,ctx);
      if(velocity>=0)throw new Error(`${ctx}: full-hop opening velocity must be upward`);
      return velocity;
    });
    donkeykongOrdinaryVertical=Object.freeze({
      totalGravity:ensurePositiveNumber(v.totalGravity,'movement.donkeykongOrdinaryVertical.totalGravity',ctx),
      fullHopStepVelocitiesY:Object.freeze(samples),
    });
  }
  const referenceLaunch = m.referenceLaunch === undefined ? profileDefaults.referenceLaunch : m.referenceLaunch;
  const optionalArc: { -readonly [K in keyof AirMovementTuning]: AirMovementTuning[K] } & LandingTuning = {};
  for (const key of ['riseAccel', 'shortHopRiseAccel', 'shortHopImpulse', 'maxAirSpeed',
    'airJumpImpulse', 'airJumpRiseAccel'] as const) {
    const value = m[key] === undefined ? profileDefaults[key] : m[key];
    if (value !== undefined) {
      optionalArc[key] = key === 'shortHopImpulse' || key === 'airJumpImpulse' || key === 'maxAirSpeed'
        ? ensurePositiveNumber(value, `movement.${key}`, ctx)
        : ensureNonNegativeNumber(value, `movement.${key}`, ctx);
    }
  }
  for (const key of ['softLandingFrames', 'hardLandingFrames', 'hardLandingSpeedFrames',
    'airDodgeLandingFrames', 'directionalAirDodgeLandingFrames', 'directionalAirDodgeLateLandingFrames'] as const) {
    const value = m[key] === undefined ? profileDefaults[key] : m[key];
    if (value !== undefined) {
      optionalArc[key] = ensureNonNegativeInteger(value, `movement.${key}`, ctx);
    }
  }
  const movement: FighterMovementProfile = {
    ...optionalArc,
    ...(donkeykongOrdinaryVertical?{donkeykongOrdinaryVertical}:{}),
    ...(m.locomotion === undefined
      ? profileDefaults.locomotion === undefined ? {} : { locomotion: profileDefaults.locomotion }
      : { locomotion: parseLocomotionTuning(m.locomotion, profileDefaults.locomotion, ctx) }),
    ...(m.dodge === undefined ? profileDefaults.dodge === undefined ? {} : { dodge: profileDefaults.dodge }
      : { dodge: parseDodgeTuning(m.dodge, profileDefaults.dodge, ctx) }),
    ...(m.ledge === undefined ? profileDefaults.ledge === undefined ? {} : { ledge: profileDefaults.ledge }
      : { ledge: parseLedgeTuning(m.ledge, profileDefaults.ledge, ctx) }),
    maxRunSpeed: ensurePositiveNumber(m.maxRunSpeed, 'movement.maxRunSpeed', ctx),
    groundAccel: ensurePositiveNumber(m.groundAccel, 'movement.groundAccel', ctx),
    ...(m.shieldPushTraction===undefined?{}:{shieldPushTraction:ensureNonNegativeNumber(m.shieldPushTraction,'movement.shieldPushTraction',ctx)}),
    airAccel: ensurePositiveNumber(m.airAccel, 'movement.airAccel', ctx),
    groundDamping: ensureFiniteNumber(m.groundDamping, 'movement.groundDamping', ctx),
    airDamping: ensureFiniteNumber(m.airDamping, 'movement.airDamping', ctx),
    jumpImpulse: ensurePositiveNumber(m.jumpImpulse, 'movement.jumpImpulse', ctx),
    maxJumps: ensureNonNegativeInteger(m.maxJumps, 'movement.maxJumps', ctx),
    mass: ensurePositiveNumber(m.mass, 'movement.mass', ctx),
    ...(m.referenceWeight === undefined
      ? profileDefaults.referenceWeight === undefined ? {} : { referenceWeight: profileDefaults.referenceWeight }
      : { referenceWeight: ensurePositiveNumber(m.referenceWeight, 'movement.referenceWeight', ctx) }),
    ...(referenceLaunch === undefined ? {} : {
      referenceLaunch: parseReferenceLaunch(referenceLaunch, 'movement.referenceLaunch', ctx),
    }),
    fallAccel:
      m.fallAccel === undefined
        ? profileDefaults.fallAccel
        : ensureFiniteNumber(m.fallAccel, 'movement.fallAccel', ctx),
    maxFallSpeed:
      m.maxFallSpeed === undefined
        ? profileDefaults.maxFallSpeed
        : ensurePositiveNumber(m.maxFallSpeed, 'movement.maxFallSpeed', ctx),
    fastFallSpeed:
      m.fastFallSpeed === undefined
        ? profileDefaults.fastFallSpeed
        : ensurePositiveNumber(m.fastFallSpeed, 'movement.fastFallSpeed', ctx),
    jumpCutFactor:
      m.jumpCutFactor === undefined
        ? profileDefaults.jumpCutFactor
        : ensureFiniteNumber(m.jumpCutFactor, 'movement.jumpCutFactor', ctx),
  };

  const moves = parseMovesBlock(r.moves, ctx);

  return Object.freeze({
    id,
    displayName,
    role,
    body: Object.freeze(body),
    movement: Object.freeze(movement),
    ...(moves ? { moves } : {}),
    ...(r.captureAttachmentCalibration===undefined?{}:{captureAttachmentCalibration:parseCaptureAttachmentCalibration(r.captureAttachmentCalibration,`${ctx}.captureAttachmentCalibration`)}),
  });
}

/**
 * Serialize a {@link CharacterDataSpec} back to a
 * {@link CharacterDataFile}-shaped plain object suitable for
 * `JSON.stringify`. Round-trips losslessly with
 * {@link parseCharacterDataFile} (modulo the optional `$schema`
 * field, which the parser ignores) — with one deliberate asymmetry:
 * fall-shaping fields (`fallAccel` / `maxFallSpeed` / `fastFallSpeed`
 * / `jumpCutFactor`) that the parser defaulted from the registered
 * movement profile ARE materialized on re-serialization. The
 * validated spec always carries the full movement profile, so a
 * legacy file (authored before the Smash-feel pack, no fall-shaping
 * fields) saved through this function gains the four fields at their
 * canonical profile values. Spec → file → spec is still the identity;
 * file → spec → file intentionally upgrades legacy files in place
 * rather than re-deriving which fields the author originally omitted.
 */
export function serializeCharacterDataSpec(
  spec: CharacterDataSpec,
  schemaRef?: string,
): CharacterDataFile {
  return {
    ...(schemaRef !== undefined ? { $schema: schemaRef } : {}),
    ...(spec.id === 'link' ? { [LINK_FORMAT_FIELD]: LINK_FORMAT_CURRENT } : {}),
    id: spec.id,
    displayName: spec.displayName,
    role: spec.role,
    body: {
      width: spec.body.width,
      height: spec.body.height,
      chamfer: spec.body.chamfer,
    },
    movement: { ...spec.movement,
      ...(spec.movement.donkeykongOrdinaryVertical?{donkeykongOrdinaryVertical:{...spec.movement.donkeykongOrdinaryVertical,
        fullHopStepVelocitiesY:[...spec.movement.donkeykongOrdinaryVertical.fullHopStepVelocitiesY]}}:{}),
      ...(spec.movement.ledge ? { ledge: { ...spec.movement.ledge } } : {}) },
    ...(spec.moves ? { moves: { ...spec.moves } } : {}),
    ...(spec.captureAttachmentCalibration===undefined?{}:{captureAttachmentCalibration:parseCaptureAttachmentCalibration(spec.captureAttachmentCalibration,'captureAttachmentCalibration')}),
  };
}
