/**
 * Character roster module.
 *
 * Hosts the base `Character` class (Sub-AC 1 of AC 201) — Matter.js
 * body wrapper with movement, jump physics, and ground detection —
 * the attack/hitbox primitives (AC 202 Sub-AC 2), and the first two
 * concrete subclasses of the M2 roster (Wolf bruiser, Cat ninja).
 * Owl mage and Bear grappler land in subsequent sub-ACs.
 */

// Base class & input shape
export {
  Character,
  CHARACTER_LABEL,
  DEFAULT_CHARACTER_TUNING,
} from './Character';
export type {
  CharacterOptions,
  CharacterTuning,
  CharacterInput,
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
  HitboxScene,
} from './attacks';

// Combat math (Sub-AC 4.1 of AC 301)
export {
  MAX_DAMAGE_PERCENT,
  BASELINE_MASS,
  HITSTUN_FRAMES_PER_KNOCKBACK_UNIT,
  MIN_HITSTUN_FRAMES,
  MAX_HITSTUN_FRAMES,
  accumulateDamage,
  computeKnockback,
  computeHitstun,
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
  MovesetSlotOverride,
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
// the correctly-typed concrete subclass (Wolf / Cat / Owl / Bear).
// Centralises the switch so both `MatchScene` (via the
// CharacterSelect → MatchScene wiring) and `Fighter` (per-player runtime
// entity) read one source of truth. Each instantiated character carries
// its full authored moveset by virtue of its subclass constructor's
// `registerAttack` calls.
export { createCharacterById, resolveSlotCharacterId } from './characterFactory';
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

// Concrete fighters (jab + smash + nair triplets land in Sub-AC 3.3;
// AC 60002 Sub-AC 2 adds Wolf's tilt + animation states for the full
// grounded triplet jab / tilt / smash; AC 60003 Sub-AC 3 mirrors that
// expansion onto Cat; AC 60101 Sub-AC 1 adds the full aerial cut
// (nair / fair / bair) as authored data records on every roster slot,
// pending runtime wiring in the follow-up sub-AC).
export {
  Wolf,
  WOLF_TUNING,
  WOLF_JAB,
  WOLF_TILT,
  WOLF_SMASH,
  WOLF_NAIR,
  WOLF_NAIR_AERIAL,
  WOLF_FAIR,
  WOLF_BAIR,
  WOLF_NEUTRAL_SPECIAL,
  WOLF_SIDE_SPECIAL,
  WOLF_UP_SPECIAL,
  WOLF_DOWN_SPECIAL,
  // Sub-AC 3 of T2 refactor — frozen per-fighter declarations
  // (10-slot moveset + movement profile + identity bundle).
  WOLF_MOVESET,
  WOLF_MOVEMENT_PROFILE,
  WOLF_FIGHTER_CONTRACT,
} from './Wolf';
export type { WolfOptions } from './Wolf';
export {
  Cat,
  CAT_TUNING,
  CAT_JAB,
  CAT_TILT,
  CAT_SMASH,
  CAT_NAIR,
  CAT_NAIR_AERIAL,
  CAT_FAIR,
  CAT_BAIR,
  CAT_NEUTRAL_SPECIAL,
  CAT_SIDE_SPECIAL,
  CAT_UP_SPECIAL,
  CAT_DOWN_SPECIAL,
  // Sub-AC 3 of T2 refactor — frozen per-fighter declarations.
  CAT_MOVESET,
  CAT_MOVEMENT_PROFILE,
  CAT_FIGHTER_CONTRACT,
} from './Cat';
export type { CatOptions } from './Cat';
// AC 60004 Sub-AC 4 — Owl ships the full grounded triplet
// (jab / tilt / smash) with animation states. AC 60101 Sub-AC 1
// adds Owl's aerial cut (nair / fair / bair) as authored data
// records.
export {
  Owl,
  OWL_TUNING,
  OWL_JAB,
  OWL_TILT,
  OWL_SMASH,
  OWL_NAIR,
  OWL_FAIR,
  OWL_BAIR,
  OWL_NEUTRAL_SPECIAL,
  OWL_SIDE_SPECIAL,
  OWL_UP_SPECIAL,
  OWL_DOWN_SPECIAL,
  // Sub-AC 3 of T2 refactor — frozen per-fighter declarations.
  OWL_MOVESET,
  OWL_MOVEMENT_PROFILE,
  OWL_FIGHTER_CONTRACT,
} from './Owl';
export type { OwlOptions } from './Owl';
// AC 60001 Sub-AC 1 — Bear ships the full grounded triplet
// (jab / tilt / smash) with animation states, fulfilling the "every
// roster slot has the grounded triplet" foundation cut. AC 60101
// Sub-AC 1 adds Bear's aerial cut (nair / fair / bair) as authored
// data records.
export {
  Bear,
  BEAR_TUNING,
  BEAR_JAB,
  BEAR_TILT,
  BEAR_SMASH,
  BEAR_NAIR,
  BEAR_FAIR,
  BEAR_BAIR,
  BEAR_NEUTRAL_SPECIAL,
  BEAR_SIDE_SPECIAL,
  BEAR_UP_SPECIAL,
  BEAR_DOWN_SPECIAL,
  // Sub-AC 3 of T2 refactor — frozen per-fighter declarations.
  BEAR_MOVESET,
  BEAR_MOVEMENT_PROFILE,
  BEAR_FIGHTER_CONTRACT,
} from './Bear';
export type { BearOptions } from './Bear';
// Post-M5 roster expansion — three Smash-inspired fighters join the
// cast with full kits on day one (grounded triplet + 3 aerials + 4
// specials + grab), each rendered through the procedural placeholder
// pipeline until sprite packs land: Blaze (Captain Falcon rushdown),
// Puff (Jigglypuff balloon), Aegis (Marth sword spacing).
export {
  Blaze,
  BLAZE_TUNING,
  BLAZE_JAB,
  BLAZE_TILT,
  BLAZE_SMASH,
  BLAZE_NAIR,
  BLAZE_FAIR,
  BLAZE_BAIR,
  BLAZE_NEUTRAL_SPECIAL,
  BLAZE_SIDE_SPECIAL,
  BLAZE_UP_SPECIAL,
  BLAZE_DOWN_SPECIAL,
  BLAZE_GRAB,
  // Frozen per-fighter declarations (10-slot moveset + movement
  // profile + identity bundle) — same surface as the rest of the cast.
  BLAZE_MOVESET,
  BLAZE_MOVEMENT_PROFILE,
  BLAZE_FIGHTER_CONTRACT,
} from './Blaze';
export type { BlazeOptions } from './Blaze';
export {
  Puff,
  PUFF_TUNING,
  PUFF_JAB,
  PUFF_TILT,
  PUFF_SMASH,
  PUFF_NAIR,
  PUFF_FAIR,
  PUFF_BAIR,
  PUFF_NEUTRAL_SPECIAL,
  PUFF_SIDE_SPECIAL,
  PUFF_UP_SPECIAL,
  PUFF_DOWN_SPECIAL,
  PUFF_GRAB,
  // Frozen per-fighter declarations.
  PUFF_MOVESET,
  PUFF_MOVEMENT_PROFILE,
  PUFF_FIGHTER_CONTRACT,
} from './Puff';
export type { PuffOptions } from './Puff';
export {
  Aegis,
  AEGIS_TUNING,
  AEGIS_JAB,
  AEGIS_TILT,
  AEGIS_SMASH,
  AEGIS_NAIR,
  AEGIS_FAIR,
  AEGIS_BAIR,
  AEGIS_NEUTRAL_SPECIAL,
  AEGIS_SIDE_SPECIAL,
  AEGIS_UP_SPECIAL,
  AEGIS_DOWN_SPECIAL,
  AEGIS_GRAB,
  // Frozen per-fighter declarations.
  AEGIS_MOVESET,
  AEGIS_MOVEMENT_PROFILE,
  AEGIS_FIGHTER_CONTRACT,
} from './Aegis';
export type { AegisOptions } from './Aegis';
// Post-batch-2 roster expansion — three more Smash-inspired fighters
// join the cast with full kits + sourced sprite packs: Volt (Pikachu
// tiny combo rushdown), Nova (Samus ranged zoner), Bruno (Mario
// all-rounder).
export {
  Volt,
  VOLT_TUNING,
  VOLT_JAB,
  VOLT_TILT,
  VOLT_SMASH,
  VOLT_NAIR,
  VOLT_FAIR,
  VOLT_BAIR,
  VOLT_NEUTRAL_SPECIAL,
  VOLT_SIDE_SPECIAL,
  VOLT_UP_SPECIAL,
  VOLT_DOWN_SPECIAL,
  VOLT_GRAB,
  // Frozen per-fighter declarations.
  VOLT_MOVESET,
  VOLT_MOVEMENT_PROFILE,
  VOLT_FIGHTER_CONTRACT,
} from './Volt';
export type { VoltOptions } from './Volt';
export {
  Nova,
  NOVA_TUNING,
  NOVA_JAB,
  NOVA_TILT,
  NOVA_SMASH,
  NOVA_NAIR,
  NOVA_FAIR,
  NOVA_BAIR,
  NOVA_NEUTRAL_SPECIAL,
  NOVA_SIDE_SPECIAL,
  NOVA_UP_SPECIAL,
  NOVA_DOWN_SPECIAL,
  NOVA_GRAB,
  // Frozen per-fighter declarations.
  NOVA_MOVESET,
  NOVA_MOVEMENT_PROFILE,
  NOVA_FIGHTER_CONTRACT,
} from './Nova';
export type { NovaOptions } from './Nova';
export {
  Bruno,
  BRUNO_TUNING,
  BRUNO_JAB,
  BRUNO_TILT,
  BRUNO_SMASH,
  BRUNO_NAIR,
  BRUNO_FAIR,
  BRUNO_BAIR,
  BRUNO_NEUTRAL_SPECIAL,
  BRUNO_SIDE_SPECIAL,
  BRUNO_UP_SPECIAL,
  BRUNO_DOWN_SPECIAL,
  BRUNO_GRAB,
  // Frozen per-fighter declarations.
  BRUNO_MOVESET,
  BRUNO_MOVEMENT_PROFILE,
  BRUNO_FIGHTER_CONTRACT,
} from './Bruno';
export type { BrunoOptions } from './Bruno';
// Post-batch-3 roster expansion — three more Smash-inspired fighters
// join the cast with full kits, rendered through the procedural
// placeholder pipeline (no sprite packs): Link (Zelda projectile
// swordsman), Kirby (multi-jump puffball), Donkey Kong (mobile
// heavyweight bruiser).
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
export {
  Kirby,
  KIRBY_TUNING,
  KIRBY_JAB,
  KIRBY_TILT,
  KIRBY_SMASH,
  KIRBY_NAIR,
  KIRBY_FAIR,
  KIRBY_BAIR,
  KIRBY_NEUTRAL_SPECIAL,
  KIRBY_SIDE_SPECIAL,
  KIRBY_UP_SPECIAL,
  KIRBY_DOWN_SPECIAL,
  KIRBY_GRAB,
  // Frozen per-fighter declarations.
  KIRBY_MOVESET,
  KIRBY_MOVEMENT_PROFILE,
  KIRBY_FIGHTER_CONTRACT,
} from './Kirby';
export type { KirbyOptions } from './Kirby';
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
  WOLF_SPEC,
  CAT_SPEC,
  OWL_SPEC,
  BEAR_SPEC,
  BLAZE_SPEC,
  PUFF_SPEC,
  AEGIS_SPEC,
  VOLT_SPEC,
  NOVA_SPEC,
  BRUNO_SPEC,
  LINK_SPEC,
  KIRBY_SPEC,
  DONKEYKONG_SPEC,
  WOLF_MOVES,
  CAT_MOVES,
  OWL_MOVES,
  BEAR_MOVES,
  BLAZE_MOVES,
  PUFF_MOVES,
  AEGIS_MOVES,
  VOLT_MOVES,
  NOVA_MOVES,
  BRUNO_MOVES,
  LINK_MOVES,
  KIRBY_MOVES,
  DONKEYKONG_MOVES,
  WOLF_PLACEHOLDER,
  CAT_PLACEHOLDER,
  OWL_PLACEHOLDER,
  BEAR_PLACEHOLDER,
  BLAZE_PLACEHOLDER,
  PUFF_PLACEHOLDER,
  AEGIS_PLACEHOLDER,
  VOLT_PLACEHOLDER,
  NOVA_PLACEHOLDER,
  BRUNO_PLACEHOLDER,
  LINK_PLACEHOLDER,
  KIRBY_PLACEHOLDER,
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
  WOLF_PALETTES,
  CAT_PALETTES,
  OWL_PALETTES,
  BEAR_PALETTES,
  BLAZE_PALETTES,
  PUFF_PALETTES,
  AEGIS_PALETTES,
  VOLT_PALETTES,
  NOVA_PALETTES,
  BRUNO_PALETTES,
  LINK_PALETTES,
  KIRBY_PALETTES,
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
