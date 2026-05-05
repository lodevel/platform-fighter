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

import type { CharacterId } from '../types';
import type { FighterMovementProfile } from './movesetContract';
import type { AttackMoveWithAnimation, KnockbackSpec, MoveAnimation } from './moveSchema';
import type { AerialMove } from './aerialSchema';
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
import { validateGrabSpec } from './grabSchema';
import { validateThrowSet } from './throwSchema';
import { validateNeutralSpecialMove } from './specialSchema';
import { validateSideSpecialMove } from './sideSpecialSchema';
import { validateUpSpecialMove } from './upSpecialSchema';
import { validateDownSpecialMove } from './downSpecialSchema';
import { validateChargeSpec } from './chargeSchema';

/**
 * On-disk record shape — what `data/characters/<id>.json` carries.
 * Mirrors {@link CharacterDataSpec} exactly; the type is shared so the
 * `JSON.parse(...)` happy-path narrows directly.
 */
export interface CharacterDataFile {
  /** JSON Schema reference for editor tooling — unused at runtime. */
  readonly $schema?: string;
  readonly id: CharacterId;
  readonly displayName: string;
  readonly role: string;
  readonly body: {
    readonly width: number;
    readonly height: number;
    readonly chamfer: number;
  };
  readonly movement: FighterMovementProfile;
  /**
   * Optional move-set authoring block. When present, carries the
   * core 4 grounded normals (jab + tilt + smash + fair) plus the
   * optional extended slots (sideLight / upLight / downLight / nair
   * / uair / dair) plus the optional grab + throws. Specials live in
   * their own discriminated-union schemas and aren't authored here
   * yet — that's the M5.5 follow-up.
   */
  readonly moves?: CharacterMovesData;
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
  readonly jab?: AttackMoveWithAnimation;
  readonly tilt?: AttackMoveWithAnimation;
  readonly smash?: AttackMoveWithAnimation;
  readonly sideLight?: AttackMoveWithAnimation;
  readonly upLight?: AttackMoveWithAnimation;
  readonly downLight?: AttackMoveWithAnimation;
  readonly fair?: AerialMove;
  readonly nair?: AerialMove;
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

const VALID_CHARACTER_IDS: ReadonlySet<CharacterId> = new Set<CharacterId>([
  'wolf',
  'cat',
  'owl',
  'bear',
]);

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
      `${contextLabel}: 'id' must be one of [wolf, cat, owl, bear], got ${String(value)}`,
    );
  }
  return value as CharacterId;
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
  return {
    x: ensureFiniteNumber(r.x, `${fieldPath}.x`, ctx),
    y: ensureFiniteNumber(r.y, `${fieldPath}.y`, ctx),
    scaling: ensureFiniteNumber(r.scaling, `${fieldPath}.scaling`, ctx),
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
): MoveAnimation {
  if (raw === null || typeof raw !== 'object') {
    throw new Error(`${ctx}: ${fieldPath} must be an object`);
  }
  const r = raw as Record<string, unknown>;
  return {
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
  if (raw === null || typeof raw !== 'object') {
    throw new Error(`${ctx}: ${fieldPath} must be an object`);
  }
  const r = raw as Record<string, unknown>;
  return {
    id: ensureString(r.id, `${fieldPath}.id`, ctx),
    type: ensureString(r.type, `${fieldPath}.type`, ctx) as AttackMoveWithAnimation['type'],
    damage: ensureFiniteNumber(r.damage, `${fieldPath}.damage`, ctx),
    knockback: parseKnockback(r.knockback, `${fieldPath}.knockback`, ctx),
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
    animation: parseAnimationBlock(r.animation, `${fieldPath}.animation`, ctx),
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
  return {
    ...base,
    aerialDirection,
    landingLagFrames,
    autoCancelWindows,
  } as AerialMove;
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
  return {
    damage: ensureFiniteNumber(r.damage, `${fieldPath}.damage`, ctx),
    knockback: parseKnockback(r.knockback, `${fieldPath}.knockback`, ctx),
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
            damage: ensureFiniteNumber(p.damage, `${fieldPath}.pummel.damage`, ctx),
            cooldownFrames: ensureNonNegativeInteger(
              p.cooldownFrames,
              `${fieldPath}.pummel.cooldownFrames`,
              ctx,
            ),
          };
        })();
  const spec: GrabSpec = {
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
): ChargeSpec {
  const spec: ChargeSpec = {
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
  return {
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
  return {
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
  };
}

function parseDownStallAndFallSpec(
  raw: Record<string, unknown>,
  fieldPath: string,
  ctx: string,
): StallAndFallDownSpecialMove['stallAndFall'] {
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
    default:
      throw new Error(
        `${ctx}: ${fieldPath}.downSpecialKind must be one of [groundPound, trap, stallAndFall, counter], got '${kind}'`,
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
  if (r.jab !== undefined) out.jab = parseGroundedAttack(r.jab, 'moves.jab', ctx);
  if (r.tilt !== undefined) out.tilt = parseGroundedAttack(r.tilt, 'moves.tilt', ctx);
  if (r.smash !== undefined) out.smash = parseGroundedAttack(r.smash, 'moves.smash', ctx);
  if (r.sideLight !== undefined)
    out.sideLight = parseGroundedAttack(r.sideLight, 'moves.sideLight', ctx);
  if (r.upLight !== undefined)
    out.upLight = parseGroundedAttack(r.upLight, 'moves.upLight', ctx);
  if (r.downLight !== undefined)
    out.downLight = parseGroundedAttack(r.downLight, 'moves.downLight', ctx);
  if (r.fair !== undefined) out.fair = parseAerial(r.fair, 'moves.fair', ctx);
  if (r.nair !== undefined) out.nair = parseAerial(r.nair, 'moves.nair', ctx);
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

/**
 * Parse a {@link CharacterDataFile} record (the result of
 * `JSON.parse` on a `data/characters/<id>.json` file) into a
 * validated {@link CharacterDataSpec}.
 *
 * Throws on the first invariant violation with a message that
 * identifies the failing field. The `contextLabel` (default
 * `'character data'`) is embedded in error messages so the caller can
 * supply a file path for diagnostics.
 *
 * Pure: same input always yields same output (or same throw).
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
  const movement: FighterMovementProfile = {
    maxRunSpeed: ensurePositiveNumber(m.maxRunSpeed, 'movement.maxRunSpeed', ctx),
    groundAccel: ensurePositiveNumber(m.groundAccel, 'movement.groundAccel', ctx),
    airAccel: ensurePositiveNumber(m.airAccel, 'movement.airAccel', ctx),
    groundDamping: ensureFiniteNumber(m.groundDamping, 'movement.groundDamping', ctx),
    airDamping: ensureFiniteNumber(m.airDamping, 'movement.airDamping', ctx),
    jumpImpulse: ensurePositiveNumber(m.jumpImpulse, 'movement.jumpImpulse', ctx),
    maxJumps: ensureNonNegativeInteger(m.maxJumps, 'movement.maxJumps', ctx),
    mass: ensurePositiveNumber(m.mass, 'movement.mass', ctx),
  };

  const moves = parseMovesBlock(r.moves, ctx);

  return Object.freeze({
    id,
    displayName,
    role,
    body: Object.freeze(body),
    movement: Object.freeze(movement),
    ...(moves ? { moves } : {}),
  });
}

/**
 * Serialize a {@link CharacterDataSpec} back to a
 * {@link CharacterDataFile}-shaped plain object suitable for
 * `JSON.stringify`. Round-trips losslessly with
 * {@link parseCharacterDataFile} (modulo the optional `$schema`
 * field, which the parser ignores).
 */
export function serializeCharacterDataSpec(
  spec: CharacterDataSpec,
  schemaRef?: string,
): CharacterDataFile {
  return {
    ...(schemaRef !== undefined ? { $schema: schemaRef } : {}),
    id: spec.id,
    displayName: spec.displayName,
    role: spec.role,
    body: {
      width: spec.body.width,
      height: spec.body.height,
      chamfer: spec.body.chamfer,
    },
    movement: { ...spec.movement },
    ...(spec.moves ? { moves: { ...spec.moves } } : {}),
  };
}
