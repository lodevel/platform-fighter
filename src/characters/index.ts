/**
 * Character roster module.
 *
 * Hosts the base `Character` class (Sub-AC 1 of AC 201) — Matter.js
 * body wrapper with movement, jump physics, and ground detection —
 * the attack/hitbox primitives (AC 202 Sub-AC 2), and the concrete
 * fighters (Link, Donkey Kong, Pikachu).
 */

// Base class & input shape
export {
  Character,
  CHARACTER_LABEL,
  DEFAULT_CHARACTER_TUNING,
  OFFENSIVE_ACTION_BUFFER_FRAMES,
  JUMPSQUAT_FRAMES,
  JUMP_INPUT_BUFFER_FRAMES,
} from './Character';
export type {
  CharacterOptions,
  CharacterTuning,
  CharacterInput,
  CharacterHitApplication,
  CharacterHitOutcome,
} from './Character';

// Attack / hitbox primitives
export {
  HITBOX_LABEL,
  HITBOX_COLLISION_FILTER,
  spawnHitbox,
  despawnHitbox,
} from './attacks';
export type {
  AttackMove,
  ActiveAttack,
  HitboxPlugin,
} from './attacks';

// Combat math (Sub-AC 4.1 of AC 301)
export {
  MAX_DAMAGE_PERCENT,
  BASELINE_MASS,
  HITSTUN_FRAMES_PER_KNOCKBACK_UNIT,
  LAUNCH_SPEED_DECAY_PER_FRAME,
  MIN_HITSTUN_FRAMES,
  MAX_HITSTUN_FRAMES,
  accumulateDamage,
  computeKnockback,
  computeHitstun,
  decayLaunchVelocity,
} from './combat';
export type { HitInfo, KnockbackResult } from './combat';

// Grounded normal-move input dispatcher (AC 60101 Sub-AC 1). Pure helper
// that maps a per-frame attack-input snapshot (`attack` / `attackHeavy`
// rising edges + stick deflection + previous-frame stick) onto a
// registered move id from the fighter's slot table. Implements the
// canonical Smash idiom: jab on neutral attack, tilt on directional
// tap, smash on dedicated heavy press OR stick-flick + attack.
export {
  classifyGroundedAttack,
  isSmashFlick,
  isStickHeld,
  DEFAULT_NEUTRAL_THRESHOLD,
  DEFAULT_SMASH_FLICK_THRESHOLD,
  DEFAULT_FLICK_REST_THRESHOLD,
} from './groundedAttackInput';
export type {
  GroundedAttackPattern,
  GroundedAttackInputSnapshot,
  GroundedAttackSlots,
  GroundedAttackTuning,
  GroundedAttackDispatch,
} from './groundedAttackInput';

// Aerial-specific schema (Sub-AC 1 of AC 60101). Adds landing-lag and
// auto-cancel-window concepts on top of `AttackMoveWithAnimation`,
// plus pure helpers (knockback launch-angle, auto-cancel predicates,
// validation) that consume the `AerialMove` shape.
export {
  validateAutoCancelWindow,
  validateAerialMove,
  isAutoCancelFrame,
  getLandingLagFrames,
  // AC 60204 Sub-AC 4 — auto-cancel-window phase classification.
  getAutoCancelWindowPhase,
  getAutoCancelWindowsByPhase,
  getKnockbackLaunchAngleRadians,
  getKnockbackLaunchAngleDegrees,
} from './aerialSchema';
export type {
  AerialDirection,
  AutoCancelWindow,
  AutoCancelPhase,
  AerialMove,
} from './aerialSchema';

// Airborne aerial-move input dispatcher (AC 60201 Sub-AC 1). Pure helper
// that gates aerial attacks behind an airborne (in-air) check, drops
// heavy presses while aloft, classifies the player's stick deflection
// relative to facing into one of three canonical aerial directions
// (neutral / forward / back), and resolves the active move id through
// a cascading slot-fallback so partial movesets keep firing.
export {
  classifyAerialAttack,
  classifyAerialDirection,
  isStickNeutral,
  AERIAL_STICK_THRESHOLD,
} from './aerialAttackInput';
export type {
  AerialAttackInputSnapshot,
  AerialAttackSlots,
  AerialAttackTuning,
  AerialAttackDispatch,
} from './aerialAttackInput';

// Generalized charge schema. Originally lived inside specialSchema.ts as
// `NeutralSpecialChargeSpec`; extracted post-M2 so chargeable lights /
// smashes / any other move can opt into the same interpolation math.
export {
  computeChargeTFromSpec,
  computeChargedDamageFromSpec,
  computeChargedKnockbackFromSpec,
  validateChargeSpec,
} from './chargeSchema';
export type { ChargeSpec } from './chargeSchema';

// Neutral-special schema (AC 60201 Sub-AC 1). Adds the four mechanic
// kinds (projectile, charge, commandGrab, counter) on top of
// `AttackMoveWithAnimation` plus pure helpers (charge interpolation,
// counter predicate / damage clamp, validation) that consume the
// `NeutralSpecialMove` discriminated union.
export {
  isNeutralSpecialMove,
  isProjectileSpecial,
  isChargeSpecial,
  isCommandGrabSpecial,
  isCounterSpecial,
  isSummonSpecial,
  computeChargeT,
  computeChargedDamage,
  computeChargedKnockback,
  isInCounterWindow,
  computeCounterDamage,
  validateNeutralSpecialMove,
} from './specialSchema';
export type {
  NeutralSpecialKind,
  NeutralSpecialProjectileSpec,
  NeutralSpecialChargeSpec,
  NeutralSpecialCommandGrabSpec,
  NeutralSpecialCounterSpec,
  NeutralSpecialSummonSpec,
  NeutralSpecialMove,
  ProjectileSpecialMove,
  ChargeSpecialMove,
  CommandGrabSpecialMove,
  CounterSpecialMove,
  SummonSpecialMove,
} from './specialSchema';

// Side-special schema (AC 60101 Sub-AC 1). Adds four mechanic kinds
// (dashStrike, multiHit, reflector, commandDash) on top of
// `AttackMoveWithAnimation` plus pure helpers (dash velocity, multi-hit
// frame helpers, reflected damage / velocity, validation) that consume
// the `SideSpecialMove` discriminated union.
export {
  isSideSpecialMove,
  isDashStrikeSideSpecial,
  isMultiHitSideSpecial,
  isReflectorSideSpecial,
  isCommandDashSideSpecial,
  computeDashVelocity,
  computeSideMultiHitFrames,
  isSideMultiHitFrame,
  getSideMultiHitIndex,
  computeReflectedDamage,
  computeReflectedVelocity,
  validateSideSpecialMove,
} from './sideSpecialSchema';
export type {
  SideSpecialKind,
  SideSpecialDashStrikeSpec,
  SideSpecialMultiHitSpec,
  SideSpecialReflectorSpec,
  SideSpecialCommandDashSpec,
  SideSpecialMove,
  DashStrikeSideSpecialMove,
  MultiHitSideSpecialMove,
  ReflectorSideSpecialMove,
  CommandDashSideSpecialMove,
} from './sideSpecialSchema';

// Special move framework (AC 60101 Sub-AC 1). Cross-direction routing
// glue: input detection (neutral/side/up classifier), per-direction
// cooldown tracking, per-character config bundle, and resolvers that
// gate presses by cooldown.
export {
  SPECIAL_DIRECTIONS,
  SPECIAL_STICK_THRESHOLD,
  detectSpecialDirection,
  createSpecialCooldownState,
  tickSpecialCooldowns,
  startSpecialCooldown,
  isSpecialReady,
  getSpecialCooldownRemaining,
  resetSpecialCooldowns,
  resolveSpecialMove,
  resolveSpecialFromInput,
  listSpecialMoves,
  listSpecialMoveEntries,
} from './specialFramework';
export type {
  SpecialDirection,
  SpecialInputSnapshot,
  SpecialCooldownState,
  CharacterSpecialConfig,
  SpecialMove,
  SpecialResolution,
} from './specialFramework';

// Down-special schema (AC 60304 Sub-AC 4). Adds four mechanic kinds
// (groundPound, trap, stallAndFall, counter) on top of
// `AttackMoveWithAnimation` plus pure helpers (phase predicates, trap
// life-stage predicates, counter window / damage-clamp helpers,
// validation) that consume the `DownSpecialMove` discriminated union.
// Mirrors `specialSchema.ts` / `sideSpecialSchema.ts` /
// `upSpecialSchema.ts` for the fourth and final special direction.
export {
  isDownSpecialMove,
  isGroundPoundDownSpecial,
  isTrapDownSpecial,
  isStallAndFallDownSpecial,
  isCounterDownSpecial,
  isInGroundPoundHopPhase,
  isInGroundPoundSlamPhase,
  isInStallAndFallStallPhase,
  isInStallAndFallFallPhase,
  isTrapArmed,
  isTrapExpired,
  isInDownCounterWindow,
  computeDownCounterDamage,
  validateDownSpecialMove,
} from './downSpecialSchema';
export type {
  DownSpecialKind,
  DownSpecialGroundPoundSpec,
  DownSpecialTrapSpec,
  DownSpecialStallAndFallSpec,
  DownSpecialCounterSpec,
  DownSpecialMove,
  GroundPoundDownSpecialMove,
  TrapDownSpecialMove,
  StallAndFallDownSpecialMove,
  CounterDownSpecialMove,
} from './downSpecialSchema';

// Up-special schema (AC 60202 Sub-AC 2). Adds four recovery-move
// mechanic kinds (multiHitRising, teleport, directionalJump, tether)
// on top of `AttackMoveWithAnimation` plus pure helpers (8-direction
// snap, multi-hit ladder helpers, teleport / burst window predicates,
// tether tip-position math, validation) that consume the
// `UpSpecialMove` discriminated union.
export {
  isUpSpecialMove,
  isMultiHitRisingUpSpecial,
  isTeleportUpSpecial,
  isDirectionalJumpUpSpecial,
  isTetherUpSpecial,
  snapStickToOctant,
  computeMultiHitFrames,
  isMultiHitFrame,
  isFinalLauncherFrame,
  computeTeleportDestination,
  isInTeleportInvincibilityWindow,
  computeBurstVelocity,
  isInBurstWindow,
  computeTetherTipPosition,
  isTetherFullyExtended,
  validateUpSpecialMove,
} from './upSpecialSchema';
export type {
  UpSpecialKind,
  UpSpecialMultiHitRisingSpec,
  UpSpecialSustainedRiseSpec,
  UpSpecialTeleportSpec,
  UpSpecialDirectionalJumpSpec,
  UpSpecialTetherSpec,
  UpSpecialMove,
  MultiHitRisingUpSpecialMove,
  TeleportUpSpecialMove,
  DirectionalJumpUpSpecialMove,
  TetherUpSpecialMove,
  OctantDirection,
} from './upSpecialSchema';

// Uniform 10-slot moveset contract — Sub-AC 1 of AC 1 (T2 refactor).
// Phaser-/Matter-free interface declaring the canonical slot names
// (jab, tilt, smash, fair, shield, dodge, neutralSpecial, sideSpecial,
// upSpecial, downSpecial), per-slot value shapes, the per-fighter
// movement profile, and the runtime assertions that lock the contract
// uniform across the cast.
export {
  ATTACK_MOVESET_SLOT_NAMES,
  DEFENSIVE_MOVESET_SLOT_NAMES,
  EXTENDED_ATTACK_MOVESET_SLOT_COUNT,
  EXTENDED_ATTACK_MOVESET_SLOT_NAMES,
  MOVESET_SLOT_NAMES,
  MOVESET_SLOT_COUNT,
  assertAttackSlotCount,
  assertDefensiveSlotCount,
  assertFighterMoveset,
  assertMovesetSlotCount,
  forEachMovesetSlot,
  getMovesetSlot,
  getMovesetSlotCategory,
  isAttackMovesetSlot,
  isDefensiveMovesetSlot,
  isMovesetSlotName,
  listAttackMoves,
} from './movesetContract';
export type {
  AttackMovesetSlotName,
  AttackMovesetSlotValue,
  DefensiveMovesetSlotName,
  DefensiveMovesetSlotValue,
  ExtendedAttackMovesetSlotName,
  ExtendedAttackMovesetSlotValue,
  FighterContract,
  FighterMoveset,
  FighterMovementProfile,
  MovesetSlotCategory,
  MovesetSlotName,
} from './movesetContract';

// Shared move-data schema & base attack state machine (Sub-AC 1 of AC 60001).
// Pure-data primitives + pure-function attack state machine — no Phaser, no
// Matter — usable by AI predictors, the (M-future) animator, the balance
// pass tooling, and unit tests with no scene fixtures.
export {
  makeBodyHurtbox,
  hitboxOverlapsHurtbox,
  computeAttackPhase,
  selectAnimationFrame,
  advanceAttackState,
  composeAttackStateHooks,
  getMoveBusyFrames,
  getMoveLockoutFrames,
  knockbackToAngleMagnitude,
  angleMagnitudeToKnockback,
  getFrameData,
  getFrameDataBusy,
  getFrameDataLockout,
} from './moveSchema';
export type {
  Hitbox,
  Hurtbox,
  KnockbackSpec,
  KnockbackAngleMagnitude,
  FrameData,
  AttackPhase,
  LiveAttackPhase,
  AnimationFrameSelector,
  MoveAnimation,
  AttackMoveWithAnimation,
  MoveHurtboxModifier,
  AttackStateHooks,
  AttackStateContext,
  AttackStateStep,
} from './moveSchema';

// Character factory — AC 10005 Sub-AC 5. Phaser-free dispatcher that
// turns a `CharacterId` (from `MatchConfig.players[].characterId`) into
// the correctly-typed concrete subclass.
// Centralises the switch so both `MatchScene` (via the
// CharacterSelect → MatchScene wiring) and `Fighter` (per-player runtime
// entity) read one source of truth. Each instantiated character carries
// its full authored moveset by virtue of its subclass constructor's
// `registerAttack` calls.
export {
  applyCharacterMoveOverrides,
  createCharacterById,
  resolveSlotCharacterId,
} from './characterFactory';
export type { CreateCharacterOptions } from './characterFactory';

// Fighter registry — Sub-AC 3 of the T2 per-fighter refactor track.
// Single source of truth mapping `CharacterId` onto its concrete
// per-fighter subclass + frozen {@link FighterContract}. Both
// `createCharacterById` (the canonical match-runtime dispatcher) and
// `Fighter.defaultCharacterFactory` (the per-player entity wrapper)
// delegate dispatch through this module so a 5th roster slot only
// requires authoring its subclass + appending one entry here. Consumers
// that need read-only access to the per-fighter declaration data
// (FighterContract / moveset / movement profile) without a Phaser
// scene use `getFighterContract(id)`.
export {
  FIGHTER_REGISTRY,
  FIGHTER_REGISTRY_ENTRIES,
  FIGHTER_REGISTRY_IDS,
  getFighterConstructor,
  getFighterContract,
  getFighterRegistryEntry,
  instantiateFighter,
  isRegisteredFighterId,
} from './fighterRegistry';
export type {
  FighterConstructor,
  FighterRegistryConstructionOptions,
  FighterRegistryEntry,
} from './fighterRegistry';

// Concrete fighters: Link, Donkey Kong, Pikachu.
export {
  Link,
  LINK_TUNING,
  LINK_JAB,
  LINK_TILT,
  LINK_SMASH,
  LINK_NAIR,
  LINK_FAIR,
  LINK_BAIR,
  LINK_NEUTRAL_SPECIAL,
  LINK_SIDE_SPECIAL,
  LINK_UP_SPECIAL,
  LINK_DOWN_SPECIAL,
  LINK_GRAB,
  // Frozen per-fighter declarations.
  LINK_MOVESET,
  LINK_MOVEMENT_PROFILE,
  LINK_FIGHTER_CONTRACT,
} from './Link';
export type { LinkOptions } from './Link';
// Donkeykong (id 'donkeykong') — the class is `DonkeyKong` (camel-cased
// for readability); the id-derived display name is "Donkeykong".
export {
  DonkeyKong,
  DONKEYKONG_TUNING,
  DONKEYKONG_JAB,
  DONKEYKONG_TILT,
  DONKEYKONG_SMASH,
  DONKEYKONG_NAIR,
  DONKEYKONG_FAIR,
  DONKEYKONG_BAIR,
  DONKEYKONG_NEUTRAL_SPECIAL,
  DONKEYKONG_SIDE_SPECIAL,
  DONKEYKONG_UP_SPECIAL,
  DONKEYKONG_DOWN_SPECIAL,
  DONKEYKONG_GRAB,
  // Frozen per-fighter declarations.
  DONKEYKONG_MOVESET,
  DONKEYKONG_MOVEMENT_PROFILE,
  DONKEYKONG_FIGHTER_CONTRACT,
} from './DonkeyKong';
export type { DonkeyKongOptions } from './DonkeyKong';

// Roster — Sub-AC 3.5 of AC 205. Aggregates stats + moves + placeholder
// per character so the Fighter entity (and HUD / menu / replay layers)
// have one lookup for "what does character X look and fight like?".
export {
  CHARACTER_ROSTER,
  CHARACTER_SPECS_IN_ROSTER_ORDER,
  PLAYABLE_CHARACTER_SPECS,
  LINK_SPEC,
  DONKEYKONG_SPEC,
  LINK_MOVES,
  DONKEYKONG_MOVES,
  LINK_PLACEHOLDER,
  DONKEYKONG_PLACEHOLDER,
  getCharacterSpec,
  findMoveByType,
} from './roster';
export type { CharacterSpec, CharacterPlaceholderVisual } from './roster';

// Palette swap colour data — Sub-AC 2 of AC 13. Per-character ladders
// of 8 alternate colour sets so up to 4 players picking the same
// fighter can be visually differentiated by paletteIndex.
export {
  CHARACTER_PALETTES,
  PALETTES_PER_CHARACTER,
  LINK_PALETTES,
  DONKEYKONG_PALETTES,
  applyPaletteToPlaceholder,
  getCharacterPalette,
  getCharacterPalettes,
} from './palettes';
export type { CharacterPalette } from './palettes';

// Runtime palette swap rendering — Sub-AC 3 of AC 13. Computes the
// `(primary, accent, label)` colour triple for a player slot and
// paints it onto the live Phaser visuals (rectangle / triangle /
// sprite) so the assigned palette index is what the player sees.
export {
  applyPaletteSwap,
  resolvePaletteSwap,
  paletteSwapForSlot,
  paletteSwapForCharacter,
  paletteSwapEqual,
  paletteColorToCss,
  DEFAULT_PALETTE_STROKE_WIDTH,
} from './PaletteSwapRenderer';
export type {
  PaletteSwap,
  PaletteSwapTarget,
  FighterPaletteTargets,
  ApplyPaletteSwapOptions,
} from './PaletteSwapRenderer';

// Runtime palette-swap renderer — AC 20302 Sub-AC 2. Single runtime
// façade that paints rectangle (preview / placeholder) AND sprite
// (in-game atlas) targets in one call, lazy-installs the WebGL
// pipeline, falls back to tint when WebGL is unavailable, and
// memoises per-key so the steady-state per-frame cost is one
// `paletteSwapEqual` compare. Composes the rectangle pipeline from
// `PaletteSwapRenderer.ts` with the shader pipeline from
// `paletteSwapShader.ts` so scenes consume one entry-point regardless
// of which underlying path the visuals require.
export {
  RuntimePaletteRenderer,
  configureDefaultRuntimePaletteRenderer,
  getDefaultRuntimePaletteRenderer,
  paintFighterPalette,
  resetDefaultRuntimePaletteRenderer,
  asPaletteSwapTarget,
} from './runtimePaletteRenderer';
export type {
  RuntimePaletteCacheKey,
  RuntimePaletteGame,
  RuntimePaletteOpsCount,
  RuntimePaletteOptions,
  RuntimePalettePipelineFactory,
  RuntimePaletteResult,
  RuntimePaletteTargets,
} from './runtimePaletteRenderer';

// Palette swap shader / tint module — Sub-AC 1 of AC 10301. Per-
// character color remapping primitives (pure pixel remap helpers,
// per-character source palette tables, GLSL fragment shader source
// generator, Phaser WebGL pipeline factory + per-sprite installer
// with canvas-renderer tint fallback). Composes with `PaletteSwapRenderer`
// for the M-future sprite-atlas pipeline.
export {
  PALETTE_SLOT_ORDER,
  PALETTE_SWAP_PIPELINE_KEY,
  PALETTE_SWAP_UNIFORM_SOURCE,
  PALETTE_SWAP_UNIFORM_TARGET,
  PALETTE_SWAP_UNIFORM_TOLERANCE,
  PALETTE_SWAP_UNIFORM_COUNT,
  applyPaletteSwapPipeline,
  applyPaletteSwapTintFallback,
  applyPaletteSwapToSprite,
  buildPaletteRemap,
  buildPaletteRemapForSlot,
  buildPipelineUniforms,
  colorToVec3,
  colorWithinTolerance,
  createPaletteSwapShaderSource,
  getCharacterSourcePalette,
  installPaletteSwapPipeline,
  paletteRemapEqual,
  remapImageData,
  remapImageDataInPlace,
  remapPixel,
  vec3ToColor,
} from './paletteSwapShader';
export type {
  CharacterSourcePalette,
  PaletteShaderGame,
  PaletteShaderPipelineManager,
  PaletteShaderRendererSurface,
  PaletteShaderTarget,
  PaletteShaderUniforms,
  PaletteSlot,
  PaletteSwapRemap,
} from './paletteSwapShader';

// Grounded-normal animation + hitbox driver — AC 60102 Sub-AC 2.
// Consolidates the per-roster grounded triplet (jab / tilt / smash) +
// pure helpers that drive sprite animation states and predict frame-
// accurate hitbox spawn windows + sensor geometry. Lets tests / AI
// predictors / replay tooling read one source of truth instead of
// importing the per-character constants directly.
export {
  GROUNDED_NORMAL_SLOTS,
  GROUNDED_NORMAL_TABLE,
  GROUNDED_NORMAL_MOVES,
  GROUNDED_NORMAL_LIFECYCLE_RULES,
  getGroundedNormal,
  describeHitboxLifecycle,
  isHitboxActiveAt,
  computeGroundedNormalHitboxCenter,
  describeHitboxAtFrame,
  buildGroundedNormalHitboxPlugin,
  resolveGroundedNormalAnimationKey,
  resolveGroundedNormalAnimationState,
  enumerateGroundedNormalAnimationStates,
} from './groundedNormalDriver';
export type {
  GroundedNormalSlot,
  GroundedNormalEntry,
  GroundedNormalHitboxSnapshot,
  GroundedNormalHitboxLifecycle,
} from './groundedNormalDriver';

// Animation state integration — AC 60003 Sub-AC 3. Single source of
// truth for the `(characterId × move × phase × artFrameIndex) →
// animation key` mapping the renderer reads each frame, plus the
// cancel-rule registry tests lock down. Pure (Phaser-/Matter-free) so
// the renderer, the AI predictor, and the replay-snapshot system all
// share one deterministic key generator.
export {
  IDLE_ANIMATION_SUFFIX,
  LIVE_ATTACK_PHASES,
  ANIMATION_CANCEL_RULES,
  getMovePartId,
  getAnimationKey,
  getIdleAnimationKey,
  enumerateMoveAnimationKeys,
  resolveAttackAnimation,
  getCurrentAnimation,
  getPostCancelAnimation,
  makeAnimationStateHooks,
  describeAnimationCancelRules,
  adaptCharacter,
} from './animationState';
export type {
  AnimationState,
  AnimatableCharacter,
  AnimationStateSubscriber,
  AnimationCancelRule,
} from './animationState';

// Full-moveset animation driver — AC 10003 Sub-AC 3. Single character-
// aware integration layer that ties together the animation-key contract
// for every move in every fighter's full 10-move moveset
// (jab/tilt/smash + 3 aerials + 4 specials). Mirrors the
// `groundedNormalDriver` shape but extended across the whole moveset.
export {
  AERIAL_SLOTS,
  MOVESET_ENTRIES,
  MOVESET_LIFECYCLE_RULES,
  MOVESET_SLOTS,
  MOVESET_TABLE,
  SPECIAL_SLOTS,
  enumerateAllMovesetAnimationKeys,
  enumerateMovesetSlotAnimationKeys,
  enumerateMovesetSlotAnimationStates,
  findMovesetSlot,
  getMovesetMove,
  resolveMovesetAnimationKey,
  resolveMovesetAnimationState,
} from './movesetAnimationDriver';
export type {
  AerialSlot,
  CharacterMoveset,
  MovesetEntry,
  MovesetSlot,
  SpecialSlot,
} from './movesetAnimationDriver';

// Integrated moveset animation cue catalog — AC 20004 Sub-AC 4.
// Single source of truth for `(idle, movement, per-move animation cues)`
// across all 4 roster characters. Composes the symbolic per-move keys
// (`movesetAnimationDriver`) with the high-level sprite anim keys
// (`spriteAnimationDriver`) into one frozen catalog the renderer / asset
// pipeline / debug HUD / replay scrubber consume directly.
export {
  CHARACTER_MOVESET_ANIMATION_CUES,
  MOVESET_ANIMATION_CUE_BUNDLES,
  enumerateAllMovesetAnimationCueKeys,
  getCharacterMovesetAnimationCues,
  getMoveAnimationCueAt,
  getMoveAnimationCueBundle,
} from './movesetAnimationCues';
export type {
  CharacterMovesetAnimationCues,
  MoveAnimationCue,
  MoveAnimationCueBundle,
  MovementAnimationKeys,
} from './movesetAnimationCues';

// Defensive-state animation registry — AC 10003 Sub-AC 3. Animation-key
// generators for shield / dodge / edge-grab states with state-machine
// integration. Same `{characterId}.{partId}.{phase}.{frame}` key shape
// as attack moves; pure projection over the live state records.
export {
  DODGE_ANIMATION_FRAMES,
  DODGE_PART_ID,
  HURT_PART_ID,
  LEDGE_ANIMATION_FRAMES,
  LEDGE_PART_ID,
  SHIELD_ANIMATION_FRAMES,
  SHIELD_PART_ID,
  computeDodgeFramesInPhase,
  dodgeStateToAnimationPhase,
  enumerateAllDefensiveAnimationKeys,
  enumerateDefensiveAnimationKeys,
  getDodgeAnimationKey,
  getHurtAnimationKey,
  getLedgeAnimationKey,
  getShieldAnimationKey,
  ledgeStateToAnimationPhase,
  resolveDodgeAnimation,
  resolveLedgeAnimation,
  resolveShieldAnimation,
  selectDodgeArtFrame,
  selectLedgeArtFrame,
  selectShieldArtFrame,
  shieldStateToAnimationPhase,
} from './defensiveAnimationState';
export type {
  DefensiveAnimationState,
  DodgeAnimationPhase,
  LedgeAnimationPhase,
  ShieldAnimationPhase,
} from './defensiveAnimationState';

// Top-level fighter-animation state composer — AC 10003 Sub-AC 3.
// Composes the four animation sources (hurt / shield-break / ledge /
// dodge / shield / attack / idle) into a single resolved key per
// fixed step using the canonical precedence order. Plus a small
// state-machine binding that fires a listener only on actual key
// changes for renderer / debug HUD consumers.
export {
  attackStateToFighter,
  createFighterAnimationStateMachine,
  idleState,
  resolveFighterAnimationState,
} from './fighterAnimationState';
export type {
  FighterAnimationKeyChangeListener,
  FighterAnimationLayer,
  FighterAnimationSnapshot,
  FighterAnimationState,
  FighterAnimationStateMachine,
  FighterSnapshotProvider,
} from './fighterAnimationState';

// Sprite animation driver — Sub-AC 2 of AC 10402. Hooks the existing
// fighter state machine (movement + combat) onto the loaded character
// spritesheets so each high-level state — `idle` / `run` / `jump` /
// `fall` / `attack` / `hurt` — triggers the correct Phaser sprite
// animation sequence at runtime.
export {
  RUN_INPUT_DEAD_ZONE,
  RUN_VELOCITY_DEAD_ZONE,
  SPRITE_ANIMATION_STATES,
  SPRITE_ANIM_SPECS,
  MOVE_SHEET_SPECS,
  MOVE_SHEET_NAMES,
  attackMoveToSheet,
  attackMoveToSheets,
  getCharacterMoveSheetKey,
  getMoveAnimKey,
  classifySpriteAnimationState,
  collapseStateToSheet,
  createSpriteAnimationStateMachine,
  getCharacterSpritesheetKey,
  getSpriteAnimationKey,
  registerAllCharacterSpriteAnimations,
  registerCharacterSpriteAnimations,
} from './spriteAnimationDriver';
export type {
  PlayableSprite,
  SceneAnimSurface,
  SpriteAnimationSnapshot,
  SpriteAnimationSnapshotProvider,
  SpriteAnimationState,
  SpriteAnimationStateMachine,
} from './spriteAnimationDriver';

// Hurt-state classifier — AC 8 "Hitstun locks hit player in hurt state
// briefly". Pure helpers that turn the underlying `Character` /
// `Fighter`'s hitstun timer into a discrete, observable status name
// (`'neutral' | 'hurt'`) for HUD / AI / replay consumers. The lockout
// itself is enforced at the `Character.applyInput` layer; these helpers
// just classify the snapshot.
export {
  deriveHurtState,
  deriveHurtStateFromFighterSnapshot,
  isInHurtState,
} from './hurtState';
export type {
  HurtStateName,
  HurtStateInfo,
  HurtStateSnapshotInput,
} from './hurtState';

// Ledge / edge-grab geometry detection — AC 60403 Sub-AC 3. Pure
// helpers for "is this fighter overlapping a grabbable ledge corner?"
// (ledge collision sensors). Composed with `ledgeHangState.ts` (the
// ledge-hang state machine) inside the `Character` class for the full
// edge-grab feature.
export {
  detectLedgeGrab,
  isEligibleForLedgeGrab,
  isWithinLedgeRadius,
  ledgeCandidatesEqual,
  ledgeCandidatesFromPlatform,
  LEDGE_DETECTION_DEFAULTS,
} from './ledgeDetection';
export type {
  FighterBounds,
  LedgeCandidate,
  LedgeDetectionTuning,
  LedgeGrabDetection,
  LedgeSide,
} from './ledgeDetection';

// Ledge-hang state machine — AC 60403 Sub-AC 3. Pure deterministic
// state machine for the edge-grab → hang → release / get-up / climb-up
// → tether (re-grab cooldown) cycle. Composed with `ledgeDetection.ts`
// inside `Character.ts`.
export {
  createLedgeHangState,
  isClimbingFromLedge,
  isHangingOnLedge,
  isLedgeHangInvincible,
  isLedgeLockingInput,
  isLedgeRolling,
  isLedgeTetherCooldown,
  LEDGE_HANG_DEFAULTS,
  resetLedgeHangState,
  resolveLedgeHangTuning,
  tickLedgeHang,
} from './ledgeHangState';
export type {
  ActiveLedgeHang,
  LedgeHangInput,
  LedgeHangState,
  LedgeHangStateName,
  LedgeHangTickResult,
  LedgeHangTuning,
  LedgeReleaseAction,
  ResolvedLedgeHangTuning,
} from './ledgeHangState';

// Multi-fighter edge-grab conflict mediator — AC 15 "Edge-grab conflict
// resolved by first-come-first-served or push-off rule". Pure
// deterministic resolver that runs once per fixed step, after the
// per-fighter detection pass and before each per-fighter
// `tickLedgeHang` call. Decides which fighter actually latches onto a
// contested ledge corner this tick and (under the push-off rule) which
// existing occupant gets punched off.
export {
  DEFAULT_LEDGE_CONFLICT_RULE,
  buildLedgeId,
  buildLedgeOccupancy,
  compareLedgeRequests,
  isForceReleasedForPlayer,
  isGrantedForPlayer,
  ledgeOccupantFromHangState,
  parseLedgeId,
  resolveLedgeConflicts,
} from './ledgeConflictResolver';
export type {
  LedgeConflictResolution,
  LedgeConflictRule,
  LedgeForceRelease,
  LedgeGrabGrant,
  LedgeGrabRejection,
  LedgeGrabRequest,
  LedgeId,
  LedgeOccupant,
  LedgeRejectionReason,
} from './ledgeConflictResolver';

// Shield state machine — AC 60301 Sub-AC 1 "Shield mechanic with shield
// health, regeneration, and shield-break stun state". Pure helpers
// (`tickShield`, `applyShieldHit`, ...) plus the canonical default
// tuning. The `Character` class wires these into the per-fixed-step
// tick; tests, AI, and the replay layer use them directly without
// owning a Phaser scene.
export {
  SHIELD_DEFAULTS,
  applyShieldHit,
  createShieldState,
  getShieldHoldStunRemaining,
  getShieldStunRemaining,
  isInShieldstun,
  isShieldBroken,
  isShieldRaised,
  resetShieldState,
  resolveShieldTuning,
  tickShield,
} from './shieldState';
export type {
  ResolvedShieldTuning,
  ShieldHitResult,
  ShieldInput,
  ShieldState,
  ShieldStateName,
  ShieldTuning,
} from './shieldState';

// Per-character move logic + input-to-move resolver — AC 10004 Sub-AC 4.
// Single, deterministic, data-driven resolver that takes a fighter's
// full {@link CharacterMoveset} (jab / tilt / smash + nair / fair / bair +
// neutral / side / up / down specials, exactly the 10-slot kit the Seed's
// `character.moveset` ontology mandates) plus a per-frame input snapshot,
// and returns the resolved move that should fire — or `null` if the press
// is gated. Composes the existing per-branch classifiers
// (`classifyGroundedAttack`, `classifyAerialAttack`) and extends the
// special-direction detector to four directions (neutral / side / up /
// down) so the runtime's "stick-down + special" press resolves the
// authored down-special move.
export {
  MOVE_RESOLVER_SPECIAL_DIRECTIONS,
  RESOLVER_SPECIAL_THRESHOLD,
  createMoveResolverCooldowns,
  detectMoveResolverSpecialDirection,
  enumerateMovesetMoves,
  isMoveResolverDirectionReady,
  resetMoveResolverCooldowns,
  resolveMoveFromInput,
  startMoveResolverCooldown,
  tickMoveResolverCooldowns,
} from './moveResolver';
export type {
  GroundedNormalSlotName,
  MoveResolverAerialDispatch,
  MoveResolverCategory,
  MoveResolverCooldowns,
  MoveResolverDispatch,
  MoveResolverGroundedDispatch,
  MoveResolverInput,
  MoveResolverSpecialDirection,
  MoveResolverSpecialDispatch,
} from './moveResolver';

// Visual scaling — single source of truth for sprite-display vs.
// hurtbox sizing. See `visualScale.ts` for the architectural
// contract + future per-instance scale-multiplier hook.
export {
  applySpriteDisplayHeight,
  CHARACTER_SPRITE_DISPLAY_SIZE,
  CHARACTER_SPRITE_FACES_LEFT,
  CHARACTER_SPRITE_ART_OFFSET_X,
  CHARACTER_SPRITE_ART_OFFSET_Y,
  getCharacterSpriteDisplaySize,
  getCharacterSpriteArtOffsetX,
  getCharacterSpriteArtOffsetY,
  shouldFlipSprite,
} from './visualScale';

// Extended-slot routing — post-M2 character architecture pass. Resolves
// directional grounded lights (sideLight / upLight / downLight) and the
// expanded aerial kit (nair / uair / dair) with safe fallback to the
// core slots (`tilt` / `fair`) when a fighter hasn't been migrated yet.
export {
  countExtendedSlots,
  hasAnyExtendedSlot,
  resolveAerialLightSlot,
  resolveGroundedLightSlot,
} from './extendedSlotResolver';
export type {
  AerialLightDirection,
  GroundedLightDirection,
} from './extendedSlotResolver';

// Character data-file serializer — post-M2 architecture pass. Parses
// `data/characters/<id>.json` into a validated CharacterDataSpec.
// Future: swap JSON for YAML when a parser dependency is added; the
// schema is JSON-compatible YAML so the same files round-trip in
// either format without changing the validators.
export {
  parseCharacterDataFile,
  serializeCharacterDataSpec,
} from './characterSerializer';
export type {
  CharacterDataFile,
  CharacterDataSpec,
} from './characterSerializer';

// Grab + throws subsystem — post-M2 architecture pass. ThrowSpec /
// GrabSpec data contracts + a pure GrabState machine (idle →
// whiffStartup → whiffActive → holding → throwing → cooldown).
// Mirrors the file-shape of shieldState.ts / dodgeState.ts. The
// runtime wiring (Character.ts spawning the range hitbox + applying
// throw knockback) follows once a character authors a GrabSpec.
export {
  THROW_DIRECTIONS,
  getThrowByDirection,
  isThrowDirection,
  validateThrowSet,
  validateThrowSpec,
} from './throwSchema';
export type { ThrowDirection, ThrowSet, ThrowSpec } from './throwSchema';
export {
  getGrabWhiffTotalFrames,
  validateGrabSpec,
  validatePummelSpec,
} from './grabSchema';
export type { GrabHitbox, GrabSpec, PummelSpec } from './grabSchema';
export {
  applyGrabBreak,
  applyGrabConnect,
  canPummel,
  createGrabState,
  isGrabActing,
  isHoldingGrab,
  isThrowing,
  resetGrabState,
  tickGrab,
} from './grabState';
export type {
  ActiveGrab,
  GrabInput,
  GrabState,
  GrabStateName,
} from './grabState';

// Per-fighter hand anchors — grip points for held items (weapons sit
// in the hand, mirrored by facing, instead of pinned to the body
// centre). The MatchScene held-item tracking and the throw origin
// both resolve through `computeHeldItemPosition`.
export {
  DEFAULT_HAND_ANCHOR,
  FIGHTER_HAND_ANCHORS,
  computeHeldItemPosition,
  getHandAnchor,
} from './handAnchors';
export type { HandAnchor } from './handAnchors';

// Shared execute-hook base for contract-declaring fighters — fires
// each slot off the fighter's frozen `moveset` table so the per-slot
// dispatch boilerplate exists exactly once.
export { ContractFighter } from './contractFighter';

export * from './Pikachu';
