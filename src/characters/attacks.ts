/**
 * Attack-move primitives shared by every fighter subclass.
 *
 * This module is the data layer for AC 202 Sub-AC 2: it declares the
 * shape of a basic attack (hitbox, damage value, frame timings,
 * cooldown), the Matter `label` stamped on every spawned hitbox body,
 * and the small body-factory used by `Character.attemptAttack` to emit
 * a sensor in front of the fighter. The class wires these primitives
 * into a per-frame state machine; concrete characters (Wolf, Cat, …)
 * register their `AttackMove` definitions at construction time.
 *
 * Why a separate file:
 *   • Keeps the base `Character` class readable — body construction
 *     and movement physics already live there.
 *   • Lets the M2 roster declare movesets as plain data tables next to
 *     each subclass without dragging in Phaser/Matter symbol soup.
 *   • Lets unit tests assert hitbox shape, damage, cooldown semantics
 *     against pure data, no rendering required.
 *
 * Determinism note: every value here is integer frames or a static
 * geometry offset. No wall-clock reads, no `Math.random()` — replays
 * driving identical inputs into a fighter constructed with the same
 * `AttackMove` table will spawn identical hitboxes on identical
 * frames.
 */

import type { MoveType } from '../types';
import type { ReferenceKnockbackSpec } from './referenceKnockback';
import { COLLISION_CATEGORIES, COLLISION_MASKS } from '../engine/collisionCategories';
import type { PhysicsHost } from '../physics/PhysicsWorld';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Matter `label` stamped on every attack hitbox sensor body. */
export const HITBOX_LABEL = 'hitbox.attack';

/** Convenience alias for the canonical hitbox collision filter. */
export const HITBOX_COLLISION_FILTER = {
  category: COLLISION_CATEGORIES.HITBOX,
  mask: COLLISION_MASKS.HITBOX,
  group: 0,
} as const;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Static description of an attack move. All fields are required so a
 * subclass can't accidentally ship a half-defined attack — defaults
 * for "no special tuning" still mean writing them out (`scaling: 0`,
 * `recoveryFrames: 0`, etc.) which is what we want for clarity.
 *
 * Frame model (values in deterministic 60 Hz frames):
 *
 *   ── startupFrames ── activeFrames ── recoveryFrames ── cooldownFrames ──
 *   |                  | hitbox live |                  | locked out      |
 *   press                                                                  next press
 *
 *   total move-busy frames = startup + active + recovery
 *   cooldown is the gap *after* the move ends before another attack
 *   can begin. Combined "lockout" from press → next press is therefore
 *   `startup + active + recovery + cooldown`.
 */
/** One super-armour interval on a move (zero-based half-open elapsed steps). */
export interface AttackArmorWindow {
  readonly startFrame: number;
  readonly endFrame: number;
  /**
   * Optional charge gate in [0, 1]: the window only armours the fighter when
   * the move was released with at least this fraction of its full charge
   * (Donkey Kong's Giant Punch armours only at full charge).
   */
  readonly minChargeRatio?: number;
}

export interface AttackHitWindow {
  readonly statusEffect?:'bury';
  /** Native additive trip probability; omitted keeps legacy no-trip behavior. */
  readonly tripChance?: number;
  readonly setoff?: 'on' | 'off' | 'through';
  readonly shieldDamage?: number;
  /** Native shield-push multiplier; independent of shield damage/stun. */
  readonly shieldSetoffMultiplier?: number;
  /** Original native packet metadata; omission remains unknown. */
  readonly nativeAttackHeight?:'low'|'high';
  readonly nativeAttackHeightSource?:import('./attackHeightMetadata').AttackHeightSourceReceipt;
  readonly nativeCollisionAttribute?: string;
  readonly nativeForceReaction?: boolean;
  /** Native ATTACK direct flag; omitted selects direct contact. */
  readonly direct?:boolean;
  readonly reflectable?:boolean;readonly absorbable?:boolean;
  readonly launchDirection?: 'forward' | 'back' | 'position';
  readonly collisionHits?: readonly AttackCollisionHit[];
  readonly hitlagMultiplier?: number;
  /** Source electric collision attribute; separate from authored hitbox hit-stop factor. */
  readonly electricCollision?: boolean;
  readonly sdiMultiplier?: number;
  /** Minimum post-hitlag action lockout, independent of launch strength. */
  readonly minHitstunFrames?: number;
  /** Carry the attacker's motion into an airborne victim's linking launch. */
  readonly airborneVelocityCarry?: boolean;
  /** Whole-action elapsed frames, inclusive start and exclusive end. */
  readonly startFrame: number;
  readonly endFrame: number;
  /** Windows sharing a group can hit each victim only once per attack. */
  readonly group?: string;
  readonly damage?: number;
  readonly knockback?: AttackMove['knockback'];
  readonly groundedKnockback?: AttackMove['knockback'];
  readonly hitbox?: AttackMove['hitbox'];
  readonly sweetSpot?: AttackMove['sweetSpot'];
  /** Relative to the facing latched when the attack started. */
  readonly facing?: 1 | -1;
}

/** A source hitbox projected into the fighter's local 2D coordinates.
 * Source ID priority applies within the single supported part (part zero). */
export interface AttackCollisionHit {
  readonly statusEffect?:'bury';
  readonly tripChance?: number;
  readonly setoff?: 'on' | 'off' | 'through';
  /** Minimum frames from this target's last confirmed contact in the injected
   * gameplay clock. Zero/absent retains once-per-strike confirmation. */
  readonly rehitFrames?: number;
  readonly shieldDamage?: number;
  /** Native shield-push multiplier; independent of shield damage/stun. */
  readonly shieldSetoffMultiplier?: number;
  /** Original native packet metadata; omission remains unknown. */
  readonly nativeAttackHeight?:'low'|'high';
  readonly nativeAttackHeightSource?:import('./attackHeightMetadata').AttackHeightSourceReceipt;
  readonly nativeCollisionAttribute?: string;
  readonly nativeForceReaction?: boolean;
  /** Native ATTACK direct flag; omitted selects direct contact. */
  readonly direct?:boolean;
  readonly reflectable?:boolean;readonly absorbable?:boolean;
  /** Per-record override of the move's unblockable flag (shield bubbles are ignored). */
  readonly unblockable?:boolean;
  readonly launchDirection?: 'forward' | 'back' | 'position';
  readonly minHitstunFrames?: number;
  readonly airborneVelocityCarry?: boolean;
  readonly id: number;
  readonly capsule: {
    readonly start: { readonly x: number; readonly y: number };
    readonly end: { readonly x: number; readonly y: number };
    readonly radius: number;
  };
  readonly situation?: 'ground' | 'air';
  readonly targetCategory?: 'fighter' | 'all';
  readonly damage?: number;
  readonly knockback?: AttackMove['knockback'];
  readonly groundedKnockback?: AttackMove['knockback'];
  readonly hitlagMultiplier?: number;
  /** Source electric collision attribute; separate from authored hitbox hit-stop factor. */
  readonly electricCollision?: boolean;
  readonly sdiMultiplier?: number;
}

/**
 * A reflector field a move carries over `[startFrame, endFrame)` of its own
 * zero-based action age. `body` is body-centre px authored facing right.
 * `swingOnReflect`: a reflect during startup jumps the move to its first
 * active frame (the Ultimate Home-Run Bat forward smash).
 */
export interface AttackReflectWindow {
  readonly startFrame: number;
  readonly endFrame: number;
  readonly body: { readonly offsetX: number; readonly offsetY: number; readonly width: number; readonly height: number };
  readonly damageMultiplier: number;
  readonly speedMultiplier: number;
  readonly swingOnReflect?: boolean;
}

/** A projectile a held item fires (Star Rod star, Ray Gun / Super Scope shots, Fire Flower flames): a straight
 * sensor box flying along the facing (the MatchScene projectile pipeline, gravity-free by design: the native shot
 * items have gravity_accel 0), with its own damage packet. Offsets are world px from the body centre. */
export interface ItemShot {
  readonly reflectable?:boolean;readonly absorbable?:boolean;
  readonly id: string;
  readonly damage: number;
  readonly knockback: AttackMove['knockback'];
  readonly speed: number;
  readonly lifetimeFrames: number;
  readonly width: number;
  readonly height: number;
  readonly spawnOffsetX: number;
  readonly spawnOffsetY: number;
  /** How MatchScene draws it over its exact damage area. */
  readonly visual: 'star' | 'laser' | 'scope' | 'flame';
}

export interface AttackMove {
  /** Stable source action lineage, independent from authored input/queue ID. */
  readonly sourcePoseId?: string;
  readonly absorber?:import('./attackAbsorber').AttackAbsorbWindow;
  /** New source-based fighters require matched posed geometry. Missing
   * profile cannot silently become the broadphase placeholder hitbox. */
  readonly sourcePoseRequired?: boolean;
  /** A fighter-owned controller consumes this action's articles/events.
   * Generic projectile/trap callbacks must not duplicate those effects. */
  readonly sourceRuntimeOwned?: boolean;
  /** Native item motion this held-item use plays (e.g. `item_bat_swing_3`). A fighter
   * without that clip shows the attack sheet of the move's `type`. */
  readonly itemClip?: string;
  /** A held item's projectile, fired on the use's first active frame while the item has ammo (Star Rod star). */
  readonly itemShot?: ItemShot;
  readonly reflectWindow?: AttackReflectWindow;
  readonly statusEffect?:'bury';
  /** Move-owned grounded steering; absent retains ordinary locomotion. */
  readonly groundedMotion?: { readonly acceleration: number; readonly friction: number; readonly maxSpeed: number;
    readonly postHitFriction?: number; readonly postHitFrame?: number };
  /** Source status entry momentum multipliers, selected by actual entry situation. */
  readonly entryVelocityScale?: { readonly xGround: number; readonly xAir: number; readonly yGround: number; readonly yAir: number };
  readonly gravityScale?: number;
  /** Regional receiving protection, in zero-based half-open action ages.
   * Regions name authored receiving bones, not hitbox IDs or sprite pixels. */
  readonly protectionWindows?: readonly {
    readonly startFrame: number;
    readonly endFrame: number;
    readonly regions: readonly string[];
  }[];
  /** Source-guided corner/foot-root ledge attachment adapter, sampled once per action age. */
  readonly ledgeRootMotion?: readonly import('./ledgeRootMotionSchema').LedgeRootPoint[];
  readonly tripChance?: number;
  readonly setoff?: 'on' | 'off' | 'through';
  /** Versioned published mechanic preset, transported with saved fighters. */
  readonly pikachuSpecial?: import('./pikachuSpecialMoves').PikachuSpecialPreset;
  /** Native per-state records, selected at action entry/release. */
  readonly airborneVariant?: import('./moveSchema').AttackMoveWithAnimation;
  readonly fullChargeVariant?: import('./moveSchema').AttackMoveWithAnimation;
  readonly angledVariants?: {
    readonly up: import('./moveSchema').AttackMoveWithAnimation;
    readonly down: import('./moveSchema').AttackMoveWithAnimation;
  };
  readonly shieldDamage?: number;
  /** Native shield-push multiplier; independent of shield damage/stun. */
  readonly shieldSetoffMultiplier?: number;
  /** Original native packet metadata; omission remains unknown. */
  readonly nativeAttackHeight?:'low'|'high';
  readonly nativeAttackHeightSource?:import('./attackHeightMetadata').AttackHeightSourceReceipt;
  readonly nativeCollisionAttribute?: string;
  readonly nativeForceReaction?: boolean;
  /** Native ATTACK direct flag; omitted selects direct contact. */
  readonly direct?:boolean;
  readonly reflectable?:boolean;readonly absorbable?:boolean;
  readonly launchDirection?: 'forward' | 'back' | 'position';
  /** Exact narrowphase records; one enclosing Matter sensor is used for detection. */
  readonly collisionHits?: readonly AttackCollisionHit[];
  /** Source hitlag/SDI factors; omitted keeps the default factor of one. */
  readonly hitlagMultiplier?: number;
  /** Source electric collision attribute; separate from authored hitbox hit-stop factor. */
  readonly electricCollision?: boolean;
  readonly sdiMultiplier?: number;
  /** Orient the launch axis toward the target's side; angles above 90 can pull inward. */
  readonly launchAwayFromSource?: boolean;
  readonly minHitstunFrames?: number;
  readonly airborneVelocityCarry?: boolean;
  /** Alternate launch for grounded victims (e.g. an air-only meteor). */
  readonly groundedKnockback?: AttackMove['knockback'];
  /** Stable identifier — used by AI / replay logs / debug overlays. */
  readonly id: string;
  /** Ontology bucket for this move — jab / tilt / smash / aerial / … */
  readonly type: MoveType;
  /** Damage applied on connect (added to the target's percent meter). */
  readonly damage: number;
  /**
   * Knockback vector at 0 % damage. Each component is in Matter
   * "px-per-step" units so multiplying by 60 gives px/sec.
   *
   * `scaling` is the per-percent multiplier — the realised knockback
   * vector at percent `p` is `(x, y) * (1 + scaling * p)`. A jab might
   * have `scaling: 0.05`; a finisher smash has `scaling: 0.4`+.
   *
   * Two OPTIONAL Smash-style components (absent = legacy math,
   * byte-identical):
   *
   *   • `baseMagnitude` — percent-INDEPENDENT launch floor added along
   *     the move's authored direction, NOT scaled by target mass
   *     (mirrors the `+ b` term in the canonical Smash formula). Gives
   *     finisher moves real shove — and real hitstun — at 0 %.
   *   • `damageGrowth` — feeds the move's damage back into the percent
   *     term (the `p·d/20` term in the canonical formula): growth
   *     becomes `scaling · p · (1 + damageGrowth · damage / 20)`, so
   *     heavy-hitting moves out-scale light pokes that author the same
   *     `scaling`.
   */
  readonly knockback: {
    /** Opt-in reference units; the legacy vector is inactive when present. */
    readonly reference?: ReferenceKnockbackSpec;
    readonly x: number;
    readonly y: number;
    readonly scaling: number;
    readonly baseMagnitude?: number;
    readonly damageGrowth?: number;
  };
  /**
   * Hitbox sensor geometry, in design pixels, relative to the
   * fighter's centre. `offsetX` is mirrored by `facing` automatically
   * so subclasses can author their hitbox as if always facing right.
   */
  readonly hitbox: {
    readonly offsetX: number;
    readonly offsetY: number;
    readonly width: number;
    readonly height: number;
  };
  /** Frames between input press and hitbox going active. */
  readonly startupFrames: number;
  /** Active envelope length, including any gaps declared by hitWindows. */
  readonly activeFrames: number;
  /** Frames the fighter is committed after the hitbox ends. */
  readonly recoveryFrames: number;
  /** Frames after the move ends before any attack can start again. */
  readonly cooldownFrames: number;
  /** Landing commitment after an airborne special, including its helpless fall. */
  readonly specialLandingLagFrames?: number;
  /** Optional intermittent strikes or early/late strengths within the active envelope. */
  readonly hitWindows?: readonly AttackHitWindow[];
  /**
   * Optional super-armor windows in zero-based half-open elapsed steps.
   * While the move is inside one, an incoming hit still connects — the
   * fighter takes the damage and the attacker freezes in hitlag — but it
   * cannot launch, stun or interrupt the fighter. Source frames `[a, b]`
   * map to `[a − 1, b)`. Sourced example: Donkey Kong's Headbutt armour on
   * frames 5–14 → `[4, 14)`.
   */
  readonly armorWindows?: readonly AttackArmorWindow[];
  /**
   * Presentation-only hint set by the runtime when it swaps in a special's
   * airborne/grounded variant, so the sprite router can pick a dedicated
   * `<sheet>_air` / `<sheet>_ground` strip when the fighter ships one.
   */
  readonly sheetVariant?: 'air' | 'ground' | 'first' | 'second' | 'end' | 'start' | 'hold' | 'release' | 'hit' | 'ground-hit' | 'air-hit' | 'up' | 'down';
  /**
   * Optional "sweet spot" sub-region — the canonical Smash idiom
   * where a portion of the move's hitbox (e.g. Marth's tipper, Falcon's
   * knee tip) lands harder than the rest. When the contact lands
   * within this sub-region the runtime treats the hit as a sweet-spot
   * connect:
   *
   *   • +4 frames of hitlag (extra crunch on impact — see
   *     `combat.ts:HITLAG_SWEET_SPOT_BONUS_FRAMES`).
   *   • Optional damage / knockback multipliers applied on top of the
   *     authored base values. Defaults of 1.0 mean "same damage, same
   *     knockback" — most moves only use the hitlag bonus.
   *   • Optional distinct knockback record, selected before its multiplier.
   *
   * Geometry is authored in the same coordinate system as `hitbox` —
   * `offsetX` mirrored by attacker facing, `offsetY` taken as-is. The
   * sweet-spot region MUST be a strict sub-region of `hitbox` (the
   * runtime tests `pointInSweetSpot && pointInHitbox`); a region
   * outside the parent hitbox simply never fires the bonus.
   *
   * Omitted on the vast majority of moves — only signature kill moves
   * tend to author one (Wolf bair, smash sweet-spots, etc.).
   */
  readonly sweetSpot?: {
    /** Optional distinct launch record, selected before the spot's multiplier.
     * Charge in damage-only mode leaves this record unchanged. */
    readonly knockback?: AttackMove['knockback'];
    readonly hitbox: {
      readonly offsetX: number;
      readonly offsetY: number;
      readonly width: number;
      readonly height: number;
    };
    readonly damageMultiplier?: number;
    readonly knockbackMultiplier?: number;
  };
}

/** Charge changes authored damage while preserving each source launch record. */
export function scaleAttackCollisionHitDamage(hits: readonly AttackCollisionHit[] | undefined, factor: number): readonly AttackCollisionHit[] | undefined {
  return hits?.map(hit => ({ ...hit, ...(hit.damage === undefined ? {} : { damage: hit.damage * factor }) }));
}

/**
 * Runtime instance state for an in-flight attack. Lives inside the
 * `Character` class — exposed read-only via `getActiveAttack()` for
 * tests, debug HUDs, and AI behaviour trees.
 */
export interface ActiveAttack {
  /** The static definition this instance was spawned from. */
  readonly move: AttackMove;
  /** Facing latched at attack start — hitbox geometry mirrors against this. */
  readonly facing: 1 | -1;
  /**
   * Phase of the attack:
   *   - 'startup'  : `framesElapsed < startupFrames` (no hitbox yet)
   *   - 'active'   : active envelope; hitWindows may contain harmless gaps
   *   - 'recovery' : hitbox is gone; fighter still committed
   */
  readonly phase: 'startup' | 'active' | 'recovery';
  /** Frames since attack press (0 on the press frame itself). */
  readonly framesElapsed: number;
  /**
   * Live hitbox body — present only during the 'active' phase. The
   * sensor body has `label === HITBOX_LABEL` and a `plugin.ownerId`
   * field carrying the attacker's character id so collision handlers
   * can suppress self-hits.
   */
  readonly hitboxBody: MatterJS.BodyType | null;
  /**
   * Frames the special button was HELD before this move was released, or
   * `null` for every non-charge move. Surfaced so the MatchScene
   * projectile spawner can scale a charge-beam shot (Samus cannon) by how
   * long it was charged. Latched once on the release frame, constant for
   * the whole active window.
   *
   * Optional on the public DTO so hand-built test doubles need not set it;
   * the real {@link Character.getActiveAttack} always populates it (to a
   * number for a charge release, `null` for every other move).
   */
  readonly chargeHeldFrames?: number | null;
}

/** Plugin metadata stamped on every hitbox body. Read by damage/KO handlers. */
export interface HitboxPlugin {
  readonly sourcePoseRequired?: boolean;
  readonly statusEffect?:'bury';
  /** Runtime move classification, independent of a fighter's current support. */
  readonly attackKind?: 'ground' | 'aerial';
  readonly tripChance?: number;
  readonly setoff?: 'on' | 'off' | 'through';
  /** Selected per-region repeat interval; a scene must inject its clock. */
  readonly rehitFrames?: number;
  readonly shieldDamage?: number;
  /** Native shield-push multiplier; independent of shield damage/stun. */
  readonly shieldSetoffMultiplier?: number;
  /** Original native packet metadata; omission remains unknown. */
  readonly nativeAttackHeight?:'low'|'high';
  readonly nativeAttackHeightSource?:import('./attackHeightMetadata').AttackHeightSourceReceipt;
  readonly nativeCollisionAttribute?: string;
  readonly nativeForceReaction?: boolean;
  /** Native ATTACK direct flag; omitted selects direct contact. */
  readonly direct?:boolean;
  readonly reflectable?:boolean;readonly absorbable?:boolean;
  readonly launchDirection?: 'forward' | 'back' | 'position';
  /** Stale queue identity when a diagnostic sensor ID names an individual rung. */
  readonly staleMoveId?: string;
  readonly collisionHits?: readonly AttackCollisionHit[];
  readonly hitlagMultiplier?: number;
  /** Source electric collision attribute; separate from authored hitbox hit-stop factor. */
  readonly electricCollision?: boolean;
  readonly sdiMultiplier?: number;
  readonly launchAwayFromSource?: boolean;
  readonly minHitstunFrames?: number;
  readonly airborneVelocityCarry?: boolean;
  /** Snapshot before collision callbacks can freeze the attacking fighter. */
  readonly attackerVelocity?: { readonly x: number; readonly y: number };
  /** Detached damage credits its owner without freezing/pushing that owner. */
  readonly projectile?: boolean;
  readonly groundedKnockback?: AttackMove['knockback'];
  /** Runtime identity shared across replacement sensors for one strike. */
  readonly hitGroup?: object;
  /** One move execution across all victims/strikes, used to snapshot staleness. */
  readonly attackInstance?: object;
  readonly hitWindowIndex?: number;
  readonly ownerId: string;
  /**
   * Numeric id of the attacker's Matter body. Used by the damage
   * handler's self-hit suppression so two instances of the same
   * character (e.g. Wolf P1 vs Wolf P2) can damage each other —
   * comparing `ownerId` alone would conflate "same instance" with
   * "same character kind" and silently swallow inter-mirror-match
   * damage. We store the integer id (not the body reference) so
   * Matter's deep-clone (`Common.extend`) doesn't recurse into the
   * attacker's body graph and stack-overflow at construction.
   */
  readonly ownerBodyId?: number;
  /** Opt-in body attachment: exact contact uses the live owner's origin
   * during world events; its sensor is also reanchored after integration. */
  readonly ownerAnchoredContact?: boolean;
  /** Runtime-only opt-in: contact is evaluated after stage collision resolution. */
  readonly postPhysicsContactOnly?: boolean;
  /** Runtime-only prior completed sample of an opted-in spherical contact.
   * A new strike has no prior sample; stretched capsules keep their shape. */
  readonly previousPointContact?: {
    readonly hitId: number;
    readonly position: { readonly x: number; readonly y: number };
    readonly radius: number;
  };
  readonly moveId: string;
  readonly damage: number;
  readonly knockback: AttackMove['knockback'];
  readonly facing: 1 | -1;
  /** Parent hitbox geometry, used to recover attacker origin from the sensor. */
  readonly hitbox?: AttackMove['hitbox'];
  /** Optional authored sweet-spot geometry and multipliers. */
  readonly sweetSpot?: AttackMove['sweetSpot'];
  /**
   * Optional discriminator that distinguishes a regular attack
   * hitbox from a grab range-sensor (post-M2 grab/throw subsystem).
   *
   *   • `undefined` / `'attack'` → standard attack: contact applies
   *     damage + knockback via `Character.applyHit`.
   *   • `'grab'` → grab range-sensor: contact transitions both
   *     fighters into a held/grabbing pair (no immediate damage).
   *     The damage / knockback fields are typically zero on a grab
   *     sensor — the throw release fires the damage later via the
   *     target's `applyHit` from inside the grabber's tick.
   *
   * The damage handler reads this tag to route contact events to
   * the right resolver. Optional for back-compat — every existing
   * attack hitbox is implicitly `'attack'`.
   */
  readonly kind?: 'attack' | 'grab';
  /**
   * Optional — `true` when this hitbox is UNBLOCKABLE (bypasses a raised
   * shield). Propagated into the dispatched {@link HitInfo} so command
   * grabs throw a shielding victim. Omitted on every normal hitbox.
   */
  readonly unblockable?: boolean;
}

/** Launch side of a hitbox's hit: behind for 'back', away from the attacker for
 * 'position' (or the legacy launchAwayFromSource), else the hitbox's facing.
 * `separationX` is the struck body's x minus the attacker's. */
export function hitLaunchFacing(plugin: Pick<HitboxPlugin, 'facing' | 'launchDirection' | 'launchAwayFromSource'>,
  separationX: number): 1 | -1 {
  if (plugin.launchDirection === 'back') return -plugin.facing as 1 | -1;
  const away = plugin.launchDirection === 'position' || (plugin.launchDirection === undefined && plugin.launchAwayFromSource);
  return away && separationX !== 0 ? (separationX > 0 ? 1 : -1) : plugin.facing;
}

// ---------------------------------------------------------------------------
// Hitbox body factory
// ---------------------------------------------------------------------------

/**
 * Spawn the Matter sensor body for an attack hitbox. Centralised here
 * (instead of inlined in `Character`) so subclasses, projectiles, and
 * tests all build hitboxes through the same code path:
 *
 *   • The body is a `isSensor: true` rectangle — it generates collision
 *     events but never pushes the target around. The damage / knockback
 *     handler is responsible for translating "your hitbox touched me"
 *     into actual physics impulses.
 *   • The collision filter is the canonical HITBOX/CHARACTER pair from
 *     `engine/collisionCategories`, so character bodies opt-in to being
 *     hit (`COLLISION_MASKS.CHARACTER` already includes `HITBOX`).
 *   • The body's `plugin` bag carries the attacker's character id, the
 *     move id, the damage value, and the knockback vector. This is the
 *     contract the (later AC) damage handler reads — no reverse lookup
 *     into per-character state needed.
 *   • `friction*` and `restitution` are zeroed so a bug that leaves a
 *     hitbox in the world for an extra step still doesn't impart any
 *     spurious physics, and `setInertia(Infinity)` keeps the body from
 *     rotating if a future change drops `isSensor`.
 */
export function spawnHitbox(
  scene: PhysicsHost,
  attacker: {
    id: string;
    position: { x: number; y: number };
    /**
     * Optional — Matter assigns each body a numeric `id`; when
     * present, the damage handler uses this for self-hit suppression
     * so mirror matches (Wolf P1 vs Wolf P2) deal damage instead of
     * being filtered out by character-id-equality. Pass the id as a
     * primitive (NOT the body reference) — the body holds back-
     * pointers into the world / parts / vertices and Matter's
     * `Common.extend` deep-clone would stack-overflow on it.
     */
    bodyId?: number;
  },
  move: AttackMove,
  facing: 1 | -1,
): MatterJS.BodyType {
  const geometry = attackSensorGeometry(move);
  const offsetX = geometry.offsetX * facing;
  const cx = attacker.position.x + offsetX;
  const cy = attacker.position.y + geometry.offsetY;

  const plugin: HitboxPlugin = {
    ...(move.statusEffect===undefined?{}:{statusEffect:move.statusEffect}),
    ownerId: attacker.id,
    ownerBodyId: attacker.bodyId,
    moveId: move.id,
    attackKind: move.type === 'aerial' ? 'aerial' : 'ground',
    damage: move.damage,
    shieldDamage: move.shieldDamage,
    shieldSetoffMultiplier: move.shieldSetoffMultiplier,
    direct: move.direct,
    nativeAttackHeight:move.nativeAttackHeight,nativeAttackHeightSource:move.nativeAttackHeightSource,
    nativeCollisionAttribute: move.nativeCollisionAttribute,
    nativeForceReaction: move.nativeForceReaction,
    launchDirection: move.launchDirection,
    knockback: move.knockback,
    reflectable:move.reflectable,absorbable:move.absorbable,
    ...(move.tripChance === undefined ? {} : { tripChance: move.tripChance }),
    ...(move.setoff === undefined ? {} : { setoff: move.setoff }),
    ...(move.hitlagMultiplier === undefined ? {} : { hitlagMultiplier: move.hitlagMultiplier }),
    ...(move.electricCollision === undefined ? {} : { electricCollision: move.electricCollision }),
    ...(move.sdiMultiplier === undefined ? {} : { sdiMultiplier: move.sdiMultiplier }),
    ...(move.launchAwayFromSource ? { launchAwayFromSource: true } : {}),
    ...(move.minHitstunFrames === undefined ? {} : { minHitstunFrames: move.minHitstunFrames }),
    ...(move.airborneVelocityCarry ? { airborneVelocityCarry: true } : {}),
    ...(move.groundedKnockback ? { groundedKnockback: move.groundedKnockback } : {}),
    facing,
    hitbox: geometry,
    ...(move.collisionHits ? { collisionHits: move.collisionHits } : {}),
    ...(move.sourcePoseRequired ? { sourcePoseRequired: true } : {}),
    ...(move.sweetSpot ? { sweetSpot: move.sweetSpot } : {}),
    // Carry the unblockable tag (command grabs) through to the damage
    // handler. Read defensively — only synthetic command-grab spawn-moves
    // set it; every authored AttackMove omits it.
    ...((move as { unblockable?: boolean }).unblockable
      ? { unblockable: true }
      : {}),
  };

  const body = scene.matter.add.rectangle(cx, cy, geometry.width, geometry.height, {
    label: HITBOX_LABEL,
    // Sensors are positioned by the attack timeline, including during hitlag.
    // Gravity otherwise drifts their position and inflates swept bounds.
    ignoreGravity: true,
    isSensor: true,
    isStatic: false,
    // Hitboxes are short-lived sensors. Mass needs to be non-zero to
    // satisfy Matter's solver, but the value is irrelevant — sensors
    // never participate in impulse resolution.
    mass: 0.0001,
    friction: 0,
    frictionAir: 0,
    frictionStatic: 0,
    restitution: 0,
    collisionFilter: { ...HITBOX_COLLISION_FILTER },
    plugin,
  });

  // Lock rotation so the sensor's AABB stays predictable across steps.
  scene.matter.body.setInertia(body, Infinity);
  return body;
}

/** Remove a previously spawned hitbox body from the world. Idempotent. */
export function despawnHitbox(scene: PhysicsHost, body: MatterJS.BodyType | null): void {
  if (!body) return;
  scene.matter?.world?.remove(body);
}

/**
 * Spawn a Matter sensor body for a GRAB range hitbox (post-M2 grab/
 * throw subsystem). Mirrors {@link spawnHitbox} structurally — the
 * sensor body is identical in collision filter, geometry placement,
 * and lifetime — but stamps `kind: 'grab'` on the plugin so the
 * damage handler routes contact events to the grab resolver instead
 * of the attack-damage path.
 *
 * Damage / knockback on a grab sensor are zero (the contact itself
 * does no damage; the throw release fires the launch via the
 * target's `applyHit` later). The sensor's `moveId` is the grab
 * spec's `id` so debug HUDs / replay logs can attribute the connect
 * to the right authored grab.
 *
 * Pure call into the scene's matter API + a pure plugin record —
 * deterministic given identical attacker positions and facing.
 */
export function spawnGrabHitbox(
  scene: PhysicsHost,
  attacker: { id: string; position: { x: number; y: number }; bodyId?: number },
  grab: {
    id: string;
    hitbox: { offsetX: number; offsetY: number; width: number; height: number };
    collisionHits?: readonly AttackCollisionHit[];
  },
  facing: 1 | -1,
): MatterJS.BodyType {
  const geometry = attackSensorGeometry(grab);
  const offsetX = geometry.offsetX * facing;
  const cx = attacker.position.x + offsetX;
  const cy = attacker.position.y + geometry.offsetY;

  const plugin: HitboxPlugin = {
    ownerId: attacker.id,
    ownerBodyId: attacker.bodyId,
    moveId: grab.id,
    damage: 0,
    knockback: { x: 0, y: 0, scaling: 0 },
    facing,
    kind: 'grab',
    ...(grab.collisionHits ? { hitbox: geometry, collisionHits: grab.collisionHits } : {}),
  };

  const body = scene.matter.add.rectangle(
    cx,
    cy,
    geometry.width,
    geometry.height,
    {
      label: HITBOX_LABEL,
      ignoreGravity: true,
      isSensor: true,
      isStatic: false,
      mass: 0.0001,
      friction: 0,
      frictionAir: 0,
      frictionStatic: 0,
      restitution: 0,
      collisionFilter: { ...HITBOX_COLLISION_FILTER },
      plugin,
    },
  );

  scene.matter.body.setInertia(body, Infinity);
  return body;
}

/**
 * Pure helper — compute the absolute world-space centre of an attack
 * hitbox given the attacker's current position, the move's authored
 * offset, and the latched `facing`. Mirrors the math
 * `spawnHitbox` performs internally so callers (the runtime
 * position-tracker, tests, debug overlays) can derive "where would the
 * sensor sit right now?" without going through Matter.
 *
 *   • The authored `offsetX` is positive-forward — i.e. authored as
 *     if the fighter were facing right. Multiplying by `facing` mirrors
 *     it to the opposite side when the fighter is facing left, and the
 *     same path produces the correct "behind the attacker" geometry for
 *     a back-aerial whose `ActiveAttack.facing` was inverted by the
 *     dispatch layer.
 *   • `offsetY` is mirror-invariant (vertical) — applied unchanged.
 *
 * Determinism: a pure arithmetic function. Identical inputs always
 * return identical centres; no `Math.random()`, no wall-clock reads.
 */
export function computeHitboxCenter(
  attackerPosition: { readonly x: number; readonly y: number },
  move: AttackMove,
  facing: 1 | -1,
): { x: number; y: number } {
  const geometry = attackSensorGeometry(move);
  return {
    x: attackerPosition.x + geometry.offsetX * facing,
    y: attackerPosition.y + geometry.offsetY,
  };
}

/** Broadphase bounds follow the complete selected record set, including tips. */
export function attackSensorGeometry(move: Pick<AttackMove, 'hitbox' | 'collisionHits'>): AttackMove['hitbox'] {
  if (!move.collisionHits?.length) return move.hitbox;
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const { capsule: { start, end, radius } } of move.collisionHits) {
    left = Math.min(left, start.x - radius, end.x - radius);
    right = Math.max(right, start.x + radius, end.x + radius);
    top = Math.min(top, start.y - radius, end.y - radius);
    bottom = Math.max(bottom, start.y + radius, end.y + radius);
  }
  return { offsetX: (left + right) / 2, offsetY: (top + bottom) / 2,
    width: right - left, height: bottom - top };
}

/**
 * AC 60103 Sub-AC 3 — re-parent an active hitbox sensor to the
 * attacker's *current* world-space position with the same facing-mirrored
 * offset that {@link spawnHitbox} applied at spawn time. Used by the
 * per-frame aerial hitbox tracker in `Character.tickAttack` so a sensor
 * spawned during the active phase of an aerial move carries with the
 * fighter as he drifts through the air, instead of staying anchored to
 * the body's position on the spawn frame.
 *
 * Why this matters specifically for aerials: a grounded fighter swinging
 * a jab is largely stationary during the active window — the original
 * spawn-time anchor reads as "rooted-stance reach" and feels right. An
 * airborne fighter, by contrast, can drift several body-lengths during
 * a 4-frame active window (especially during a falling fair or a
 * jumping nair into a launching opponent), and a static hitbox simply
 * misses targets that the fighter visibly swings through.
 *
 *   • No-op when `body` is `null` — keeps the call site free of
 *     `if (a.hitboxBody)` guards in the hot path.
 *   • Idempotent for sensors already at the right position — Matter's
 *     `setPosition` short-circuits internally when the position
 *     doesn't change, so calling this every step costs us roughly a
 *     vector compare in the no-motion case.
 *
 * Determinism: a pure projection of the attacker's body position +
 * authored move data onto the sensor's transform. Two replays driving
 * identical character physics produce identical hitbox positions every
 * frame.
 */
export function updateHitboxPosition(
  scene: PhysicsHost,
  body: MatterJS.BodyType | null,
  attackerPosition: { readonly x: number; readonly y: number },
  move: AttackMove,
  facing: 1 | -1,
): void {
  if (!body) return;
  const center = computeHitboxCenter(attackerPosition, move, facing);
  scene.matter.body.setPosition(body, center);
}
