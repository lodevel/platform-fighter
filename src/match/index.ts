/**
 * Match-state module.
 *
 * Houses the runtime state machines for an active match — the things
 * that aren't fighters, stages, inputs, physics, or render but that
 * govern the *match* itself: stocks, respawn schedule, time limit,
 * winner determination.
 *
 * AC 301 Sub-AC 1 + Sub-AC 4.2 of AC 302: `StockTracker` —
 * deterministic 3-stock-per-player data model (the AC 301 Sub-AC 1
 * surface: types + per-slot initialisation at 3 stocks each) plus the
 * blast-zone-driven stock-loss and respawn scheduler with invincibility
 * frames (AC 302 Sub-AC 4.2). One module, two ACs, one source of
 * truth — every downstream consumer (HUD, AI, replay) reads from the
 * same authority.
 *
 * AC 30001 Sub-AC 1: `MatchRng` — single seeded RNG per match,
 * captured at match start, with named substreams so every gameplay
 * subsystem (AI, hazards, visuals) reads from the same deterministic
 * source without sharing state. `initialiseMatchRng()` is the
 * Phaser-free factory the gameplay scene calls during match init.
 */

export {
  StockTracker,
  DEFAULT_STOCK_COUNT,
  DEFAULT_RESPAWN_DELAY_FRAMES,
  DEFAULT_INVINCIBILITY_FRAMES,
} from './StockTracker';
export type {
  StockTrackerOptions,
  StockLossEvent,
  RespawnEvent,
  PlayerStockState,
} from './StockTracker';

export { BlastZoneWatcher, BLAST_ZONE_LABEL_PREFIX } from './BlastZoneWatcher';
export type {
  BlastZoneCollisionEvent,
  BlastZonePair,
  MinimalBody,
  StockLossCallback,
} from './BlastZoneWatcher';

// Sub-AC 2 of AC 60202: per-tick position-based KO detector. Pairs with
// `BlastZoneWatcher` (collision-based) — together they catch both the
// normal sensor-touch case and the tunnelling / replay-resync edge cases
// the collision watcher cannot. See module header for design rationale.
export {
  BlastZonePositionWatcher,
  BLAST_ZONE_EDGE_PRIORITY,
} from './BlastZonePositionWatcher';
export type {
  BlastZoneEdge,
  KoEvent,
  KoCallback,
  PositionedBody,
} from './BlastZonePositionWatcher';

// Sub-AC 2 of AC 60002: hitbox→character damage resolver. Mirrors
// `BlastZoneWatcher` — listens to Matter's `collisionstart` stream
// and translates hitbox-vs-character pairs into `applyHit` calls
// via a registered callback. Phaser-free, deterministic, replay-safe.
export { HitboxDamageHandler } from './HitboxDamageHandler';
export type {
  HitboxCollisionEvent,
  HitboxPair,
  HitboxOrCharacterBody,
  CharacterBodyPlugin,
  HitContext,
  HitConnectCallback,
  HurtboxLookup,
  FriendlyFirePredicate,
} from './HitboxDamageHandler';

// Sub-AC 2 of AC 9: lava → fighter collision adapter. Tracks
// player↔hazard overlap pairs and, on tick(), fires an instant-KO
// callback for any overlap whose lava is currently active. Mirrors
// the BlastZoneWatcher / HitboxDamageHandler architecture — Phaser-
// free, deterministic, replay-safe. See module header for the design
// rationale around the active-state gating + persistent-overlap
// correctness.
export {
  LavaCollisionWatcher,
  LAVA_HAZARD_LABEL_PREFIX,
} from './LavaCollisionWatcher';
export type {
  LavaCollisionEvent,
  LavaCollisionPair,
  LavaMinimalBody,
  LavaKoCallback,
} from './LavaCollisionWatcher';

// AC 10102 Sub-AC 2: wind → fighter force adapter. Tracks
// player↔hazard overlap pairs and, on tick(), fires a force-application
// callback for every overlap whose wind is currently active. Continuous
// (every active tick fires) — wind is supposed to push every frame.
// Mirrors LavaCollisionWatcher's architecture (Phaser-free,
// deterministic, replay-safe) with one structural difference: no
// "fired" guard, since wind isn't one-shot.
export {
  WindForceController,
  WIND_HAZARD_LABEL_PREFIX,
} from './WindForceController';
export type {
  WindCollisionEvent,
  WindCollisionPair,
  WindMinimalBody,
  WindForceCallback,
} from './WindForceController';

// Sub-AC 3 of AC 303: Phaser-free respawn coordinator. Owns the
// "spawn platform placement, invulnerability frames, and state reset
// when stocks remain" pipeline so the gameplay scene, replay tooling,
// and tests share a single deterministic source of truth. Pairs with
// `StockTracker.consumePendingRespawns` — the scene drains events from
// the tracker and hands them to `RespawnHandler.applyRespawns`.
export {
  RespawnHandler,
  DEFAULT_SPAWN_PLATFORM_GEOMETRY,
} from './RespawnHandler';
export type {
  RespawnSlot,
  RespawnTarget,
  RespawnSideEffect,
  RespawnHandlerOptions,
  SpawnPlatform,
  SpawnPlatformGeometry,
  AppliedRespawn,
} from './RespawnHandler';

export {
  MatchEndDetector,
  DEFAULT_ENDING_DURATION_FRAMES,
} from './MatchEndDetector';
export type {
  MatchEndDetectorOptions,
  MatchEndPhase,
  MatchResultPayload,
} from './MatchEndDetector';

export { MatchRng, hashSeedWithLabel } from './MatchRng';
export type { MatchRngState, MatchRngStreamLabel } from './MatchRng';

export {
  initialiseMatchRng,
  initialiseMatchRngFromConfig,
  pickMatchSeed,
} from './MatchInit';
export type { MatchRngInitOptions, MatchRngInitResult } from './MatchInit';

// AC 30003 Sub-AC 3: unified match-start capture — one helper that
// captures the deterministic seed, wires it into the live `MatchRng`,
// and produces the per-match metadata snapshot the replay structure
// will carry. Wraps `initialiseMatchRngFromConfig` and consolidates
// metadata population in a single Phaser-free entry point.
export {
  initialiseMatch,
  buildMatchStartMetadata,
  DEFAULT_FIXED_TIMESTEP_MS,
  UNKNOWN_ENGINE_VERSION,
} from './MatchStart';
export type {
  MatchStartContext,
  MatchStartMetadata,
  InitialiseMatchOptions,
} from './MatchStart';

// AC 14 Sub-AC 2: bridges the gamepad-disconnect monitor into the
// engine's pause flag so a mid-match pad pull immediately freezes
// input + simulation. The MatchScene constructs one, wires it to the
// scene's `GamepadConnectionMonitor` + `PhysicsEngine`, and flips
// `setActive(true)` once the match is live. See module header for the
// full design rationale.
export { DisconnectPauseController } from './DisconnectPauseController';
export type {
  DisconnectPauseControllerOptions,
  DisconnectPauseEvent,
  DisconnectPauseListener,
  DisconnectResumeEvent,
  DisconnectResumeListener,
  PausableSimulation,
} from './DisconnectPauseController';

// AC 12: time-mode tie resolution + sudden-death coordinator. The
// pure helpers (`evaluateTimeMatch`, `findStockLeaders`, ...) live
// in `timeMatchResolution.ts` and are safe to call from any module
// (gameplay scene, AI evaluator, replay tooling, headless tests).
// The stateful `SuddenDeathController` composes them with a
// `StockTracker` to drive the TIMING → TIE_DETECTED → SUDDEN_DEATH
// → RESOLVED state machine.
export {
  TIME_MATCH_FRAME_RATE_HZ,
  evaluateTimeMatch,
  findStockLeaders,
  getMatchConfigTimeLimitFrames,
  getTimeRemainingFrames,
  isTimeUp,
  timeLimitSecondsToFrames,
} from './timeMatchResolution';
export type { TimeMatchResolution } from './timeMatchResolution';

export {
  DEFAULT_SUDDEN_DEATH_STOCKS,
  SuddenDeathController,
} from './SuddenDeathController';
export type {
  SuddenDeathControllerOptions,
  SuddenDeathPhase,
  SuddenDeathTracker,
} from './SuddenDeathController';

// Sub-AC 1 of AC 16: deterministic per-player ledger for the three
// headline post-match metrics — KOs, damage dealt, survival time.
// Phaser-free; the gameplay scene drives `recordDamage`, `recordStockLoss`,
// `recordElimination`, and `finalize` from existing collision callbacks
// and the MatchEndDetector handoff. Read by the results scene and the
// (M4) replay overlay.
export {
  DEFAULT_KO_ATTRIBUTION_WINDOW_FRAMES,
  MatchStatsTracker,
} from './MatchStatsTracker';
export type {
  MatchStatsTrackerOptions,
  PlayerMatchStats,
} from './MatchStatsTracker';
