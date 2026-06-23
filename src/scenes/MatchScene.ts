import Phaser from 'phaser';
import { GAME_CONFIG } from '../engine/GameConfig';
import { ASSET_KEYS } from '../assets/manifest';
import { PhysicsEngine } from '../engine/PhysicsEngine';
import {
  CHARACTER_SLOT_BITS,
  COLLISION_CATEGORIES,
} from '../engine/collisionCategories';
import {
  BaseStage,
  FLAT_STAGE,
  STAGES,
  getStage,
  customStageDataToStageLayout,
  customStageSlotIdFromRuntimeId,
  isCustomStageId,
  PLATFORM_LABELS,
  BACKGROUND_AMBIENT_DEPTH,
  renderStageBackground,
  type RenderedStage,
  type RenderedStageBackground,
} from '../stages';
import {
  loadCustomStage,
  type CustomStageData,
} from '../builder';
import { CameraController, type CameraTarget } from '../camera';
import {
  type Character,
  type CharacterInput,
  computeHeldItemPosition,
  createCharacterById,
  createSpriteAnimationStateMachine,
  getCharacterSpec,
  applySpriteDisplayHeight,
  getCharacterSpriteDisplaySize,
  getCharacterSpriteArtOffsetX,
  getCharacterSpriteArtOffsetY,
  shouldFlipSprite,
  ledgeCandidatesFromPlatform,
  type LedgeCandidate,
  paletteSwapForCharacter,
  registerAllCharacterSpriteAnimations,
  attackMoveToSheet,
  getMoveAnimKey,
  getSpriteAnimationKey,
  MOVE_SHEET_NAMES,
  resolveSlotCharacterId,
  RuntimePaletteRenderer,
  SHIELD_DEFAULTS,
  type PaletteSwap,
  type SpriteAnimationSnapshot,
  type SpriteAnimationStateMachine,
} from '../characters';
import { resolveLedgeTrumps } from '../characters/ledgeHangState';
// Truthful hitbox-centre math — shared with `spawnHitbox` so the hit
// spark / debug overlay land exactly where the real Matter sensor does.
import { computeHitboxCenter } from '../characters/attacks';
import {
  computeRageMultiplier,
  computeStaleMultiplier,
  type HitInfo,
} from '../characters/combat';
import {
  type ChargeSpec,
  computeChargeTFromSpec,
  computeChargedDamageFromSpec,
  computeChargedKnockbackFromSpec,
} from '../characters/chargeSchema';
// M2 — simple stub AI for AI-tier slots. Full Easy/Medium/Hard tier
// integration (WorldSnapshot perception, behavior trees) is the next
// step; this stub gets AI slots moving + attacking immediately.
import { simpleBotInput } from '../ai/simpleBot';
import {
  BindingsPersistenceLifecycle,
  ControllerReconnectionHandler,
  DeviceInputDispatcher,
  GamepadConnectionMonitor,
  InputBindingsStore,
  InputResolver,
  buildCharacterInputFromResolver,
  createBrowserGamepadSource,
  createPhaserKeyboardSource,
  type ControllerRebindEvent,
  type GamepadSource,
  type KeyboardSource,
} from '../input';
import {
  BlastZoneWatcher,
  BlastZonePositionWatcher,
  DisconnectPauseController,
  HitboxDamageHandler,
  StockTracker,
  MatchEndDetector,
  MatchStatsTracker,
  RespawnHandler,
  DEFAULT_ENDING_DURATION_FRAMES,
  DEFAULT_INVINCIBILITY_FRAMES,
  DEFAULT_STOCK_COUNT,
  buildMatchStartMetadata,
  initialiseMatchRngFromConfig,
  type BlastZoneCollisionEvent,
  type DisconnectPauseEvent,
  type DisconnectResumeEvent,
  type HitboxCollisionEvent,
  type LavaCollisionEvent,
  type WindCollisionEvent,
  type MatchRng,
  type MatchStartMetadata,
} from '../match';
import type { MatchConfig, PlayerSlot, StageLayout } from '../types';
import type { PlayerBindingsIndex } from '../types/inputBindings';
import {
  InputCaptureBuffer,
  RecordingController,
  downloadReplayFile,
  DownloadReplayUnsupportedError,
} from '../replay';
import {
  DamageHud,
  FpsCounter,
  formatBindingList,
  ReconnectPromptOverlay,
  ShieldBubble,
  createShieldBubble,
  ChargeIndicator,
  createChargeIndicator,
} from '../ui';
// World-space combat FX (thin Phaser layers over pure formatters):
//   • HitSparkPool   — on-contact impact burst spawned in the damage path.
//   • SwingTrail     — per-fighter weapon / smash sweep streak.
//   • HitboxDebugLayer — F3 toggleable hitbox / hurtbox / grab diagnostic.
import {
  HitSparkPool,
  createHitSparkPool,
  SwingTrail,
  createSwingTrail,
  HitboxDebugLayer,
  createHitboxDebugLayer,
  type HitboxDebugFighterSnapshot,
} from '../fx';
import {
  ItemSpawnManager,
  resolveItemFrequency,
  ItemRegistry,
  ItemEntity,
  Inventory,
  PickupController,
  ThrowController,
  BAT_DEFINITION,
  SWORD_DEFINITION,
  HAMMER_DEFINITION,
  SPEAR_DEFINITION,
  RAY_GUN_DEFINITION,
  BOMB_DEFINITION,
  type ItemDefinition,
} from '../items';
import { ItemSpawnEventLog } from '../replay/ItemSpawnEventLog';
import {
  AudioManager,
  DEFAULT_STAGE_MUSIC_KEY,
  emitCombatSfx,
  mapHitConnectToSfxKey,
  StageMusicController,
  type SoundManagerLike,
} from '../audio';
import { BOOT_REGISTRY_KEYS } from './bootKeys';
import type { PauseAction } from './pauseMenu';

/**
 * Optional scene-data payload accepted by `MatchScene.create()`.
 *
 * The menu / replay player can pass either a fully-formed
 * `MatchConfig` (M2+) or a bare `rngSeed` shortcut (M1 dev mode + the
 * upcoming M4 replay player). Both routes feed the same
 * `initialiseMatchRngFromConfig` capture so the match-scoped RNG is
 * deterministic regardless of which call site started the scene.
 */
export interface MatchSceneData {
  readonly matchConfig?: MatchConfig;
  readonly rngSeed?: number;
  /**
   * AC 20104 Sub-AC 4 — saved-stage loader entry point. When the menu
   * flow selects a custom stage, the Stage Select scene loads the
   * saved blob via `loadCustomStage(slotId)` and forwards the typed
   * {@link CustomStageData} body here. `MatchScene` converts it to a
   * runtime {@link StageLayout} via `customStageDataToStageLayout` and
   * uses that as the active stage instead of consulting the built-in
   * `STAGES` registry.
   *
   * When omitted, the scene falls back to the M2 lookup-by-id path so
   * existing call sites (replay loader, dev-mode "press ENTER to
   * fight", built-in stage selection) continue to work unchanged.
   *
   * If the `matchConfig.stageId` is also set to a `'custom:<slot-id>'`
   * value AND no `customStage` body is supplied, the scene falls back
   * to loading the body from `localStorage` via `loadCustomStage` —
   * useful for the (future) replay-load path that re-enters the match
   * scene from a saved replay header.
   */
  readonly customStage?: CustomStageData;
}

/**
 * MatchScene hosts an actual fight. For the M1 scaffold it loads the
 * flat (Battlefield-style) stage so we can verify the physics +
 * stage-rendering pipeline end-to-end.
 *
 * Critically for AC 3: the Matter world is driven by our deterministic
 * fixed-timestep `PhysicsEngine` (see `src/engine/GameLoop.ts`) instead
 * of Phaser's variable-step auto-update. This is what makes replays
 * deterministic across machines and frame rates.
 *
 * Sub-AC 2.1: the stage scene renders its platform geometry — one
 * solid ground platform plus three pass-through floating platforms —
 * using the data-driven `StageLayout` from
 * `src/stages/stageDefinitions.ts`.
 *
 * Sub-AC 2.2: every platform body is filtered through the shared
 * collision-category table (so character / hitbox / projectile /
 * hazard interactions all line up), and four `isSensor` blast-zone
 * walls bound the stage so the (later-AC) KO handler can detect a
 * character crossing the line.
 *
 * AC 204 Sub-AC 4 (refined by AC 5 Sub-AC 3): two `Character` instances
 * (Wolf as P1, Cat as P2) are spawned at the stage's first two spawn
 * points and wired to a {@link DeviceInputDispatcher}, which reads the
 * shared {@link InputBindingsStore} on every fixed step. Each step the
 * scene samples the P1 and P2 `CharacterInput` snapshots from the
 * dispatcher and forwards them to the matching fighter's `applyInput`,
 * so both players can move, jump, and attack independently using
 * whatever keyboard keys / gamepad buttons they have rebound for their
 * slot — there is no hardcoded WASD/arrow path on the gameplay hot
 * loop. The camera tracks both fighters; a small per-player HUD line
 * shows live position / facing / jumps-used / attack state so the
 * wiring is observable end-to-end.
 *
 * Sub-AC 4.2 of AC 302 / Sub-AC 4 of AC 6: stock tracking + respawn
 * with invincibility (a.k.a. "KO handling on blast zone crossing — life
 * decrement, respawn or elimination, damage % reset"). One pipeline,
 * two AC ladders — both ACs require the exact same wiring, so the same
 * modules satisfy both contracts.
 *
 * A `StockTracker` (Phaser-free, deterministic) starts each fighter
 * with 3 stocks. A `BlastZoneWatcher` listens to the world's
 * `collisionstart` stream — when a registered fighter's body crosses
 * a `blastZone.*` sensor, the watcher fires the tracker's `loseStock`
 * with the current physics frame (life decrement). Once per fixed step
 * the scene drains `tracker.consumePendingRespawns(frame)` and hands the
 * events to `RespawnHandler.applyRespawns`, which teleports the fighter
 * back to its registered spawn point, drives `setDamagePercent(0)` to
 * reset the meter (damage % reset), grants 90 frames of invincibility
 * (Character.setInvincibility), and faces the fighter inward. Eliminated
 * fighters (zero stocks) take the OTHER branch: no respawn fires and
 * the scene unregisters them from both the collision-based and position-
 * based KO watchers + the hitbox damage handler so a corpse drifting
 * past the blast zone can't fire phantom events. The match-over banner
 * reads `tracker.getWinner()` once `tracker.isMatchOver()` flips true.
 *
 * Headline tests:
 *   • {@link BlastZoneKoHandling.test.ts} — Sub-AC 4 of AC 6 contract
 *     proof: life decrement + respawn-or-elimination + damage % reset
 *     in a single end-to-end harness, plus a determinism gate.
 *   • {@link KoLifecycle.test.ts} — full StockTracker × BlastZoneWatcher
 *     × BlastZonePositionWatcher × MatchEndDetector integration test.
 *
 * Sub-AC 4.3 of AC 303: match-end detection & results flow.
 * A `MatchEndDetector` (Phaser-free, deterministic) sits on top of
 * the stock tracker. Once the tracker reports `isMatchOver()`, the
 * detector latches the winner snapshot and runs a fixed
 * `endingDurationFrames` (default 180 = 3 s @ 60 Hz) "GAME!" hold.
 * During the hold the scene:
 *   • Skips input sampling (frozen fighters).
 *   • Skips Matter `world.step` (frozen physics — bodies stay where
 *     they fell on the deciding KO).
 *   • Renders an oversized "GAME!" banner so the deciding moment
 *     reads even on a 1080p laptop.
 * Once the hold elapses, the detector flips to READY and the scene
 * starts `ResultsScene` with the latched payload (winner index,
 * winner name, per-player stocks, stage label).
 */
export class MatchScene extends Phaser.Scene {
  private physicsEngine!: PhysicsEngine;
  /**
   * Sub-AC 3 of AC 3: top-left FPS overlay showing real-time render
   * FPS, simulation tick rate (Hz), and the configured 60 FPS target.
   * Owns its own text object + rolling-window tick meter so the scene
   * just needs to (a) tell it how many simulation steps each tick ran
   * and (b) trigger a refresh from the render hook.
   */
  private fpsCounter!: FpsCounter;
  private frameText!: Phaser.GameObjects.Text;
  private camText!: Phaser.GameObjects.Text;
  private p1Text!: Phaser.GameObjects.Text;
  private p2Text!: Phaser.GameObjects.Text;
  private stockText!: Phaser.GameObjects.Text;
  private matchOverText!: Phaser.GameObjects.Text;
  private stage!: RenderedStage;
  /**
   * AC 20101 Sub-AC 1 — the {@link BaseStage} runtime contract that
   * encapsulates all stage-specific orchestration: platform colliders,
   * blast-zone sensor walls, spawn-point lookups, hazard renderers
   * (lava + wind), and the per-step hazard lifecycle hooks
   * (`tickHazards` / `applyHazardEffects` / `updateRender` /
   * `handleCollisionStart` / `handleCollisionEnd`). Every other stage-
   * facing field on this scene (`stage`, `lavaHazards`,
   * `windHazards`, `lavaCollisionWatcher`, `windForceController`) is
   * wired through this instance so the gameplay loop has one place to
   * add a future hazard family or trap watcher without re-touching the
   * `create()` / `update()` / SHUTDOWN scaffolding.
   */
  private baseStage!: BaseStage;

  /**
   * Themed parallax background handle (gradient + silhouette layers
   * behind the platforms). Created right before the BaseStage in
   * `create()`, ticked on the fixed step (ambient pulse), parallax-
   * updated after the camera each render frame, destroyed on SHUTDOWN.
   */
  private stageBackground: RenderedStageBackground | null = null;

  /**
   * Pause-menu freeze flag. While `true`, {@link update} skips the
   * deterministic fixed-step advance entirely — the match becomes a
   * frozen still-life under the `PauseMenuScene` overlay — and resumes
   * byte-identically when the overlay dispatches `'resume'` (the
   * accumulator inside `PhysicsEngine` is never advanced while paused,
   * so no wall-clock drift leaks into the sim). The overlay itself owns
   * NO simulation state; it only calls back into
   * {@link handlePauseAction}.
   */
  private pausedForMenu = false;

  /**
   * Rising-edge latch for the gamepad START button (standard-mapping
   * index 9), which opens the pause menu the same way the keyboard ESC
   * does. Polled in {@link update} because Phaser's pad buttons are
   * level-triggered.
   */
  private prevStartHeld = false;
  /**
   * The `StageLayout` actually rendered for the active match. Resolved
   * from `MatchConfig.stageId` (via the `STAGES` registry) when a
   * match config is supplied; falls back to `FLAT_STAGE` for the
   * "press ENTER to fight" dev-mode path. Captured up-front so any
   * subsystem that needs the layout's blast zone, hazard list, or
   * spawn points reads the same source of truth.
   */
  private activeStage!: StageLayout;
  /**
   * Grabbable ledge corners derived once from the active stage's solid
   * platforms (see the ledge-system wiring in `create`). Fed to every
   * fighter via `setLedgeCandidates`; also the source for the per-frame
   * ledge-occupancy conflict pass (trump / edge-hog).
   */
  private ledgeCandidatesByStage: ReadonlyArray<LedgeCandidate> = [];

  /**
   * Per-player ledge key (`platformId:side`) at the END of the previous step,
   * used to detect ledge-TRUMP: a fighter that just grabbed a ledge another
   * was already hanging on steals it (see {@link resolveLedgeTrumps}). Cleared
   * in `create()` since Phaser reuses the scene instance across matches.
   */
  private prevLedgeKeys = new Map<number, string | null>();
  /*
   * The four hazard-related fields previously held here
   * (`lavaHazards`, `lavaCollisionWatcher`, `windHazards`,
   * `windForceController`) moved to {@link BaseStage} (AC 20101 Sub-AC 1).
   * Code that needs them reads `this.baseStage.lavaHazards`,
   * `this.baseStage.lavaCollisionWatcher`, etc. — the stage owns the
   * lifecycle so a future hazard family doesn't add yet another
   * scene-level field.
   */
  /**
   * Cached collision-end listener handle so the SHUTDOWN hook can
   * detach it cleanly. Mirrors `collisionStartHandler` — kept null
   * until the lava / wind watcher is wired so non-hazard stages don't
   * pay the listener cost.
   */
  private collisionEndHandler:
    | ((event: LavaCollisionEvent | WindCollisionEvent) => void)
    | null = null;
  private cameraController!: CameraController;
  /**
   * Two fighters wired to the keyboard. P1 (WASD + F/G/H/T/R), P2
   * (Arrow keys + Numpad). Drives the AC 204 Sub-AC 4 acceptance: both
   * players move / jump / attack independently from a single shared
   * keyboard.
   *
   * AC 10005 Sub-AC 5 — these are now typed as the abstract `Character`
   * base class because the concrete subclass (Wolf / Cat / Owl / Bear)
   * is resolved at runtime from the `MatchConfig.players[]` lineup.
   * The runtime contract is the same: every concrete subclass exposes
   * the full `Character` interface (movement, attacks, hitbox plugin,
   * facing, …), so the scene's call sites are unaffected.
   */
  private p1!: Character;
  private p2!: Character;
  /**
   * Optional fighters for slots 3 and 4 — only constructed when
   * `matchConfig.players.length > 2` (4-player FFA). 1v1 matches
   * leave these undefined; the playerSlots array still iterates
   * cleanly because we only push entries that have a backing fighter.
   */
  private extraFighters: Character[] = [];
  private extraVisuals: Phaser.GameObjects.Rectangle[] = [];
  private extraSprites: (Phaser.GameObjects.Sprite | null)[] = [];
  private extraFacingMarks: Phaser.GameObjects.Triangle[] = [];
  /**
   * Reference to the per-create `ADDED_TO_SCENE` listener that
   * partitions new GameObjects between `cameras.main` and the UI
   * camera. Stashed at the class level so the SHUTDOWN handler can
   * `.off()` it before the next match's `create()` runs (Phaser
   * doesn't auto-clear scene-events on `shutdown`, only on `destroy`).
   * `null` when no listener is currently attached.
   */
  private cameraPartitionListener: ((obj: Phaser.GameObjects.GameObject) => void) | null = null;
  /**
   * AC 5 Sub-AC 3: device-agnostic input dispatcher. Reads the live
   * keyboard + gamepad state through the shared {@link InputBindingsStore}
   * (the same store the rebinding screen mutates and the M5 settings
   * persister round-trips to `localStorage`), so each fixed step the
   * scene can ask the dispatcher for slot 1's `CharacterInput` and the
   * answer reflects whatever the player most recently rebound — no
   * scene reload, no hardcoded WASD/arrow tables. Replaces the M1
   * `LocalInputHandler` which baked the default key map directly into
   * its constructor and could not see gamepad-bound slots at all.
   *
   * AC 50202 Sub-AC 2: gameplay no longer reads from the dispatcher
   * directly — every per-step input read goes through the central
   * {@link InputResolver} below, which shares this dispatcher so a
   * single device poll feeds both the resolver's action snapshot and
   * any auxiliary subsystems (e.g. controller reconnection) that need
   * raw device polling. The `update()` loop only calls into
   * `inputResolver`.
   */
  private inputDispatcher!: DeviceInputDispatcher;
  // AC 50202 Sub-AC 2 — the legacy per-frame {@link InputService}
  // resolver the scene used to query directly has been superseded by
  // the central {@link InputResolver} below. Every gameplay-side input
  // read now flows through the resolver's
  // `getAction(playerIndex, actionName)` /
  // `getMoveVector(playerIndex)` API instead, so the scene no longer
  // holds an `InputService` field. The legacy module is preserved for
  // downstream callers (replay tooling, the rebinding capture
  // preview); the gameplay path simply doesn't depend on it any more.
  /**
   * AC 50202 Sub-AC 2 — central per-player {@link InputResolver} the
   * gameplay loop reads through. Wraps the shared {@link inputDispatcher}
   * + bindings-store stack and exposes the canonical seed action
   * vocabulary (`move{Left,Right,Up,Down}` / jump / attack / special /
   * shield / grab / dodge) under the AC-named
   * `getAction(playerIndex, actionName)` / `isActionHeld` /
   * `getMoveVector` API. The gameplay loop calls `update(frame)` once
   * per fixed step and resolves every player's `CharacterInput` through
   * {@link buildCharacterInputFromResolver}; there is no raw key-code,
   * gamepad button index, or hardcoded WASD/arrow lookup left on the
   * gameplay path — every action category routes through the
   * rebindable binding layer (resolver → dispatcher → bindings store).
   *
   * Reset on SHUTDOWN so the next match starts with a clean
   * previous-frame snapshot (otherwise a button held through a scene
   * transition would phantom-`justPressed` on the very next match's
   * first update).
   */
  private inputResolver!: InputResolver;
  /**
   * Visual proxies pinned to each character's body each render frame.
   * The `Character` class only owns the Matter body; for the M1
   * scaffold we draw a flat-colour rectangle so it's visually obvious
   * which fighter responds to which keyboard. Sprite atlases land in a
   * later AC.
   */
  private p1Visual!: Phaser.GameObjects.Rectangle;
  private p2Visual!: Phaser.GameObjects.Rectangle;
  /**
   * Small triangle pinned in front of each fighter showing facing
   * direction — handy when verifying that the attack hitbox spawns on
   * the correct side after a stick deflection.
   */
  private p1FacingMark!: Phaser.GameObjects.Triangle;
  private p2FacingMark!: Phaser.GameObjects.Triangle;

  // AC 20302 Sub-AC 2 — Runtime palette renderer that paints per-slot
  // palette swaps onto the live fighter visuals. Constructed once at
  // scene-create with no pipeline factory (no real WebGL pipeline ships
  // in M1), so sprite targets fall through to the canonical
  // `setTint` fallback path. Once a real `PaletteSwapPipeline`
  // subclass lands, the constructor swaps to
  // `new RuntimePaletteRenderer(this.game, () => new PaletteSwapPipeline(this.game))`
  // and the in-game sprite atlases pick up the proper palette-key
  // remap shader without any other call-site change.
  private paletteRenderer: RuntimePaletteRenderer = new RuntimePaletteRenderer();

  // ---- Sub-AC 4.2: stock + respawn -----------------------------------------
  private stockTracker!: StockTracker;
  private blastZoneWatcher!: BlastZoneWatcher;

  // ---- Sub-AC 3 of AC 303: respawn coordinator ----------------------------
  /**
   * Phaser-free deterministic respawn coordinator. Owns the
   * "spawn platform placement, invulnerability frames, and state reset
   * when stocks remain" pipeline. The scene drains
   * `stockTracker.consumePendingRespawns(frame)` once per fixed step
   * and hands the events to `respawnHandler.applyRespawns(events,
   * frame)`. The handler then teleports each fighter back to its
   * registered spawn point, resets damage / facing, grants the
   * invincibility window, and produces a `SpawnPlatform` overlay
   * record that the render hook draws as a small ghost platform
   * under the fighter for the duration of their grace window.
   */
  private respawnHandler!: RespawnHandler;
  /**
   * Live Phaser visuals tracking active spawn platforms, keyed by
   * `playerIndex`. Each entry pairs the platform record with the
   * Phaser GameObjects pinned to it (a soft rectangle plus a faint
   * glow underline). Created on respawn, destroyed when the platform
   * expires from `respawnHandler.update(frame)`.
   */
  private spawnPlatformVisuals = new Map<
    number,
    {
      readonly rect: Phaser.GameObjects.Rectangle;
      readonly glow: Phaser.GameObjects.Rectangle;
    }
  >();

  // ---- AC 60401 Sub-AC 1: per-fighter shield bubble overlay ----------------
  /**
   * One {@link ShieldBubble} per fighter slot, keyed by `playerIndex`.
   * Constructed at scene-create alongside the visual rectangle and
   * facing mark; updated each render frame from the live shield state.
   *
   * The bubble is the on-screen feedback for the shield mechanic:
   *   • Hidden while the shield is `'idle'` (no bubble).
   *   • Coloured bubble pinned to the body while the shield is `'active'`,
   *     shrinking with shield health and ramping blue → amber → red.
   *   • Strobing red / cream "shatter" ring while the shield is
   *     `'broken'`, so the punisher can read the helpless window.
   *
   * The visual derivations live in `ui/shieldBubbleFormat.ts` for unit-
   * test coverage; this scene only owns the lifecycle wiring.
   */
  private shieldBubbles = new Map<number, ShieldBubble>();

  // ---- Per-fighter charge / wind-up indicator overlay ----------------------
  /**
   * One {@link ChargeIndicator} per fighter slot, keyed by `playerIndex`.
   * Constructed at scene-create alongside the shield bubble; updated each
   * render frame from `Character.getChargeProgress()`.
   *
   * The indicator is the on-screen feedback for charge-type wind-ups
   * (Falcon-Punch-style specials, smash finishers, the heavy hammer
   * swing): a pulsing cool → hot aura ring plus a head-mounted charge bar
   * that intensify as the swing winds up. Hidden whenever the fighter is
   * not winding a move up (`getChargeProgress()` returns `null`).
   *
   * The visual derivations live in `ui/chargeIndicatorFormat.ts` for
   * unit-test coverage; this scene only owns the lifecycle wiring.
   */
  private chargeIndicators = new Map<number, ChargeIndicator>();

  // ---- Hit-feedback FX: on-contact impact spark ----------------------------
  /**
   * Pool of short-lived "hit spark" bursts (core flash + radial shards)
   * spawned at the contact point when an attack lands — the visible cue
   * that "we are hitting them". Spawned from the hitbox-damage callback
   * (the exact frame `Character.applyHit` fires) and advanced each
   * render frame off the simulated frame counter; pooled so a frantic
   * multi-hit exchange never leaks Phaser GameObjects.
   *
   * The visual derivations live in `fx/hitSparkFormat.ts` for unit
   * coverage; this scene owns the spawn-on-hit + per-frame-advance
   * lifecycle wiring. World-camera partitioned (default scrollFactor).
   */
  private hitSparkPool!: HitSparkPool;

  // ---- Hit-feedback FX: per-fighter melee swing trail ----------------------
  /**
   * One {@link SwingTrail} per fighter — a translucent streak drawn
   * along a held weapon's (sword / bat / hammer / spear) or smash
   * finisher's active-frame hitbox sweep. Fixes "the sword lands with no
   * visible arc". Tied to the real hitbox geometry so the streak never
   * overstates reach. The classification + fade live in
   * `fx/swingTrailFormat.ts`; this scene owns the per-slot lifecycle.
   */
  private swingTrails = new Map<number, SwingTrail>();

  // ---- F3 hitbox debug overlay ---------------------------------------------
  /**
   * Toggleable (F3) diagnostic layer drawing the real collision
   * geometry: active attack hitboxes (red), hurtboxes (green), and grab
   * ranges (yellow). Pure visualisation — no sim effect. Redrawn each
   * frame while enabled, cleared when disabled. The box derivation lives
   * in `fx/hitboxDebugFormat.ts`; this scene owns the F3 keybinding (the
   * F9 platform-diag pattern) and the per-frame snapshot feed.
   */
  private hitboxDebugLayer!: HitboxDebugLayer;

  /**
   * HUD hint text for the F3 toggle ("F3: hitboxes"). Lives on the HUD
   * camera (scrollFactor 0). Updated to reflect on/off state when F3 is
   * pressed; torn down on SHUTDOWN.
   */
  private hitboxDebugHintText: Phaser.GameObjects.Text | null = null;

  // ---- Sub-AC 2 of AC 60202: position-based KO detector --------------------
  /**
   * Per-tick position scan that fires a KO event the first frame a
   * fighter's centre-of-mass crosses any blast-zone edge. Pairs with
   * `BlastZoneWatcher` (collision-based) — together they catch the
   * normal sensor-touch case AND the tunnelling / replay-resync edge
   * cases the collision watcher cannot. `StockTracker.loseStock` is
   * naturally idempotent (already-respawning / already-eliminated
   * slots are no-ops), so simultaneous firings from both watchers
   * still produce exactly one stock loss per KO.
   */
  private blastZonePositionWatcher!: BlastZonePositionWatcher;

  // ---- Sub-AC 3 of AC 60003: on-screen damage HUD --------------------------
  /**
   * Bottom-strip percent meter — one panel per active fighter showing
   * the canonical Smash-style "23%" readout with a colour ramp that
   * paints kill-range damage red. Owns its own Phaser text objects so
   * the scene only needs to feed it the live percent array each render
   * frame; the legacy `p1Text` / `p2Text` debug rows still print
   * percent for engineer eyes but the casual-player contract for "the
   * fighter's current damage percentage on screen" lives here.
   */
  private damageHud!: DamageHud;

  // ---- Sub-AC 2 of AC 60002: damage tracking on hitbox connect ------------
  /**
   * Resolves `(hitbox, character)` collisions into per-target
   * `Character.applyHit` calls. Listens to the same `collisionstart`
   * stream the blast-zone watcher reads so the two adapters stay
   * symmetric. Self-hits are suppressed inside the handler; the
   * scene only has to wire targets to characters at register time.
   */
  private hitboxDamageHandler!: HitboxDamageHandler;

  // ---- AC 30001 Sub-AC 1: match-scoped seeded RNG -------------------------
  /**
   * Single deterministic RNG for the active match. Created once during
   * `create()` from the resolved match seed (MatchConfig.rngSeed →
   * boot fallback) and exposed to every gameplay subsystem via the
   * Phaser registry under `BOOT_REGISTRY_KEYS.matchRng`. Subsystems
   * pull a named substream (`matchRng.stream('ai')`,
   * `matchRng.stream('hazard')`, …) so they each get a deterministic
   * sequence that doesn't share state with any other subsystem.
   */
  private matchRng!: MatchRng;
  /**
   * Seed actually used to seed `matchRng`. Cached on the scene so the
   * debug HUD / replay header writer can read it without poking the
   * registry. Distinct from the boot-time RNG seed because a future
   * milestone (M4) will pass a custom seed via scene data when
   * replaying a match.
   */
  private matchRngSeed!: number;
  // ---- Sub-AC 4.3: match-end detection / results transition ---------------
  /**
   * Drives the ACTIVE → ENDING (GAME! hold) → READY (start ResultsScene)
   * state machine. Phaser-free so the replay tests can assert "given
   * these stock-loss frames, the match transitions to results on
   * frame N" under plain Node.
   */
  private matchEndDetector!: MatchEndDetector;

  // ---- Sub-AC 1 + Sub-AC 3 of AC 16: post-match stats ledger ---------------
  /**
   * Phaser-free per-player stats accumulator. The scene wires three
   * event sources into it:
   *
   *   1. Every {@link HitboxDamageHandler} callback feeds
   *      `recordDamage(attackerIndex, targetIndex, damage, frame)` so the
   *      "damage dealt" / "damage taken" columns mirror what the engine
   *      actually applied. Self-hits are filtered upstream and again
   *      defensively inside the tracker.
   *
   *   2. Every real stock loss (i.e. a `loseStock` call that actually
   *      decremented the slot's counter — already-eliminated / already-
   *      respawning no-ops are skipped) feeds `recordStockLoss(target,
   *      frame)`, which both bumps `deaths` and credits the KO to the
   *      attacker who damaged the target inside the attribution window.
   *
   *   3. The same path calls `recordElimination(target, frame)` when the
   *      stock-loss returned `eliminated: true`, latching the player's
   *      survival window.
   *
   * The tracker is also handed to the {@link MatchEndDetector} via its
   * `statsTracker` option so the detector finalises survival frames on
   * the canonical match-end frame and snapshots the per-player stats
   * onto the result payload — the {@link ResultsScene} reads the
   * snapshot directly to render the post-match stats panel.
   */
  private matchStatsTracker!: MatchStatsTracker;

  // ---- AC 30002 Sub-AC 2: per-frame input capture buffer ------------------
  /**
   * Records every active player's `CharacterInput` snapshot per fixed
   * physics frame, keyed by frame number. This is the input-side half
   * of the M4 hybrid replay system; the state-snapshot side lands in a
   * later sub-AC. Kept on the scene so a (future) menu action can
   * persist the buffer at match end without poking back into the
   * input handler.
   *
   * The buffer is captured BEFORE the fighters' `applyInput` call
   * each fixed step so the recorded snapshot is exactly what drove
   * physics that step — replaying the buffer back into `applyInput`
   * reproduces the same Matter integration.
   */
  private inputCaptureBuffer!: InputCaptureBuffer;
  /**
   * AC 30004 Sub-AC 4: lifecycle wrapper around `inputCaptureBuffer`.
   * Owns the IDLE → RECORDING → STOPPED state machine, captures the
   * `MatchConfig` at start, and produces the downloadable `ReplayFile`
   * on demand. The capture buffer is shared with this scene (passed in
   * via `options.buffer`) so the HUD can read live frame stats without
   * round-tripping through the controller.
   */
  private recordingController!: RecordingController;
  /**
   * The `MatchConfig` actually used for the active match. Synthesised
   * from `data.matchConfig` when supplied; otherwise built from the
   * M1-scaffold defaults (Wolf+Cat, 3 stocks, Flat Stage, current seed)
   * so the recording controller always has a complete config to write
   * into the replay header.
   */
  private activeMatchConfig!: MatchConfig;
  /**
   * AC 30003 Sub-AC 3: match-start metadata snapshot. Captured **once**
   * during `create()` immediately after the seed + canonical
   * `MatchConfig` are resolved, so `startedAt`, `engineVersion`,
   * `fixedTimestepMs`, `characterIds`, `stageId`, and `playerCount`
   * all reflect the exact "what was decided when this match began"
   * state. Read by the save flow to populate the replay structure's
   * `ReplayMetadata` block — anchoring the timestamp at match-start
   * time rather than save-press time.
   */
  private matchStartMetadata!: MatchStartMetadata;
  /**
   * Latched true when the recording controller's `stop()` has fired
   * for this match (typically on entry to the GAME! freeze). Lets the
   * update loop call `stop()` exactly once without holding a separate
   * "did we already stop?" boolean inside the controller (which is
   * idempotent but the scene also wants to know "is this the first
   * match-over tick?" for one-shot effects).
   */
  private recordingStopped = false;
  /**
   * Bottom-left HUD line driven by `recordingController.getStatus()`.
   * Reads as e.g. "REC 0:42 (2532f)" while recording, "REC STOPPED" once
   * the freeze starts, "Press S to save replay" once stopped. Pinned
   * to the viewport with `setScrollFactor(0)`.
   */
  private recordingHud!: Phaser.GameObjects.Text;
  /**
   * Transient toast shown after the player presses S — confirmation
   * that the replay was saved (or an inline error if the browser
   * download flow refused). Auto-fades after a short visible window so
   * it doesn't pollute screenshots.
   */
  private saveToast!: Phaser.GameObjects.Text;
  /**
   * Per-player layout data we need at respawn time. Keyed by
   * playerIndex (0-based to match StockTracker / BlastZoneWatcher).
   * The viewport-space spawn coords account for `StageRenderer`'s
   * design→viewport scale + offset transform.
   */
  private playerSlots!: Array<{
    readonly playerIndex: number;
    readonly character: Character;
    readonly visual: Phaser.GameObjects.Rectangle;
    readonly facingMark: Phaser.GameObjects.Triangle;
    /**
     * AC 10401 Sub-AC 1 — real sprite frame pinned over the placeholder
     * rectangle when the character spec ships with a non-null
     * `spriteKey` (Wolf, Cat in M1). The sprite owns the visible body
     * rendering: positioned to the body each render frame, flipped on
     * `facing`, alpha-strobed with the same invincibility / elimination
     * logic that drives the rectangle, and tinted by the slot's palette
     * swap (so palette-0 still reads as canonical Wolf-red / Cat-blue
     * without requiring per-palette sheets to be wired up).
     *
     * `null` when the spec's `spriteKey` is `null` (Owl / Bear during
     * M1 — they fall back to the rectangle-only renderer until their
     * generated sprite assets land).
     */
    readonly sprite: Phaser.GameObjects.Sprite | null;
    readonly spawnX: number;
    readonly spawnY: number;
    readonly faceOnSpawn: 1 | -1;
    /**
     * Sub-AC 3 of AC 13 — the runtime palette swap actually painted on
     * this slot's visuals. Resolved once at scene-create from the
     * `(characterId, paletteIndex)` pair on the slot's PlayerSlot
     * record. Cached on the slot so the spawn-platform overlay, the
     * damage HUD label, and (later AC) the post-match banner can read
     * the slot's accent colour without repeating the lookup.
     */
    readonly paletteSwap: PaletteSwap;
    /**
     * Sub-AC 2 of AC 10402 — per-fighter sprite animation state machine.
     * Polled once per render frame to classify the fighter's current
     * sprite-animation state (idle / run / jump / fall / attack / hurt)
     * and dispatch a `sprite.play()` call on actual transitions.
     *
     * `null` when the slot has no sprite (Owl / Bear during M1 — they
     * fall back to the rectangle-only renderer). The render loop checks
     * `slot.sprite !== null` before ticking, so this null is safe.
     */
    readonly spriteAnimSm: SpriteAnimationStateMachine | null;
    /**
     * AC 5 Sub-AC 3 / AC 50202 Sub-AC 2 — the per-player
     * {@link PlayerBindingsIndex} (1–4) the {@link InputBindingsStore}
     * keys this slot's bindings under. The match-scene update loop
     * resolves every fighter's `CharacterInput` via
     * `buildCharacterInputFromResolver(this.inputResolver,
     * slot.bindingsSlot)`, so the runtime input read for a fighter
     * flows through the central {@link InputResolver} against that
     * slot's live binding profile — keyboard P1, keyboard P2, gamepad
     * P3, or gamepad P4 — without any hardcoded keys or button
     * indices in the gameplay path.
     *
     * `playerIndex` is 0-based (mirroring the replay buffer / stock
     * tracker indexing); `bindingsSlot` is 1-based (mirroring the Seed
     * ontology's {@link PlayerSlot.index}). Carried separately so a
     * future custom layout (e.g. P3 in slot 0 because the M5 lobby lets
     * a single gamepad player play solo) can decouple the two without
     * scattering `+ 1` arithmetic across the gameplay loop.
     */
    readonly bindingsSlot: PlayerBindingsIndex;
  }>;
  /**
   * Cached collision-listener handle so the scene's SHUTDOWN hook can
   * detach it without leaking subscriptions across replay runs.
   *
   * A single handler fans the world's `collisionstart` stream out to
   * BOTH the blast-zone watcher (KO detection) and the hitbox damage
   * handler (Sub-AC 2 of AC 60002 — damage application). They process
   * disjoint pair shapes, so the cost of running both is bounded by
   * one extra label check per pair.
   */
  private collisionStartHandler:
    | ((event: BlastZoneCollisionEvent & HitboxCollisionEvent) => void)
    | null = null;

  /**
   * Pre-step listener that drives pass-through platform masks. Fires
   * once per Matter step BEFORE collision resolution so the masks
   * we write actually take effect this frame. Set in `create()`,
   * detached in SHUTDOWN.
   */
  private passThroughPlatformHandler: (() => void) | null = null;
  private fighterSeparationHandler: (() => void) | null = null;

  // ---- AC 14 Sub-AC 2: auto-pause on controller disconnect ----------------
  /**
   * Wires the browser's `gamepadconnected` / `gamepaddisconnected`
   * events into a per-player slot affinity table. Sub-AC 1 produced
   * this monitor; Sub-AC 2 consumes its events to drive the pause
   * controller below. Built per match (not per scene start) and
   * detached on SHUTDOWN so a re-entered scene rebuilds against the
   * latest binding store.
   */
  private gamepadConnectionMonitor: GamepadConnectionMonitor | null = null;
  /**
   * Bridges {@link gamepadConnectionMonitor} to the engine's
   * {@link PhysicsEngine} pause flag. A qualifying disconnect (a pad
   * bound to at least one human slot) freezes the simulation +
   * input sampling — both happen inside the loop's `step` callback,
   * which the pause flag short-circuits. A reconnect (or
   * `acknowledgeAndResume()`) lifts the freeze. See module docs in
   * `src/match/DisconnectPauseController.ts`.
   */
  private disconnectPauseController: DisconnectPauseController | null = null;
  /**
   * AC 14 Sub-AC 4: cross-index reconnect handler. When the same
   * physical pad reconnects at a different `gamepadIndex` — typical on
   * a USB port-swap mid-match — this handler rewrites the affected
   * slot's bindings to the new index AND nudges the disconnect-pause
   * controller to release its pause. Without it, the pause controller
   * would resume the simulation on a same-index reconnect but a
   * different-index reconnect would leave the player unresponsive
   * even though the controller is plugged back in. See module docs in
   * `src/input/ControllerReconnectionHandler.ts`.
   */
  private controllerReconnectionHandler: ControllerReconnectionHandler | null = null;
  /**
   * Sub-AC 3: structured reconnect-prompt overlay shown while the
   * disconnect-pause is engaged. Replaces the M1 single-line banner —
   * the overlay paints the affected slot label, a body-line
   * remediation hint, and a per-slot accent strip so colour-blind
   * setups still get a per-slot cue. Hidden by default; the pause
   * controller's `onPause` / `onResume` hooks call `update()` with the
   * appropriate {@link ReconnectPromptSnapshot} which drives both the
   * text and the visibility flip.
   *
   * The overlay is *not* a controller subscriber — `MatchScene` wires
   * controller events to `update(...)` so the overlay stays a passive
   * renderer. This preserves replay determinism: a recorded disconnect
   * marker re-fires the controller path on playback, which re-feeds
   * the overlay, which re-paints the same lines.
   */
  private reconnectPromptOverlay: ReconnectPromptOverlay | null = null;

  // ---- AC 10303 Sub-AC 3: stage music lifecycle ---------------------------
  /**
   * Controls the looping stage music track for the active match.
   *
   * Constructed in `create()` once the stage layout is resolved (so a
   * future per-stage music key can read `activeStage.musicKey` once
   * StageLayout grows that field) and torn down in the SHUTDOWN handler
   * so a re-entry into `MatchScene` doesn't double up the soundtrack on
   * top of itself.
   *
   * `null` only between scene-shutdown and the next `create()` — a tiny
   * guard window that the SHUTDOWN handler enforces by nulling the
   * reference after `destroy()`. Every access goes through the
   * `?.` optional-chain so a defensive double-shutdown can't NPE.
   *
   * Audio is deliberately *not* part of the deterministic gameplay
   * simulation (see `AudioManager` module docs) — a failure to mint
   * the underlying voice (asset missing from cache, audio context
   * suspended, browser autoplay policy refused the gesture) is
   * swallowed by the controller's `start()` boolean return and the
   * match continues regardless. This preserves the determinism +
   * replay-resync guarantees the gameplay path provides.
   */
  private stageMusicController: StageMusicController | null = null;

  /**
   * AC 10304 — scene-owned {@link AudioManager} for combat / movement
   * SFX. Distinct from the music AudioManager the
   * {@link StageMusicController} owns (that one drives the looping
   * soundtrack on the `music` bus): this one drives every one-shot
   * gameplay cue on the `sfx` bus and is the {@link CombatSfxSink} wired
   * into each fighter via `setSfxSink`. Mints from `this.sound` in
   * `create()`, torn down on SHUTDOWN. `null` until the audio cache is
   * confirmed present, so a preload-bypassed test scene never throws.
   *
   * Determinism: SFX playback is a presentation side-effect only —
   * fighters emit cue *requests* from the deterministic tick, but the
   * wall-clock cooldown / voice-limit / mute decisions this manager
   * makes never feed back into simulation state or the replay.
   */
  private sfxAudioManager: AudioManager | null = null;

  /**
   * AC 10304 — per-player charge-loop bookkeeping. Tracks whether the
   * looping charge hum is currently playing for a fighter so the render
   * loop can start it on the rising edge of a wind-up and stop it the
   * frame the charge ends — a looping SFX, unlike a one-shot, needs an
   * explicit stop. Keyed by `playerIndex`.
   */
  private readonly chargeLoopActive = new Map<number, boolean>();

  /** HUD toggle in the upper-right corner that mutes / unmutes stage music. */
  private musicToggleButton: Phaser.GameObjects.Text | null = null;

  // ---- T3 items framework (AC 90302) -------------------------------------
  /**
   * Deterministic per-match item-spawn scheduler. Constructed in
   * `create()` once the active stage layout (anchors) and active
   * `MatchConfig` (frequency dial + match-scoped {@link MatchRng}) are
   * resolved, ticked once per fixed-step inside the simulation callback,
   * and torn down in the SHUTDOWN handler so a re-entry into MatchScene
   * starts with a clean schedule.
   *
   * `null` only between scene-shutdown and the next `create()` — every
   * access goes through the `?.` optional chain so a defensive double-
   * shutdown can't NPE. The manager itself has no `destroy()` method
   * (it's Phaser-free, owns no Matter bodies, and pulls its RNG
   * substream from the match-scoped {@link MatchRng} which is reset
   * separately) — teardown is just nulling the reference.
   *
   * The spawn requests returned from `step()` are the contract a later
   * sub-AC consumes to instantiate concrete item entities. Sub-AC 2 of
   * AC 90302 only wires the lifecycle — the requests are intentionally
   * discarded here so the `'item-spawn'` RNG substream stays anchored
   * to the correct match-start tick once the item-entity layer lands;
   * a future sub-AC swaps the discard for a real `spawnItemAt(req)`
   * callsite without touching the lifecycle wiring established here.
   */
  private itemSpawnManager: ItemSpawnManager | null = null;

  /**
   * T3 (AC 10-19) — live items registry, replay event log, and the
   * round-robin item-type roulette used at spawn time. The registry
   * tracks every active item; the event log records each spawn with
   * (type, position, tick) so the M4 replay system reproduces the
   * exact same item history. The type roulette walks bat → rayGun →
   * bomb in a deterministic cycle keyed off the spawn-RNG so two
   * replays of the same match see the same item sequence.
   */
  private itemRegistry: ItemRegistry = new ItemRegistry();
  private itemSpawnEventLog: ItemSpawnEventLog = new ItemSpawnEventLog();
  private itemSpawnTypeIndex = 0;
  /**
   * T3 (AC 11) — per-fighter inventory map. Populated at fighter-spawn
   * time; consumed by the pickup / throw input handlers. Kept on the
   * scene so the (deferred) Phaser-side adapter that wires
   * collision-pickup events can look up a holder's inventory by
   * player index without re-deriving the mapping.
   */
  private inventoriesByPlayerIndex: Map<number, Inventory> = new Map();

  /**
   * T3 (AC 11) — pickup proximity controller. Stateless across calls;
   * one shared instance per match is the canonical wiring.
   */
  private readonly pickupController = new PickupController();

  /**
   * T3 (AC 12) — throw resolution controller. Stateless across calls;
   * one shared instance per match.
   */
  private readonly throwController = new ThrowController();

  /**
   * Phaser visual handles for live items, keyed by entity id. Created
   * at spawn time, position-synced per frame from the entity's
   * deterministic snapshot, destroyed when the registry reports the
   * entity despawned. The data layer (registry + lifecycle + replay
   * log) stays Phaser-free — these visuals are pure render glue.
   */
  private readonly itemVisuals: Map<number, Phaser.GameObjects.Container> = new Map();

  /**
   * Per-item surface Y in design coordinates. Captured at spawn time
   * from the picked anchor so the falling-simulation tick knows when
   * to flip the entity from `falling` → `grounded`.
   */
  private readonly itemSurfaceY: Map<number, number> = new Map();

  /**
   * Per-item visual fall y in design coordinates while in `falling`
   * state. The entity's snapshot position stays frozen at spawn
   * during fall (the data layer treats falling as a binary "in-
   * transit" lifecycle stage), so the cosmetic gravity animation
   * lives here, advancing by a fixed delta per tick. Determinism
   * holds — same FALL_VELOCITY_PER_TICK + same drop-height gives the
   * same grounding frame across replays.
   */
  private readonly itemFallingY: Map<number, number> = new Map();

  /**
   * Live projectiles spawned by `specialKind: 'projectile'` neutral-
   * specials (Cat shuriken, Owl feather-bolt). Each carries its own
   * damage + knockback into the hit pipeline and despawns on contact
   * or after its lifetime expires. Pure design-coordinate runtime —
   * the AABB hit-check + visual sync happen in the per-frame block.
   */
  private projectiles: Array<{
    id: number;
    ownerSlotIndex: number;
    moveId: string;
    facing: 1 | -1;
    damage: number;
    knockback: { x: number; y: number; scaling: number };
    x: number;
    y: number;
    vx: number;
    vy: number;
    width: number;
    height: number;
    framesRemaining: number;
    container: Phaser.GameObjects.Container;
    spawnedThisFrameByMove: string;
  }> = [];

  private nextProjectileId = 0;

  /**
   * Per-slot tracker so we only spawn ONE projectile per
   * (slot, move) attack lifecycle. Keyed by `${playerIndex}:${moveId}`
   * → the elapsed-frames value at spawn time. Cleared when the move
   * leaves its active window or another attack starts.
   */
  private projectileSpawnLatch: Set<string> = new Set();

  /**
   * Previous-frame `grab` button state per slot — used to detect the
   * grab-press rising edge that fires a throw while holding an item.
   * The rebinding store doesn't ship a dedicated `'throw'` action, so
   * we hijack `grab` while the holder has an item in hand.
   */
  private prevGrabHeld: Map<number, boolean> = new Map();

  /**
   * Per-slot "suppress attack until release" latch (post-pickup-bug fix).
   *
   * On a successful item pickup the runtime sets this to `true`. Each
   * subsequent fixed step the attack input is forced to `false` until
   * the player RELEASES the attack button — at which point the latch
   * clears and the next press fires normally.
   *
   * Without this, picking up a bomb while still holding attack would
   * fire the bomb's slot-override (= detonation) on the very next
   * frame because the rising-edge detector saw the held button as a
   * fresh press once the pickup-frame `attack: false` override
   * cleared.
   */
  private suppressAttackUntilRelease: Map<number, boolean> = new Map();

  /**
   * Active thrown items — flying through the air after being launched
   * via the throw key. Each carries its own hit-check + consume-on-
   * impact behaviour from the item's `throwBehavior`. Bomb explodes
   * on first contact via its `attackMoves[0]` AoE; Bat / RayGun do
   * a simple knockback hit and then despawn.
   */
  private thrownItems: Array<{
    entity: ItemEntity;
    ownerSlotIndex: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    framesRemaining: number;
    consumeOnImpact: boolean;
    container: Phaser.GameObjects.Container;
  }> = [];

  /**
   * Per-slot transient swing-flash entries. Active for a few frames
   * after a held-item slot override fires, so the player can see the
   * bat swing connect even without a sprite animation.
   */
  private swingFlashes: Array<{
    container: Phaser.GameObjects.Rectangle;
    framesRemaining: number;
  }> = [];

  /**
   * Active bomb-detonation explosion sprites. Each burst plays the
   * 3-frame `ASSET_KEYS.itemExplosion` strip (flash → fireball →
   * smoke) over 18 frames (~300 ms at 60 Hz), advancing `frame` on
   * each 6-frame interval and fading via alpha. Removed from the
   * array + destroyed when `framesRemaining` reaches 0.
   */
  private explosionBursts: Array<{
    sprite: Phaser.GameObjects.Sprite;
    framesRemaining: number;
  }> = [];

  /**
   * One-shot procedural BURST flashes — an expanding, fading ring. Used
   * for the down-special dive LANDING shockwave (so a whiffed dive that
   * fires no collisionstart still flashes) and the charge-beam MUZZLE
   * flash. Render-only: each entry's radius/alpha are pure functions of
   * its age (no RNG), so replays paint identically. Positions are baked at
   * spawn (raw world coords for fighter-anchored bursts, stage-transformed
   * for the design-space cannon origin).
   */
  private oneShotBursts: Array<{
    arc: Phaser.GameObjects.Arc;
    framesRemaining: number;
    lifetime: number;
    baseRadius: number;
    growth: number;
  }> = [];

  /**
   * Spawn a one-shot expanding burst flash at an ALREADY-SCREEN-SPACE
   * point. Render-only; the {@link oneShotBursts} tick grows the radius
   * and fades the alpha to zero over `lifetime` frames. Callers bake the
   * coordinate space (raw world for fighter-anchored, stage-transformed
   * for design-space) before calling.
   */
  private spawnBurst(
    screenX: number,
    screenY: number,
    color: number,
    baseRadius: number,
    lifetime: number,
    growth: number,
    depth: number,
  ): void {
    const arc = this.add.circle(screenX, screenY, baseRadius, color, 0.8).setDepth(depth);
    this.oneShotBursts.push({ arc, framesRemaining: lifetime, lifetime, baseRadius, growth });
  }

  /** Advance + expire every one-shot burst flash. Render-only. */
  private tickOneShotBursts(): void {
    if (this.oneShotBursts.length === 0) return;
    const survivors: typeof this.oneShotBursts = [];
    for (const b of this.oneShotBursts) {
      b.framesRemaining -= 1;
      const age = b.lifetime - b.framesRemaining;
      b.arc.setRadius(Math.max(0.5, b.baseRadius + age * b.growth));
      b.arc.setAlpha(Math.max(0, b.framesRemaining / b.lifetime) * 0.8);
      if (b.framesRemaining <= 0) b.arc.destroy();
      else survivors.push(b);
    }
    this.oneShotBursts = survivors;
  }

  /** Read-only access to the inventory map (test / replay scrubber). */
  getInventory(playerIndex: number): Inventory | null {
    return this.inventoriesByPlayerIndex.get(playerIndex) ?? null;
  }

  /** Test / replay accessor for the pickup controller. */
  getPickupController(): PickupController {
    return this.pickupController;
  }

  /** Test / replay accessor for the throw controller. */
  getThrowController(): ThrowController {
    return this.throwController;
  }

  constructor() {
    super({ key: 'MatchScene' });
  }

  /**
   * T3 (AC 17) — read-only access to the per-match item-spawn event
   * log. The replay serializer captures `getItemSpawnEvents()` at
   * match-end so the saved replay deterministically reconstructs the
   * exact item history on playback.
   */
  getItemSpawnEvents() {
    return this.itemSpawnEventLog.getEntries();
  }

  /** T3 (AC 17) — debug accessor for tests / replay tooling. */
  getItemRegistry(): ItemRegistry {
    return this.itemRegistry;
  }

  /**
   * T3 — pick the next item type to spawn from a deterministic roster
   * roulette. The {@link MatchRng}'s `'item-spawn'` substream already
   * picks anchor + interval; we reuse the same canonical
   * `ItemSpawnManager.step()` flow and just rotate the type per spawn.
   * Two replays produce identical type sequences because the rotation
   * counter is private state that the snapshot writer captures.
   */
  private nextItemType(): ItemDefinition {
    const roster = [
      BAT_DEFINITION,
      SWORD_DEFINITION,
      HAMMER_DEFINITION,
      SPEAR_DEFINITION,
      RAY_GUN_DEFINITION,
      BOMB_DEFINITION,
    ] as const;
    const def = roster[this.itemSpawnTypeIndex % roster.length]!;
    this.itemSpawnTypeIndex += 1;
    return def;
  }

  /**
   * Initialise the match-scoped seeded RNG before any gameplay
   * subsystem runs. Called at the very top of `create()` so AI,
   * hazards, particle effects — any subsystem that needs randomness
   * — can pull from `this.matchRng` knowing the seed has already been
   * captured deterministically.
   *
   * Resolution order (handled by `initialiseMatchRngFromConfig`):
   *   1. `data.matchConfig.rngSeed` — explicit per-match seed passed
   *      by the menu / replay player.
   *   2. `data.rngSeed` — convenience shortcut for callers that only
   *      have a seed, not a full MatchConfig (used by the upcoming
   *      M4 replay player and by tests).
   *   3. The boot RNG seed stashed in the registry — fallback for
   *      "press ENTER to fight" dev mode.
   *   4. `GAME_CONFIG.defaultRngSeed` if even the registry is empty
   *      (e.g. when MatchScene is started directly from a test
   *      harness that bypassed BootScene).
   *
   * The resolved `{ seed, rng }` is then mirrored into the registry
   * under `BOOT_REGISTRY_KEYS.matchRng` / `matchRngSeed` so any other
   * scene or subsystem can read the same single source.
   */
  private initialiseMatchSeed(
    data: MatchSceneData | undefined,
  ): void {
    const registrySeed = this.registry.get(BOOT_REGISTRY_KEYS.rngSeed) as
      | number
      | undefined;
    const fallbackSeed =
      typeof registrySeed === 'number' && Number.isFinite(registrySeed)
        ? registrySeed
        : GAME_CONFIG.defaultRngSeed;

    // Prefer an explicit MatchConfig.rngSeed; otherwise let an ad-hoc
    // `data.rngSeed` shortcut win; otherwise fall back to the boot
    // seed. This three-step ladder is exhaustive because the Seed's
    // `MatchConfig` always carries a seed once the menu wires up
    // (M2+) — the shortcut + fallback only matter during the M1
    // scaffold where MatchScene is started without scene data.
    const configSeed =
      data?.matchConfig?.rngSeed ??
      (typeof data?.rngSeed === 'number' ? data.rngSeed : undefined);

    const { seed, rng } = initialiseMatchRngFromConfig(
      configSeed === undefined ? null : { rngSeed: configSeed },
      fallbackSeed,
    );
    this.matchRng = rng;
    this.matchRngSeed = seed;

    // Mirror into the Phaser registry so subsystems that don't have a
    // direct reference to the scene (e.g. a stage's hazard controller
    // built from a static factory) can still pull the same RNG.
    this.registry.set(BOOT_REGISTRY_KEYS.matchRng, rng);
    this.registry.set(BOOT_REGISTRY_KEYS.matchRngSeed, seed);

    // One-line banner — useful when a player files a bug ("seed
    // 0xc0ffee desyncs after 12 s"). Reading the live RNG here also
    // anchors the field as a real consumer instead of dead state.
    // eslint-disable-next-line no-console
    console.info(
      `[match-init] seed=0x${seed.toString(16).padStart(8, '0')} ` +
        `streams=${this.matchRng.listStreams().length}`,
    );
  }

  /**
   * Public accessor for the match-scoped seeded RNG. AI / hazard /
   * particle controllers built later in `create()` (or in a child
   * helper class) call this to obtain a deterministic substream:
   *
   *   const aiRng = scene.getMatchRng().stream('ai');
   *
   * Always returns the same MatchRng instance for the duration of the
   * match — replaced only on the next `create()` call, which captures
   * a fresh seed.
   */
  getMatchRng(): MatchRng {
    return this.matchRng;
  }

  /**
   * Public accessor for the captured match seed. Mirrors what's stored
   * under `BOOT_REGISTRY_KEYS.matchRngSeed` in the Phaser registry; we
   * expose it on the scene so subsystems with a direct scene reference
   * don't have to reach through the registry just to log the seed.
   */
  getMatchRngSeed(): number {
    return this.matchRngSeed;
  }

  /**
   * Public accessor for the live input capture buffer. AC 30002 Sub-AC 2.
   * Exposed for the (later-AC) replay export path so a menu action can
   * persist the log without poking into private fields. Returns the
   * same instance for the lifetime of the active match — re-created
   * on each `create()` call.
   */
  getInputCaptureBuffer(): InputCaptureBuffer {
    return this.inputCaptureBuffer;
  }

  /**
   * Public accessor for the recording controller. AC 30004 Sub-AC 4.
   * Exposed so the menu / debug UI / integration tests can drive the
   * save flow without holding a reference to the scene's private state.
   */
  getRecordingController(): RecordingController {
    return this.recordingController;
  }

  /**
   * Public accessor for the synthesised `MatchConfig` driving the
   * active match. Useful for HUD overlays + integration tests.
   */
  getActiveMatchConfig(): MatchConfig {
    return this.activeMatchConfig;
  }

  /**
   * AC 30003 Sub-AC 3: public accessor for the match-start metadata
   * snapshot. Captured once at match start; `startedAt` /
   * `engineVersion` / `fixedTimestepMs` / `characterIds` / `stageId` /
   * `playerCount` all reflect the values that were live when the
   * match began. Tests + the (later-AC) replay browser read this
   * instead of re-deriving the fields from scattered subsystems.
   */
  getMatchStartMetadata(): MatchStartMetadata {
    return this.matchStartMetadata;
  }

  /**
   * Resolve the `MatchConfig` for the active match. Prefers an
   * explicit `data.matchConfig` from the menu / replay player; falls
   * back to a synthesised M1-scaffold config built from the actual
   * gameplay setup (Wolf+Cat, 3 stocks, Flat Stage, current seed) so
   * the replay header always carries a complete config — even from
   * the "press ENTER to fight" dev mode. The seed is always the one
   * captured by `initialiseMatchSeed` so the recording's `rngSeed`
   * matches the live `MatchRng`.
   */
  private resolveActiveMatchConfig(data: MatchSceneData | undefined): MatchConfig {
    if (data?.matchConfig) {
      // Re-emit with the resolved seed so the replay header reflects
      // what the live RNG was actually built from (the menu may have
      // passed a finite-but-unclamped seed; `initialiseMatchSeed`
      // clamped it).
      return Object.freeze({
        ...data.matchConfig,
        rngSeed: this.matchRngSeed,
      });
    }
    // M1-scaffold default: 2P keyboard match, Wolf vs Cat, 3 stocks,
    // Flat Stage. Mirrors the actual subsystems wired up above.
    const players: PlayerSlot[] = [
      Object.freeze({
        index: 1,
        characterId: 'wolf',
        paletteIndex: 0,
        inputType: 'keyboard_p1',
      }) as PlayerSlot,
      Object.freeze({
        index: 2,
        characterId: 'cat',
        paletteIndex: 0,
        inputType: 'keyboard_p2',
      }) as PlayerSlot,
    ];
    return Object.freeze({
      mode: 'stocks',
      stockCount: DEFAULT_STOCK_COUNT,
      // Use whichever stage was actually resolved at scene-create
      // time so the synthesised config matches the live geometry.
      // Falls back to FLAT_STAGE when the scene starts before
      // `activeStage` is initialised (e.g. in a test fixture that
      // synthesises the config independently).
      stageId: this.activeStage?.id ?? FLAT_STAGE.id,
      players: Object.freeze(players),
      rngSeed: this.matchRngSeed,
    });
  }

  /**
   * Save-to-file action — AC 30004 Sub-AC 4. Builds the replay file
   * artifact from the controller's captured state and triggers the
   * browser download. The result is reported back via the on-screen
   * `saveToast` so the player gets unmissable confirmation.
   *
   * Behaviour:
   *   • IDLE / RECORDING — the controller refuses to build a file mid-
   *     recording (a partial replay is almost always a bug). We auto-
   *     stop here so a player who hits S during the fight still gets
   *     an artifact covering everything up to that frame.
   *   • STOPPED — the typical post-match path; produces the file.
   *   • Browser-less / DOM-less — caught and reported via toast so the
   *     scene doesn't crash in headless tests.
   *
   * Idempotent on the controller — saving twice produces two
   * downloadable files reading the same captured frames.
   */
  saveReplayToFile(): void {
    try {
      // Auto-stop so a mid-match save still works. The controller's
      // `stop()` is idempotent so the post-match path is unaffected.
      if (this.recordingController.isRecording()) {
        this.recordingController.stop();
        this.recordingStopped = true;
      }
      const replay = this.recordingController.buildReplayFile();
      const fileName = this.recordingController.suggestFileName();
      const result = downloadReplayFile(replay, { fileName });
      this.showSaveToast(`Saved ${result.fileName} (${result.byteLength} B)`);
    } catch (err) {
      const msg =
        err instanceof DownloadReplayUnsupportedError
          ? 'Save unavailable in this browser'
          : err instanceof Error
            ? err.message
            : String(err);
      this.showSaveToast(`Save failed: ${msg}`);
    }
  }

  /**
   * AC 14 Sub-AC 3: paint the structured reconnect-prompt overlay
   * when the pause controller engages. The overlay names the affected
   * slot(s), spells out remediation copy ("Plug the controller back in
   * to resume…"), and tints its accent strip to the first affected
   * slot's palette colour so a player whose colour-blind setup blurs
   * the headline still gets a per-slot cue.
   *
   * Called from {@link disconnectPauseController}'s `onPause` hook —
   * each qualifying disconnect re-fires the hook with an updated
   * `affectedSlotsTotal`, so a multi-pad pull-out paints e.g.
   * "P3 + P4 — Controllers disconnected" without the scene having to
   * remember earlier events. The overlay's `update()` is idempotent so
   * a re-fire with identical state is a no-op apart from text writes.
   */
  private showDisconnectBanner(event: DisconnectPauseEvent): void {
    if (!this.reconnectPromptOverlay) return;
    const padLabels =
      event.gamepadId.length > 0 ? [event.gamepadId] : null;
    this.reconnectPromptOverlay.update({
      affectedSlots: event.affectedSlotsTotal,
      padLabels,
      phase: 'waiting',
    });
  }

  /**
   * AC 14 Sub-AC 3: handle the controller's resume signal — either a
   * full reconnect (every tracked pad back), a partial reconnect (one
   * pad back, others still missing), or an explicit acknowledge
   * (player chose to keep playing). The overlay's `update()`
   * deterministically picks the right phase from the resume payload:
   *
   *   • partial reconnect (`pauseReleased === false`) → 'partial-reconnect'
   *   • full reconnect (`reason === 'reconnect'`)      → 'reconnected'
   *   • manual acknowledge                             → 'acknowledged'
   */
  private hideDisconnectBanner(event: DisconnectResumeEvent): void {
    if (!this.reconnectPromptOverlay) return;
    if (!event.pauseReleased) {
      this.reconnectPromptOverlay.update({
        affectedSlots: event.remainingAffectedSlots,
        phase: 'partial-reconnect',
      });
      return;
    }
    if (event.reason === 'acknowledge') {
      this.reconnectPromptOverlay.showAcknowledged();
    } else {
      this.reconnectPromptOverlay.showResumed();
    }
  }

  /**
   * AC 14 Sub-AC 4: react to a controller-rebind event from the
   * reconnection handler. Two cases:
   *
   *   • The pad came back at the SAME index — `bindingsRebound:false`,
   *     `originalGamepadIndex === newGamepadIndex`. The pause
   *     controller already released the pause via its normal index-
   *     keyed path; the overlay is being driven by `hideDisconnectBanner`
   *     so we have nothing extra to paint. We still log the event so
   *     a bug report's console trail can show the reconnect was
   *     observed end-to-end.
   *   • The pad came back at a DIFFERENT index — `bindingsRebound:true`.
   *     The handler has already rewritten the binding table and
   *     forwarded a synthetic connect for the original index, so the
   *     pause controller's `onResume` fires and the overlay flashes
   *     "Resuming match…" via the existing path. We log the rebind so
   *     a desync investigator can correlate "P3 pressed nothing for
   *     30 frames" with the pad's index swap.
   *
   * Render-only side effect — no replay-affecting state change. The
   * binding rewrite has already been applied to the shared
   * `InputBindingsStore`, which the dispatcher reads from on the next
   * sample, and the handler's synthetic emit lives entirely inside
   * the deterministic monitor-event stream.
   */
  private handleControllerRebind(event: ControllerRebindEvent): void {
    if (event.bindingsRebound) {
      // eslint-disable-next-line no-console
      console.info(
        `[MatchScene] Controller "${event.gamepadId}" reconnected at pad index ${event.newGamepadIndex} (was ${event.originalGamepadIndex}); rebound slots ${event.affectedSlots.join(', ')}.`,
      );
    }
  }

  /**
   * Find or build the shared {@link InputBindingsStore} on the Phaser
   * registry. The rebinding scene also reads / writes this store, so
   * any rebind the player committed before pressing FIGHT is reflected
   * in the gamepad-connection monitor's per-slot affinity table. We
   * lazily create a defaults-only store when no rebinding has happened
   * yet — keeps the M1 dev-mode path working without forcing a visit
   * to the rebinding screen.
   *
   * AC 40302 Sub-AC 2 — resolution priority mirrors
   * {@link RebindingScene.acquireBindingsStore}:
   *
   *   1. {@link BindingsPersistenceLifecycle} (the M5 auto-save lifecycle
   *      seeded by `BootScene.initialiseEngineSystems`). The lifecycle
   *      owns the store the rebinding screen mutates and persists to
   *      `localStorage` after every committed capture, so the dispatcher
   *      below reads from the *exact same instance* the player just
   *      remapped against. The inner store is also mirrored back onto
   *      the legacy `inputBindingsStore` slot so any older code path
   *      reaching for the bare-store key still sees the same instance.
   *   2. Legacy `inputBindingsStore` registry slot (still populated by
   *      {@link BootScene} for back-compat, and used by tests that boot
   *      straight into the match scene without the lifecycle).
   *   3. Defaults-only store as the last-resort fallback (an isolated
   *      unit test that constructs a `MatchScene` without booting the
   *      engine).
   *
   * The shared instance is what makes the wiring transitive: a rebind
   * committed in the rebinding screen → mutates the lifecycle's inner
   * store → is read on the very next sample by the dispatcher / input
   * service / character controller below, with no extra reload step.
   */
  private acquireBindingsStore(): InputBindingsStore {
    const lifecycle = this.registry.get(BOOT_REGISTRY_KEYS.bindingsLifecycle) as
      | BindingsPersistenceLifecycle
      | undefined;
    if (lifecycle instanceof BindingsPersistenceLifecycle) {
      const store = lifecycle.getStore();
      // Mirror the inner store on the legacy registry slot so any other
      // scene that still reads `inputBindingsStore` directly (controller
      // reconnection, gamepad-connection monitor wiring inside this same
      // scene, future legacy callers) sees the same instance the
      // lifecycle owns. Idempotent — `set` with the same value is a no-op.
      this.registry.set(BOOT_REGISTRY_KEYS.inputBindingsStore, store);
      return store;
    }
    const existing = this.registry.get(BOOT_REGISTRY_KEYS.inputBindingsStore) as
      | InputBindingsStore
      | undefined;
    if (existing instanceof InputBindingsStore) {
      return existing;
    }
    const store = new InputBindingsStore();
    this.registry.set(BOOT_REGISTRY_KEYS.inputBindingsStore, store);
    return store;
  }

  private showSaveToast(message: string): void {
    if (!this.saveToast) return;
    this.saveToast.setText(message).setVisible(true).setAlpha(1);
    // Fade the toast over ~2 s so it doesn't pollute screenshots. We
    // re-use Phaser's tween system (which is wall-clock driven, NOT
    // simulation-driven) because the toast lives entirely in the
    // render layer — it has zero feedback into gameplay.
    if (this.tweens) {
      this.tweens.add({
        targets: this.saveToast,
        alpha: 0,
        delay: 1500,
        duration: 600,
        onComplete: () => this.saveToast.setVisible(false),
      });
    }
  }

  /**
   * Sub-AC 1 + Sub-AC 3 of AC 16 — single entry point for "lose a
   * stock" that fans the event into both the {@link StockTracker}
   * (which owns the canonical stocks-remaining count, respawn schedule,
   * and elimination flag) and the {@link MatchStatsTracker} (which
   * owns deaths / KO attribution / survival latching).
   *
   * Why a helper instead of inlining the two calls into each watcher
   * callback:
   *
   *   • `MatchStatsTracker.recordStockLoss` blindly increments
   *     `deaths`, but `StockTracker.loseStock` is a no-op for
   *     already-eliminated and already-respawning slots. We must skip
   *     the stats call in those cases, otherwise a body lingering at
   *     the blast-zone edge for >1 frame would inflate the death count.
   *     Comparing `stocksRemaining` before vs. after the tracker call
   *     is the cheapest precise gate — `loseStock` returns
   *     `stocksRemaining: before` on a no-op and `before - 1` on a
   *     real loss, so a single comparison cleanly separates the cases.
   *
   *   • The same gating logic must apply to the BlastZoneWatcher,
   *     BlastZonePositionWatcher, AND LavaCollisionWatcher callbacks.
   *     Inlining would triple-duplicate the gate; a helper centralises
   *     it.
   *
   *   • `recordElimination` is gated on the tracker's `eliminated`
   *     flag — only fires when the loss actually drained the slot's
   *     final stock. Idempotent on the tracker side, but we still
   *     guard with `event.eliminated` so a no-op `loseStock` doesn't
   *     latch survival on a corpse-lingering frame.
   *
   * Returns the same {@link StockLossEvent} the tracker produced so
   * future callers (e.g. the M2 sudden-death controller) can chain
   * additional logic off the same call site.
   */
  private recordStockLossWithStats(
    playerIndex: number,
    frame: number,
  ): ReturnType<StockTracker['loseStock']> {
    const stocksBefore = this.stockTracker.getStocks(playerIndex);
    const event = this.stockTracker.loseStock(playerIndex, frame);
    if (event.stocksRemaining < stocksBefore) {
      this.matchStatsTracker.recordStockLoss(playerIndex, frame);
      if (event.eliminated) {
        this.matchStatsTracker.recordElimination(playerIndex, frame);
      }
      // AC 10304 — voice the trademark Smash "blast" KO cue on every
      // REAL stock loss. Gated on the same `stocksRemaining < before`
      // branch the stats ledger uses, so a duplicate blast-zone
      // collision on a body lingering past the boundary (a no-op
      // `loseStock`) can't double-fire the boom. Routed through the
      // scene's SFX AudioManager; `emitCombatSfx` swallows any backend
      // error. This call sits in the deterministic stock-loss path but
      // the audio it requests is a pure side-effect that never alters
      // the StockTracker / replay state.
      emitCombatSfx(this.sfxAudioManager ?? undefined, ASSET_KEYS.sfxKo);
    }
    return event;
  }

  create(data?: MatchSceneData): void {
    // Phaser REUSES the scene instance across `scene.start('MatchScene')`
    // calls, so instance fields survive a scene swap. The pause flags must
    // be reset on every (re-)entry: without this, opening the pause menu
    // (`pausedForMenu = true`) and then leaving the match — to the character
    // picker or a rematch — re-enters this same instance still flagged
    // paused, so the new match boots FROZEN (the `if (pausedForMenu) return`
    // guard in update() never advances the loop) and the player can't move.
    this.pausedForMenu = false;
    this.prevStartHeld = false;
    this.prevLedgeKeys.clear();

    // ---- AC 30001 Sub-AC 1: capture the match seed FIRST -----------------
    // Done before *any* other subsystem is constructed so a future
    // hazard or AI controller built deeper in this method can call
    // `this.matchRng.stream('hazard')` without a chicken-and-egg
    // ordering problem.
    this.initialiseMatchSeed(data);

    const { width, height } = this.scale.gameSize;

    // Title is a HUD overlay, so we pin it to the viewport with
    // `setScrollFactor(0)` — the camera now pans + zooms (Sub-AC 2.3),
    // and the title would otherwise drift with the world.
    this.add
      .text(width / 2, 40, 'Flat Stage — P1 (WASD+F) vs P2 (Arrows+Num1)', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#a0a0b8',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0);

    // ---- Deterministic loop ------------------------------------------------
    this.physicsEngine = new PhysicsEngine();

    // Disable Phaser's auto-step of the Matter world — we drive it ourselves
    // at a fixed 16.67 ms cadence so replays are deterministic.
    this.matter.world.autoUpdate = false;

    // ---- Active stage resolution (Sub-AC 3 of AC 9 + AC 20104 Sub-AC 4) -
    // Three paths, in priority order:
    //
    //   1. AC 20104 Sub-AC 4 — explicit `customStage` payload from the
    //      Stage Select scene. Convert it to a runtime `StageLayout`
    //      via the M3 loader and use that. Highest priority because
    //      the caller has already loaded + validated the saved blob.
    //
    //   2. AC 20104 Sub-AC 4 — `matchConfig.stageId` of the form
    //      `'custom:<slot-id>'`. Round-trip the slot id through
    //      `loadCustomStage` so the (future) replay-loader can re-
    //      enter a match without having to pre-load the blob itself.
    //      Falls back to FLAT_STAGE if the load fails (deleted save,
    //      corrupted blob, missing localStorage) so the match still
    //      starts rather than crashing the player into the menu.
    //
    //   3. Built-in registry path — the M2 behaviour. Look up
    //      `matchConfig.stageId` in the `STAGES` map; fall back to
    //      FLAT_STAGE for unknown / missing ids.
    const requestedStageId = data?.matchConfig?.stageId;
    if (data?.customStage) {
      const runtimeId =
        requestedStageId && isCustomStageId(requestedStageId)
          ? requestedStageId
          : undefined;
      this.activeStage = customStageDataToStageLayout(data.customStage, {
        runtimeIdOverride: runtimeId,
      });
    } else if (requestedStageId && isCustomStageId(requestedStageId)) {
      const slotId = customStageSlotIdFromRuntimeId(requestedStageId);
      const loaded = loadCustomStage(slotId);
      if (loaded.ok) {
        this.activeStage = customStageDataToStageLayout(loaded.value, {
          runtimeIdOverride: requestedStageId,
        });
      } else {
        // The saved-stage load failed — log and fall back to FLAT_STAGE.
        // We don't crash because the match flow has already committed
        // to starting; a graceful fallback lets the player see "the
        // custom stage is gone" via the rendered stage banner rather
        // than a stack trace.
        console.warn(
          `MatchScene: failed to load custom stage '${slotId}' (${loaded.code}: ${loaded.error}); falling back to FLAT_STAGE.`,
        );
        this.activeStage = FLAT_STAGE;
      }
    } else if (
      requestedStageId &&
      Object.prototype.hasOwnProperty.call(STAGES, requestedStageId)
    ) {
      this.activeStage = getStage(requestedStageId);
    } else {
      this.activeStage = FLAT_STAGE;
    }

    // ---- Stage runtime (AC 20101 Sub-AC 1 — BaseStage) ------------------
    // BaseStage encapsulates the stage's geometry loading (platforms +
    // blast-zone sensor walls), spawn-point conversion, hazard
    // renderers (lava + wind), hazard collision adapters, and the
    // per-frame lifecycle hooks the gameplay loop drives below. The
    // KO + force callbacks are wired upfront so the watcher's
    // construction is identical to the previous handcrafted wiring —
    // every stock loss / wind force still flows through the same
    // tracker / matter velocity nudge.
    //
    // Forwarding `drawBlastZone: true` keeps the M1/M2 dev-mode
    // visualisation of the four blast-zone bands. The lava + wind
    // listeners are constructed lazily here (closures over `this` are
    // only invoked from inside the BaseStage's tick path); the
    // BaseStage itself decides whether to wire them based on the
    // layout's `hazards` array, so a flat-stage match still pays
    // zero hazard cost.
    // ---- Themed parallax background -------------------------------------
    // Painted BEFORE the stage geometry so the gradient + silhouette
    // layers (depth −60…−30, scrollFactor 0) sit behind every platform.
    // The handle's tick()/updateParallax() hooks are driven from the
    // fixed-step loop and the per-render-frame camera read below.
    this.stageBackground = renderStageBackground(this, this.activeStage);

    this.baseStage = new BaseStage(this, this.activeStage, {
      renderOptions: { drawBlastZone: false },
      onLavaKo: (playerIndex) => {
        // Same instant-KO pipeline as the legacy LavaCollisionWatcher
        // wiring: route through the stats-aware stock-loss helper so
        // the post-match stats panel sees the lava-KO too.
        this.recordStockLossWithStats(
          playerIndex,
          this.physicsEngine.getFrame(),
        );
      },
      onWindForce: (playerIndex, _hazardId, force) => {
        // Resolve the live fighter body and nudge velocity. Slot 0 = P1
        // (Wolf), slot 1 = P2 (Cat). Same body lookup the old
        // WindForceController callback used.
        const body =
          playerIndex === 0
            ? this.p1?.body
            : playerIndex === 1
              ? this.p2?.body
              : null;
        if (!body) return;
        // Skip eliminated slots so a corpse body doesn't drift on
        // gusts after KO. Mirrors the lava watcher's handling.
        if (this.stockTracker?.isEliminated(playerIndex)) return;
        this.matter.body.setVelocity(body, {
          x: body.velocity.x + force.x,
          y: body.velocity.y + force.y,
        });
      },
    });
    // Project the BaseStage's owned RenderedStage / hazard handles
    // onto the existing scene fields so the rest of `create()` /
    // `update()` / SHUTDOWN — which still references `this.stage`,
    // `this.lavaHazards`, etc. directly — continues to work without
    // a sweeping rename. Future ACs should prefer
    // `this.baseStage.<...>` for new code paths.
    this.stage = this.baseStage.rendered;

    // Compute the design→viewport transform once so spawn points and
    // any other design-space coordinates land on the rendered stage
    // even on smaller laptop viewports. The BaseStage caches the same
    // transform internally — read it through the stage so the value
    // can never drift from what the renderer used.
    const designOffsetX = this.baseStage.transform.offsetX;
    const designOffsetY = this.baseStage.transform.offsetY;

    // ---- Matter world bounds (Sub-AC 3 of AC 103) ------------------------
    // The Matter world's bounds rectangle is set to match the active
    // stage's blast-zone extent (the canonical "stage dimensions"
    // envelope used by both the camera and the KO sensors). All four
    // physical walls are disabled — fighters MUST be allowed to fly
    // past the blast zone for the KO sensor system to fire — so this
    // call only updates the world's broadphase rectangle / metadata.
    // The pairing with the camera-side `setBounds()` call (in
    // `CameraController`) is what guarantees "the camera cannot scroll
    // outside the stage area" while still allowing real off-stage KOs.
    const z = this.activeStage.blastZone;
    const worldX = designOffsetX + z.left * this.stage.scale;
    const worldY = designOffsetY + z.top * this.stage.scale;
    const worldW = (z.right - z.left) * this.stage.scale;
    const worldH = (z.bottom - z.top) * this.stage.scale;
    // Phaser's `setBounds(x, y, w, h, thickness, left, right, top, bottom)`
    // — the four boolean flags disable the auto-generated physical walls
    // so this is purely a metadata update. Guard the call so headless
    // tests / future scene splits without a Matter binding don't crash.
    this.matter.world.setBounds?.(
      worldX,
      worldY,
      worldW,
      worldH,
      128,
      false,
      false,
      false,
      false,
    );
    const toViewportX = (dx: number): number => designOffsetX + dx * this.stage.scale;
    const toViewportY = (dy: number): number => designOffsetY + dy * this.stage.scale;

    // Mark spawn points with a small dot so layout authoring is observable.
    const spawnDotKey = 'tex.boot.pixel';
    if (this.textures.exists(spawnDotKey)) {
      for (const sp of this.activeStage.spawnPoints) {
        this.add
          .image(toViewportX(sp.x), toViewportY(sp.y), spawnDotKey)
          .setDisplaySize(8, 8)
          .setTint(0xffd166)
          .setAlpha(0.7);
      }
    }

    // ---- Players (AC 204 Sub-AC 4 + AC 10005 Sub-AC 5) ------------------
    // AC 10005 Sub-AC 5 wiring: read each slot's `characterId` from the
    // CharacterSelect → MatchScene `MatchConfig.players[]` lineup and
    // dispatch through the canonical character factory so the chosen
    // fighter (and its full authored moveset) actually spawns. The
    // factory's `resolveSlotCharacterId` looks up by *slot index* not
    // array position so a partial lobby (e.g. P1 + P3 only) doesn't
    // mis-route P3 onto the slot-2 spawn point.
    //
    // Falls back to Wolf @ slot 1 / Cat @ slot 2 when no `matchConfig`
    // is present — preserves the M1 "press ENTER to fight" dev-mode
    // path. Every roster character (Wolf bruiser, Cat ninja, Owl mage,
    // Bear grappler) registers its full 10-move kit in its constructor,
    // so picking any character yields the matching moveset.
    const wolfSpawn = this.activeStage.spawnPoints[0]!;
    const catSpawn = this.activeStage.spawnPoints[1]!;
    const p1SpawnX = toViewportX(wolfSpawn.x);
    const p1SpawnY = toViewportY(wolfSpawn.y);
    const p2SpawnX = toViewportX(catSpawn.x);
    const p2SpawnY = toViewportY(catSpawn.y);
    const p1CharacterId = resolveSlotCharacterId(
      data?.matchConfig?.players,
      1,
      'wolf',
    );
    const p2CharacterId = resolveSlotCharacterId(
      data?.matchConfig?.players,
      2,
      'cat',
    );
    this.p1 = createCharacterById(this, p1CharacterId, {
      spawnX: p1SpawnX,
      spawnY: p1SpawnY,
      slotIndex: 0,
    });
    this.p2 = createCharacterById(this, p2CharacterId, {
      spawnX: p2SpawnX,
      spawnY: p2SpawnY,
      slotIndex: 1,
    });
    // Face inward so the very first attack lands toward the opponent
    // even before either player deflects the stick.
    this.p1.setFacing(1);
    this.p2.setFacing(-1);

    // ---- Sub-AC 3 of AC 13: per-slot palette swap resolution -----------
    // Resolve each fighter's `(characterId, paletteIndex)` pair into a
    // concrete `PaletteSwap` colour record up-front. The visual
    // construction below is identical regardless of which palette the
    // slot picked — `applyPaletteSwap` paints the rectangle's fill +
    // stroke and the triangle's fill in one call. When the menu / replay
    // player passes a real `MatchConfig` (M2+), each slot's
    // `paletteIndex` already drives differentiation; for the M1 dev-
    // mode "press ENTER to fight" path we fall back to palette 0 (the
    // canonical Wolf-red / Cat-blue colours) to preserve the existing
    // visual baseline.
    //
    // AC 10005 Sub-AC 5 — palette resolution now reads the *resolved*
    // characterId from `resolveSlotCharacterId` above so a slot that
    // picked Bear gets Bear's palette table, not Wolf's. Without this
    // tie-back, picking a non-default fighter would render in the
    // wrong character's colour ladder.
    const configuredP1Palette = data?.matchConfig?.players?.find(
      (s) => s.index === 1,
    )?.paletteIndex ?? 0;
    const configuredP2Palette = data?.matchConfig?.players?.find(
      (s) => s.index === 2,
    )?.paletteIndex ?? 0;
    const p1PaletteSwap = paletteSwapForCharacter(1, p1CharacterId, configuredP1Palette);
    const p2PaletteSwap = paletteSwapForCharacter(2, p2CharacterId, configuredP2Palette);

    // Visual proxies — flat rectangles pinned to each body in the
    // render hook. Initial fill colour is drawn from the resolved
    // palette so a pre-paint flash (between scene-create and the first
    // `applyPaletteSwap` below) doesn't show the wrong slot colour.
    //
    // AC 10401 Sub-AC 1 — when the picked character ships a real
    // sprite atlas (`placeholder.spriteKey` non-null), an additional
    // `Phaser.GameObjects.Sprite` is layered on top of the rectangle
    // and owns the visible body rendering. The rectangle stays in the
    // scene as a hurtbox-debug overlay underneath the sprite (faded to
    // 25% alpha so its silhouette is still readable in dev mode but
    // doesn't fight the sprite for attention). When the spec has no
    // sprite key (Owl / Bear during M1), we fall back to the original
    // 85%-alpha rectangle-only rendering.
    const p1Tuning = this.p1.getTuning();
    const p2Tuning = this.p2.getTuning();
    // AC 10401 Sub-AC 1 — read each fighter's `placeholder` (incl. its
    // `spriteKey`) from the roster spec rather than the live
    // `Character` instance, since `Character` itself only owns the
    // Matter body. The roster lookup is keyed off the resolved
    // `characterId` so a slot that picked a non-default fighter (e.g.
    // P1 picks Cat) still reads the right placeholder.
    const p1Placeholder = getCharacterSpec(p1CharacterId).placeholder;
    const p2Placeholder = getCharacterSpec(p2CharacterId).placeholder;
    const p1HasSprite =
      p1Placeholder.spriteKey !== null && this.textures.exists(p1Placeholder.spriteKey);
    const p2HasSprite =
      p2Placeholder.spriteKey !== null && this.textures.exists(p2Placeholder.spriteKey);
    const rectAlpha = 0.85;
    // procedural fallback — fighter body painted as a flat-colour
    // `Phaser.GameObjects.Rectangle`. Used at full opacity (rectAlpha)
    // for any roster slot whose `placeholder.spriteKey` is null
    // (Owl / Bear today). When a real sprite IS registered (Wolf, Cat),
    // the rectangle stays as a faint hurtbox-debug overlay underneath
    // the sprite (rectAlphaWithSprite). Remove the rect entirely once
    // every roster slot ships a sprite atlas.
    // When a real sprite is present, hide the hurtbox debug overlay
    // entirely (alpha 0) — players reported the visible box was
    // distracting and read as a glitch. The rect still exists as a
    // GameObject so existing per-frame `setPosition` plumbing keeps
    // working without a refactor; it's just invisible.
    this.p1Visual = this.add.rectangle(
      this.p1.getPosition().x,
      this.p1.getPosition().y,
      p1Tuning.width,
      p1Tuning.height,
      p1PaletteSwap.primaryColor,
      p1HasSprite ? 0 : rectAlpha,
    );
    this.p2Visual = this.add.rectangle(
      this.p2.getPosition().x,
      this.p2.getPosition().y,
      p2Tuning.width,
      p2Tuning.height,
      p2PaletteSwap.primaryColor,
      p2HasSprite ? 0 : rectAlpha,
    );

    // ---- AC 10401 Sub-AC 1: real sprite frames for M1 characters ----------
    // Build a `Phaser.GameObjects.Sprite` per slot whose spec ships a
    // loaded texture, positioned over the rectangle and rescaled to
    // exactly fill the body's `(width, height)` so the visible
    // silhouette aligns with the underlying Matter hurtbox. Frame 0 of
    // the idle spritesheet is the canonical "rest" pose.
    //
    // Sub-AC 2 of AC 10402 — register Phaser animations for every
    // loaded character spritesheet (idle / run / jump / attack). The
    // helper is idempotent (skips on re-entry) so it's safe to call
    // every scene-create. Done before the per-slot Sprite construction
    // so the SpriteAnimationStateMachine's first `tick()` (called from
    // the render loop) can dispatch a `play()` against an already-
    // registered animation key.
    registerAllCharacterSpriteAnimations(this);
    let p1Sprite: Phaser.GameObjects.Sprite | null = null;
    let p2Sprite: Phaser.GameObjects.Sprite | null = null;
    // Sprite display size is read from the per-character visual-scale
    // table — single source of truth shared with any future scaling
    // subsystem (mushroom power-ups, training-mode size mods). See
    // `src/characters/visualScale.ts` for the architectural contract:
    // hurtbox dims (`*_TUNING.width / .height`) are sized to match the
    // visible character pixels at this display size.
    const p1SpriteDisplay = getCharacterSpriteDisplaySize(p1CharacterId);
    const p2SpriteDisplay = getCharacterSpriteDisplaySize(p2CharacterId);
    if (p1HasSprite) {
      p1Sprite = this.add.sprite(
        this.p1.getPosition().x,
        this.p1.getPosition().y + p1Tuning.height / 2,
        p1Placeholder.spriteKey as string,
        0,
      );
      p1Sprite.setOrigin(0.5, 1.0);
      applySpriteDisplayHeight(p1Sprite, p1SpriteDisplay);
      p1Sprite.setDepth(1);
    }
    if (p2HasSprite) {
      p2Sprite = this.add.sprite(
        this.p2.getPosition().x,
        this.p2.getPosition().y + p2Tuning.height / 2,
        p2Placeholder.spriteKey as string,
        0,
      );
      p2Sprite.setOrigin(0.5, 1.0);
      applySpriteDisplayHeight(p2Sprite, p2SpriteDisplay);
      p2Sprite.setDepth(1);
    }

    // ---- Sub-AC 2 of AC 10402: per-fighter sprite animation state machine ----
    // Build a small state machine per slot that resolves the discrete
    // sprite-animation state (idle / run / jump / fall / attack / hurt)
    // from a per-frame snapshot of the wrapped Character and dispatches
    // a `sprite.play()` call when the state changes. The state machine
    // is `null` for slots without a sprite (Owl / Bear in M1 — their
    // placeholder rectangle does not need animation hooks).
    const p1SpriteAnimSm: SpriteAnimationStateMachine | null = p1Sprite
      ? createSpriteAnimationStateMachine(
          { getSpriteAnimationSnapshot: () => buildSpriteAnimationSnapshot(this.p1) },
          p1Sprite,
        )
      : null;
    const p2SpriteAnimSm: SpriteAnimationStateMachine | null = p2Sprite
      ? createSpriteAnimationStateMachine(
          { getSpriteAnimationSnapshot: () => buildSpriteAnimationSnapshot(this.p2) },
          p2Sprite,
        )
      : null;

    // Tiny facing arrow per fighter. Drawn as a small triangle in
    // front of the body; we re-position + rotate it each render frame
    // by reading `Character.getFacing()`. Initial fill is the slot's
    // accent so the same pre-paint guard applies.
    // procedural fallback — facing indicator drawn as a flat-colour
    // `Phaser.GameObjects.Triangle` (no sprite frame). The real sprite
    // atlases for Wolf/Cat communicate facing through their own art, so
    // the marker can be removed once every roster slot ships an atlas
    // with directional frames.
    this.p1FacingMark = this.add
      .triangle(0, 0, 0, -10, 18, 0, 0, 10, p1PaletteSwap.accentColor)
      .setAlpha(0.85);
    this.p2FacingMark = this.add
      .triangle(0, 0, 0, -10, 18, 0, 0, 10, p2PaletteSwap.accentColor)
      .setAlpha(0.85);

    // Apply the palette swap through the canonical helper so the body
    // stroke is wired up alongside the fill, and any future render
    // target (sprite atlas tint, weapon overlay) added to this slot's
    // FighterPaletteTargets struct is painted in one place. Painting
    // through the helper here — even when the constructor already drew
    // the right colour — keeps the rect's `strokeStyle` in lockstep
    // with the palette and gives us a single source of truth for the
    // "swap is applied" contract.
    // AC 20302 Sub-AC 2 — route both fighters through the runtime
    // palette renderer so the rectangle pipeline (body + facing mark)
    // and the sprite pipeline (real atlases via shader / tint
    // fallback) share one entry point. The renderer caches per-slot
    // so subsequent re-paints (respawn, palette tweak hot-reload) cost
    // only one `paletteSwapEqual` compare.
    //
    // M1 routing: `auxSprite` is preserved so the existing tint
    // contract for the rectangle pipeline still fires; `sprite`
    // routes through the dedicated shader path which falls back to
    // `setTint` until the WebGL pipeline factory is wired in by a
    // follow-up AC. Both calls converge on the same primary colour
    // for the sprite, so the visible result is unchanged.
    // Players reported the colored rectangle around the sprite was
    // distracting and read as a glitch. When a real sprite is present,
    // hide the body rect (alpha 0 + zero stroke) AND skip the
    // `auxSprite` tint path that would solid-fill the sprite with the
    // primary palette colour (= the "uniform red wolf" / "uniform pink
    // cat" effect). The shader/tint palette-swap pipeline (`sprite:`
    // target) still runs to recolour the actual pixels. When sprite is
    // absent (Owl/Bear procedural fallback), paint the rectangle at
    // full alpha as before — that rectangle IS the character.
    this.paletteRenderer.paint(
      'fighter-1',
      {
        body: this.p1Visual,
        facingMark: this.p1FacingMark,
        ...(p1Sprite ? { sprite: p1Sprite } : {}),
      },
      { index: 1, characterId: p1CharacterId, paletteIndex: configuredP1Palette },
      {
        bodyFillAlpha: p1HasSprite ? 0 : rectAlpha,
        bodyStrokeAlpha: p1HasSprite ? 0 : 1,
      },
    );
    this.paletteRenderer.paint(
      'fighter-2',
      {
        body: this.p2Visual,
        facingMark: this.p2FacingMark,
        ...(p2Sprite ? { sprite: p2Sprite } : {}),
      },
      { index: 2, characterId: p2CharacterId, paletteIndex: configuredP2Palette },
      {
        bodyFillAlpha: p2HasSprite ? 0 : rectAlpha,
        bodyStrokeAlpha: p2HasSprite ? 0 : 1,
      },
    );

    // ---- Sub-AC 4.2 / Sub-AC 4 of AC 6: stock tracker + blast-zone watcher --
    //
    // Sub-AC 4 of AC 6 is the AC-text shorthand: "implement KO handling
    // on blast zone crossing (life decrement, respawn or elimination,
    // damage % reset)". The same modules wired up here also satisfy
    // Sub-AC 4.2 of AC 302 (stock tracking + respawn with invincibility)
    // — one pipeline, two AC trace points.
    // M2 wiring: stock tracker tracks every active slot. We resolve
    // the canonical match config eagerly so every subsystem (tracker,
    // stats, input buffer, recording controller) reads the SAME
    // players.length. `resolveActiveMatchConfig` is pure — safe to
    // call early. Storing the result on `this.activeMatchConfig` here
    // means the later assignment at line ~1991 is a no-op restate.
    //
    // M2 — 4-player FFA: spawn an extra fighter for each
    // `matchConfig.players` entry beyond the canonical p1/p2. Each
    // extra fighter gets its own visual + sprite + facingMark and
    // is appended to playerSlots after the p1/p2 entries below.
    // Capped at 4 total to match the 4 spawn points the stage layouts
    // ship and the `MAX_PLAYER_SLOTS = 4` lobby limit.
    const MAX_FIGHTERS = 4;
    this.activeMatchConfig = this.resolveActiveMatchConfig(data);
    // Stash the resolved config on the registry so the Results
    // scene's REMATCH path can reuse it (preserves per-slot
    // characterId + paletteIndex across rematches).
    this.registry.set(BOOT_REGISTRY_KEYS.lastMatchConfig, this.activeMatchConfig);
    const resolvedPlayerCount = Math.min(
      this.activeMatchConfig.players.length,
      MAX_FIGHTERS,
    );
    // Spawn extra fighters (slots 3+) — slots 1 and 2 are already
    // alive as `this.p1` / `this.p2` from the block above.
    for (let slotIdx = 2; slotIdx < resolvedPlayerCount; slotIdx += 1) {
      const slotIndex1Based = (slotIdx + 1) as 1 | 2 | 3 | 4; // matchConfig.players.index is 1-based
      const sp = this.activeStage.spawnPoints[slotIdx];
      if (!sp) break; // stage doesn't have enough spawn points
      const sx = toViewportX(sp.x);
      const sy = toViewportY(sp.y);
      const cid = resolveSlotCharacterId(
        data?.matchConfig?.players,
        slotIndex1Based,
        slotIdx === 2 ? 'owl' : 'bear',
      );
      const fighter = createCharacterById(this, cid, {
        spawnX: sx,
        spawnY: sy,
        slotIndex: slotIdx,
      });
      // Face inward so initial attacks tend toward the centre of the stage.
      fighter.setFacing(slotIdx % 2 === 0 ? 1 : -1);
      this.extraFighters.push(fighter);

      const fighterTuning = fighter.getTuning();
      const placeholder = getCharacterSpec(cid).placeholder;
      const hasSprite =
        placeholder.spriteKey !== null && this.textures.exists(placeholder.spriteKey);
      const slotPaletteIdx =
        data?.matchConfig?.players?.find((s) => s.index === slotIndex1Based)?.paletteIndex ?? 0;
      const palette = paletteSwapForCharacter(
        slotIndex1Based as 1 | 2 | 3 | 4,
        cid,
        slotPaletteIdx,
      );
      const visual = this.add.rectangle(
        fighter.getPosition().x,
        fighter.getPosition().y,
        fighterTuning.width,
        fighterTuning.height,
        palette.primaryColor,
        hasSprite ? 0 : rectAlpha,
      );
      this.extraVisuals.push(visual);

      let sprite: Phaser.GameObjects.Sprite | null = null;
      if (hasSprite) {
        const displaySize = getCharacterSpriteDisplaySize(cid);
        sprite = this.add.sprite(
          fighter.getPosition().x,
          fighter.getPosition().y + fighterTuning.height / 2,
          placeholder.spriteKey as string,
          0,
        );
        sprite.setOrigin(0.5, 1.0);
        applySpriteDisplayHeight(sprite, displaySize);
        sprite.setDepth(1);
      }
      this.extraSprites.push(sprite);

      const facingMark = this.add
        .triangle(0, 0, 0, -10, 18, 0, 0, 10, palette.accentColor)
        .setAlpha(0.85);
      this.extraFacingMarks.push(facingMark);

      // Run through the canonical palette renderer so this fighter's
      // visuals match the M1 wiring contract — same single source of
      // truth for fill/stroke/sprite colouring across all slots.
      this.paletteRenderer.paint(
        `fighter-${slotIndex1Based}`,
        {
          body: visual,
          facingMark,
          ...(sprite ? { sprite } : {}),
        },
        { index: slotIndex1Based as 1 | 2 | 3 | 4, characterId: cid, paletteIndex: slotPaletteIdx },
        {
          bodyFillAlpha: hasSprite ? 0 : rectAlpha,
          bodyStrokeAlpha: hasSprite ? 0 : 1,
        },
      );
    }
    this.stockTracker = new StockTracker({
      playerCount: resolvedPlayerCount,
      stockCount: DEFAULT_STOCK_COUNT, // 3
      respawnDelayFrames: 0,
      invincibilityFrames: DEFAULT_INVINCIBILITY_FRAMES, // 90 frames = 1.5 s
    });

    // ---- Sub-AC 1 + Sub-AC 3 of AC 16: post-match stats ledger ------------
    // Phaser-free per-player ledger for KOs, damage dealt/taken, deaths,
    // and survival frames. Constructed alongside the `StockTracker` so
    // the loseStock helper below can drive both modules from a single
    // source of truth, and so the `MatchEndDetector` (built shortly) can
    // borrow the tracker via its `statsTracker` option to finalise
    // survival frames + snapshot the per-player stats onto the result
    // payload that boots the `ResultsScene`.
    //
    // `matchStartFrame` tracks the engine's frame counter, which is
    // reset to 0 on every `physicsEngine.reset()`; the scene reaches
    // `create()` after that reset so reading 0 here matches the
    // canonical "match begins at frame 0" convention.
    this.matchStatsTracker = new MatchStatsTracker({
      playerCount: resolvedPlayerCount,
      matchStartFrame: 0,
    });

    this.blastZoneWatcher = new BlastZoneWatcher((playerIndex) => {
      // Use the *current* simulated frame so the respawn fire-frame is
      // computed deterministically against the same clock the rest of
      // the engine reads. Calling `getFrame()` here is safe even mid-
      // step because `PhysicsEngine` only advances the counter between
      // step callbacks.
      this.recordStockLossWithStats(playerIndex, this.physicsEngine.getFrame());
    });
    this.blastZoneWatcher.registerPlayer(0, this.p1.body);
    this.blastZoneWatcher.registerPlayer(1, this.p2.body);
    // M2 — register every extra fighter (slots 3, 4) so blast-zone
    // KOs fire correctly in 4-player FFA.
    for (let i = 0; i < this.extraFighters.length; i += 1) {
      this.blastZoneWatcher.registerPlayer(i + 2, this.extraFighters[i]!.body);
    }

    // ---- Sub-AC 2 of AC 60202: position-based KO detection -----------------
    // Per-tick position scan against the stage's blast zone. Catches the
    // edge cases the collision-based watcher cannot — high-velocity
    // tunnelling past a sensor and replay-resync into an out-of-bounds
    // snapshot. The KO callback feeds `StockTracker.loseStock` with the
    // event's deterministic frame number; the tracker's idempotency
    // guard makes simultaneous firings from both watchers safe.
    this.blastZonePositionWatcher = new BlastZonePositionWatcher(
      this.activeStage.blastZone,
      (event) => {
        this.recordStockLossWithStats(event.playerIndex, event.frame);
      },
    );
    this.blastZonePositionWatcher.registerPlayer(0, this.p1.body);
    this.blastZonePositionWatcher.registerPlayer(1, this.p2.body);
    for (let i = 0; i < this.extraFighters.length; i += 1) {
      this.blastZonePositionWatcher.registerPlayer(i + 2, this.extraFighters[i]!.body);
    }

    // ---- Sub-AC 2 of AC 60002: hitbox damage handler --------------------
    // Translates `(hitbox.attack, character.body)` collisions into
    // `applyHit` calls on the matching fighter. The `Character` class
    // already implements the per-fighter mutation (accumulate damage,
    // override velocity, lock hitstun) — this handler is the missing
    // wire between Matter's collision stream and that mutation.
    //
    // The callback resolves `targetIndex` against the same
    // `playerSlots` table that drives respawns, so a hit on slot N
    // always lands on the right Character — even after a fighter has
    // re-registered following a respawn.
    this.hitboxDamageHandler = new HitboxDamageHandler(
      (targetIndex, hitInfo, context) => {
        const slot = this.playerSlots?.[targetIndex];
        if (!slot) return;
        // Eliminated fighters are unregistered from the handler before
        // they can take phantom hits, but check defensively in case a
        // late-firing event arrives the same step a slot is removed.
        if (this.stockTracker.isEliminated(slot.playerIndex)) return;
        // Grab range-sensor connects route to a different resolver
        // than damage hitboxes — both fighters transition into the
        // grabber-holding / target-grabbed pair, no immediate damage.
        if (context.kind === 'grab') {
          const attackerSlotForGrab = this.playerSlots?.find(
            (s) => s.character.id === context.attackerOwnerId,
          );
          if (attackerSlotForGrab) {
            attackerSlotForGrab.character.resolveGrabConnect(slot.character);
          }
          return;
        }
        // AC 10304 — capture whether the defender was shielding BEFORE
        // the hit resolves. A shielded hit drains shield health (and may
        // shatter it) — the Character voices its own shield / shield-
        // break cue for that case, so we must NOT also fire the flesh-
        // and-bone connect cue or the block would double up.
        const targetWasShielding = slot.character.isShielding();

        // ---- Tier 3: RAGE + STALE-MOVE negation ------------------------
        // Resolve the attacker BEFORE applying the hit so we can fold two
        // attacker-side modifiers into the hit:
        //   • RAGE — the attacker's own percent scales their knockback up
        //     (a battered fighter KOs earlier).
        //   • STALE-MOVE negation — a move repeated recently deals less
        //     damage AND knockback; varying offence keeps moves fresh.
        // Both are deterministic functions of attacker state, so the
        // replay re-derives identical hits.
        const attackerSlot = this.playerSlots?.find(
          (s) => s.character.id === context.attackerOwnerId,
        );
        let effectiveHit: HitInfo = hitInfo;
        if (attackerSlot) {
          const rage = computeRageMultiplier(
            attackerSlot.character.getDamagePercent(),
          );
          const staleOccurrences = attackerSlot.character.registerLandedMove(
            context.moveId,
          );
          const stale = computeStaleMultiplier(staleOccurrences);
          const kbFactor = rage * stale; // knockback: rage up, stale down
          if (kbFactor !== 1 || stale !== 1) {
            const base = hitInfo.knockback.baseMagnitude ?? 0;
            effectiveHit = {
              ...hitInfo,
              damage: hitInfo.damage * stale, // stale shaves damage only
              knockback: {
                ...hitInfo.knockback,
                x: hitInfo.knockback.x * kbFactor,
                y: hitInfo.knockback.y * kbFactor,
                ...(base > 0 ? { baseMagnitude: base * kbFactor } : {}),
              },
            };
          }
        }

        const hitResult = slot.character.applyHit(effectiveHit);

        // Shield pushback — when a raised shield absorbs a normal hit, the
        // attacker bounces back in the opposite direction of their attack.
        // Skipped when the shield just broke (attacker is rewarded with a
        // free punish window) or when the hit was unblockable (command grab).
        if (
          targetWasShielding &&
          hitResult.magnitude === 0 &&
          !effectiveHit.unblockable &&
          !slot.character.isShieldBroken() &&
          attackerSlot
        ) {
          const vel = attackerSlot.character.getVelocity();
          const pushDir = -(effectiveHit.facing); // opposite of attack direction
          this.matter.body.setVelocity(attackerSlot.character.body, {
            x: vel.x + pushDir * 3.0,
            y: vel.y,
          });
        }

        // Both fighters FREEZE on contact (the genre's fundamental hit-pause
        // / "freeze frames"). The attacker arms the SAME freeze the defender
        // just took — with no launch — so the swing visibly stops on impact
        // instead of animating straight through. Previously only the
        // defender froze.
        const contactFreeze = slot.character.getHitlagRemaining();

        // ---- Sub-AC 1 + Sub-AC 3 of AC 16: feed stats ledger -----------
        // Credit the attacker for the (post-stale) damage actually dealt
        // and arm the matching contact freeze. Self-hits are filtered
        // upstream; a non-roster ownerId resolves to no slot and is
        // silently skipped (environmental damage is uncredited).
        if (attackerSlot) {
          attackerSlot.character.armAttackerHitlag(contactFreeze);
          this.matchStatsTracker.recordDamage(
            attackerSlot.playerIndex,
            slot.playerIndex,
            effectiveHit.damage,
            this.physicsEngine.getFrame(),
          );
        }

        // ---- AC 10304: connect-on-hit SFX ------------------------------
        // The CONNECT cue (distinct from the SWING cue the Character
        // fires when its hitbox spawns): a damage-scaled pop / thud the
        // frame a hit actually lands on a defender, with a metallic clang
        // when the attacker is swinging a held melee weapon. Skipped when
        // the defender was shielding (the block's shield / shatter cue
        // already covers that contact). Routed through the same SFX
        // AudioManager the fighters use; `emitCombatSfx` swallows any
        // backend error so a bad cue can never break the hit pipeline.
        // This is a render-side presentation effect reading resolved sim
        // state — it never feeds back into the deterministic step.
        if (!targetWasShielding && this.sfxAudioManager) {
          const attackerHeld = attackerSlot
            ? this.inventoriesByPlayerIndex
                .get(attackerSlot.playerIndex)
                ?.getHeldItem()
            : null;
          const heldWeapon =
            attackerHeld?.definition.category === 'melee-weapon';
          const connectKey = mapHitConnectToSfxKey({
            damage: hitInfo.damage,
            heldWeapon,
          });
          emitCombatSfx(this.sfxAudioManager, connectKey);
        }

        // ---- Hit-feedback FX: spawn a hit spark at the contact point ----
        // The visible "we connected" cue. Spawned the exact frame the
        // hit resolves (right after `applyHit`) so the burst is frame-
        // accurate. Contact point: the midpoint between the attacker's
        // live hitbox sensor centre and the target's body, biased toward
        // the target so the burst reads as landing ON the defender. The
        // shard-scatter seed is the simulated frame plus the attacker's
        // slot index — a deterministic integer (NOT a `Math.random()`
        // read) so a replayed match paints identical sparks. World-camera
        // partitioned (the pool's GameObjects keep scrollFactor 1).
        {
          const sparkFrame = this.physicsEngine.getFrame();
          const targetPos = slot.character.getPosition();
          let contactX = targetPos.x;
          let contactY = targetPos.y;
          const attackerActive = attackerSlot?.character.getActiveAttack();
          if (attackerActive) {
            const center = computeHitboxCenter(
              attackerSlot!.character.getPosition(),
              attackerActive.move,
              attackerActive.facing,
            );
            // Bias 60% toward the defender so the pop sits on the body
            // that just took the hit, not floating in front of the swing.
            contactX = center.x + (targetPos.x - center.x) * 0.6;
            contactY = center.y + (targetPos.y - center.y) * 0.6;
          }
          const sparkSeed = sparkFrame + (attackerSlot?.playerIndex ?? 0);
          this.hitSparkPool.spawn(
            contactX,
            contactY,
            hitInfo.damage,
            sparkSeed,
            sparkFrame,
          );
        }
        // Note: per user feedback (memory:
        // feedback_no_attacker_hitlag_no_screen_shake) — only the
        // defender's hitlag freeze fires here. We deliberately do NOT
        // mirror it onto the attacker (no `armAttackerHitlag` call)
        // and do NOT trigger a camera shake on hit-confirm. The
        // `armAttackerHitlag` method + `computeScreenShake` math
        // remain available for future opt-in cinematic events
        // (KO blasts, stage hazards) but are not auto-invoked here.
      },
    );
    this.hitboxDamageHandler.registerPlayer(0, this.p1.body);
    this.hitboxDamageHandler.registerPlayer(1, this.p2.body);
    for (let i = 0; i < this.extraFighters.length; i += 1) {
      this.hitboxDamageHandler.registerPlayer(i + 2, this.extraFighters[i]!.body);
    }

    // Sub-AC 2 of AC 10002 — wire the per-target hurtbox lookup so
    // the damage handler honours per-move hurtbox modifiers
    // (intangible windows, super-armour damage multipliers) declared
    // on the move data layer. The handler iterates the lookup result
    // BEFORE dispatching the callback; an all-intangible set drops the
    // hit silently, a tangible set with `damageMultiplier !== 1`
    // scales `hit.damage` before the dispatch lands on `applyHit`.
    this.hitboxDamageHandler.setHurtboxLookup((targetIndex) => {
      const slot = this.playerSlots?.[targetIndex];
      if (!slot) return null;
      return slot.character.getActiveHurtboxes();
    });

    // Match-end detector — runs the post-match freeze + transitions to
    // the results scene. Names follow each slot's PICKED character so
    // the results screen reads e.g. "OWL WINS" when slot 1 picked Owl,
    // not "WOLF WINS" off a hardcoded slot-name table. The display
    // label comes from `getCharacterSpec(id).displayName`; extras
    // (slots 3+) are read off `extraFighters[i].id`.
    const matchEndPlayerNames: string[] = [
      getCharacterSpec(this.p1.id).displayName,
      getCharacterSpec(this.p2.id).displayName,
    ];
    for (const fighter of this.extraFighters) {
      matchEndPlayerNames.push(getCharacterSpec(fighter.id).displayName);
    }
    this.matchEndDetector = new MatchEndDetector(this.stockTracker, {
      endingDurationFrames: DEFAULT_ENDING_DURATION_FRAMES,
      playerNames: matchEndPlayerNames,
      stageName:
        this.activeStage.id === 'lava'
          ? 'Lava Stage'
          : this.activeStage.id === 'wind'
            ? 'Wind Stage'
            : 'Flat Stage',
      // Sub-AC 3 of AC 16 — hand the stats ledger to the detector so
      // the freeze-time `enterEnding` snapshot finalises survival
      // frames on the canonical match-end frame and freezes the
      // per-player stats panel onto the result payload that's handed
      // to `ResultsScene`. Without this wire, the results screen
      // would render the stocks block but skip the post-match stats
      // panel entirely.
      statsTracker: this.matchStatsTracker,
    });

    // ---- Hazard player registration (AC 20101 Sub-AC 1) ------------------
    // The hazard renderers + watchers themselves are owned by `baseStage`
    // (constructed above when `this.activeStage` was resolved). Here we
    // only have to register the freshly-built fighter bodies with the
    // stage so the lava + wind adapters can dispatch KO / force events
    // for them. `registerPlayer` is a single-method fan-out — the stage
    // forwards to every hazard adapter it owns, so adding a new hazard
    // family later (M2 polish, custom-stage trap watchers) doesn't
    // require touching this scene.
    if (this.baseStage.lavaCollisionWatcher || this.baseStage.windForceController) {
      this.baseStage.registerPlayer(0, this.p1.body);
      this.baseStage.registerPlayer(1, this.p2.body);
      for (let i = 0; i < this.extraFighters.length; i += 1) {
        this.baseStage.registerPlayer(i + 2, this.extraFighters[i]!.body);
      }
    }

    // Subscribe at the world level — the same channel the `Character`
    // class uses for grounded-state tracking. The single listener fans
    // out to every collision adapter (blast-zone KO + hitbox damage +
    // lava overlap) — they process disjoint pair shapes so running
    // them all per event is cheap. Lava additionally needs the
    // `collisionend` stream because a fighter can leave a lava body
    // before it becomes active again; a separate end-handler dispatch
    // keeps that contract clean.
    this.collisionStartHandler = (event) => {
      this.blastZoneWatcher.handleCollisionStart(event);
      this.hitboxDamageHandler.handleCollisionStart(event);
      // AC 20101 Sub-AC 1 — fan out to every hazard adapter the
      // active stage owns in one call. No-op on hazard-free stages.
      this.baseStage.handleCollisionStart(event);
    };
    this.matter.world.on('collisionstart', this.collisionStartHandler);
    if (this.baseStage.needsCollisionEndChannel()) {
      this.collisionEndHandler = (event) => {
        // AC 20101 Sub-AC 1 — same fan-out for the `collisionend`
        // channel. Subscribed only when the stage actually carries
        // hazards that need it (lava + wind), so non-hazard stages
        // pay no listener cost.
        this.baseStage.handleCollisionEnd(event);
      };
      this.matter.world.on('collisionend', this.collisionEndHandler);
    }

    // ---- Pass-through-platform driver (one-way + drop-through) -----------
    // Per-step rule (runs BEFORE Matter resolves contacts):
    //   For each pass-through platform, decide whether it should
    //   currently collide with characters. The `togglePlatformCollision`
    //   helper writes the canonical `(category, mask)` pair onto the
    //   body so this is a single platform-side filter mutation per
    //   step — no per-pair veto needed.
    //
    // A platform drops the CHARACTER bit (becomes truly pass-through
    // for fighters) when ANY of:
    //   • A character has the rapid double-tap-down "drop-through"
    //     window armed AND is currently standing on this platform.
    //   • A character is below the platform top (jumping up through
    //     it) — keeps the platform out of the way for the up-rise.
    //
    // Otherwise the platform stays character-collidable so descending
    // fighters land on top.
    //
    // The mask is bidirectional in Matter — flipping the platform side
    // is enough to gate every pair involving it, so we don't have to
    // touch the character bodies' filters.
    this.passThroughPlatformHandler = () => this.updatePassThroughPlatformMasks();
    this.matter.world.on('beforeupdate', this.passThroughPlatformHandler);

    this.fighterSeparationHandler = () => this.updateFighterSeparation();
    this.matter.world.on('afterupdate', this.fighterSeparationHandler);

    // Stash per-slot layout data so the respawn handler can teleport
    // each fighter back to the right point with the right facing.
    // Sub-AC 3 of AC 13 — also stash the resolved palette swap so
    // downstream consumers (spawn-platform overlay, damage HUD label,
    // results banner) can colour-match the slot without re-deriving
    // the palette from `(characterId, paletteIndex)`.
    this.playerSlots = [
      {
        playerIndex: 0,
        character: this.p1,
        visual: this.p1Visual,
        facingMark: this.p1FacingMark,
        sprite: p1Sprite,
        spriteAnimSm: p1SpriteAnimSm,
        spawnX: p1SpawnX,
        spawnY: p1SpawnY,
        faceOnSpawn: 1,
        paletteSwap: p1PaletteSwap,
        bindingsSlot: 1,
      },
      {
        playerIndex: 1,
        character: this.p2,
        visual: this.p2Visual,
        facingMark: this.p2FacingMark,
        sprite: p2Sprite,
        spriteAnimSm: p2SpriteAnimSm,
        spawnX: p2SpawnX,
        spawnY: p2SpawnY,
        faceOnSpawn: -1,
        paletteSwap: p2PaletteSwap,
        bindingsSlot: 2,
      },
    ];

    // M2 — append extra fighter slots (3, 4) when present. Each
    // extra slot uses gamepad bindings by default (3 → bindingsSlot 3,
    // 4 → bindingsSlot 4); AI slots are wired separately by the bot
    // input provider. Sprite animation state machines are built
    // inline so the per-frame render loop ticks every fighter.
    for (let i = 0; i < this.extraFighters.length; i += 1) {
      const fighter = this.extraFighters[i]!;
      const visual = this.extraVisuals[i]!;
      const facingMark = this.extraFacingMarks[i]!;
      const sprite = this.extraSprites[i] ?? null;
      const spawnPoint = this.activeStage.spawnPoints[i + 2];
      const sx = spawnPoint ? toViewportX(spawnPoint.x) : 0;
      const sy = spawnPoint ? toViewportY(spawnPoint.y) : 0;
      const slotIndex1Based = (i + 3) as 1 | 2 | 3 | 4;
      const cid = fighter.id;
      const slotPaletteIdx =
        data?.matchConfig?.players?.find((s) => s.index === slotIndex1Based)?.paletteIndex ?? 0;
      const palette = paletteSwapForCharacter(slotIndex1Based, cid, slotPaletteIdx);
      const animSm: SpriteAnimationStateMachine | null = sprite
        ? createSpriteAnimationStateMachine(
            { getSpriteAnimationSnapshot: () => buildSpriteAnimationSnapshot(fighter) },
            sprite,
          )
        : null;
      this.playerSlots.push({
        playerIndex: i + 2,
        character: fighter,
        visual,
        facingMark,
        sprite,
        spriteAnimSm: animSm,
        spawnX: sx,
        spawnY: sy,
        faceOnSpawn: i % 2 === 0 ? 1 : -1,
        paletteSwap: palette,
        bindingsSlot: slotIndex1Based,
      });
    }

    // ---- AC 10304: combat / movement SFX bus --------------------------------
    // Mint the scene-owned SFX {@link AudioManager} (separate from the
    // music AudioManager the StageMusicController owns) and wire it into
    // every fighter as their {@link CombatSfxSink}. Each Character then
    // voices its own jump / land / shield / dodge / attack-swing cues
    // from inside the deterministic tick (the manager's wall-clock
    // cooldowns gate playback without touching sim state); the connect-
    // on-hit, KO, and charge-loop cues are voiced from the scene below
    // (hitbox callback, stock-loss helper, charge render loop) on the
    // same manager.
    //
    // Guarded on the audio cache like the music path: a preload-bypassed
    // test scene (or a 404'd asset) leaves `sfxAudioManager` null and
    // every emit short-circuits silently — the match never crashes on
    // missing audio. The persisted `sfxMuted` flag mirrors the music
    // mute so a player who silenced SFX in a previous match stays
    // silenced.
    if (this.cache.audio.exists(ASSET_KEYS.sfxJab)) {
      // Honour either persisted mute flag: the dedicated `sfxMuted`
      // preference, or the shared speaker toggle's `musicMuted` (the one
      // HUD control mutes both buses, so a player who silenced the
      // speaker last match expects SFX to start muted too).
      const sfxMutedAtStart =
        this.registry.get(BOOT_REGISTRY_KEYS.sfxMuted) === true ||
        this.registry.get(BOOT_REGISTRY_KEYS.musicMuted) === true;
      this.sfxAudioManager = new AudioManager({
        soundManager: this.sound as unknown as SoundManagerLike,
        muted: sfxMutedAtStart,
      });
      for (const slot of this.playerSlots) {
        slot.character.setSfxSink(this.sfxAudioManager);
      }
    }

    // ---- Ledge system wiring -------------------------------------------
    // Feed every fighter the stage's grabbable ledge corners. The whole
    // ledge-grab / hang / trump / recovery feature was BUILT and tested but
    // had zero runtime callers — `ledgeCandidates` was always empty, so no
    // fighter could ever grab a ledge. Solid platform tops only (pass-
    // through platforms aren't grabbable). Candidates are static stage
    // geometry, so we set them once here.
    this.ledgeCandidatesByStage = this.activeStage.platforms
      .filter((p) => !p.passThrough)
      .flatMap((p, i) =>
        ledgeCandidatesFromPlatform({
          id: p.id ?? `plat${i}`,
          centerX: p.x,
          centerY: p.y,
          width: p.width,
          height: p.height,
        }),
      );
    for (const slot of this.playerSlots) {
      slot.character.setLedgeCandidates(this.ledgeCandidatesByStage);
    }

    // ---- AC 60401 Sub-AC 1: per-fighter shield bubble overlays -----------
    // Construct one bubble per fighter slot. The body radius reads
    // half the larger body dimension so an oblong fighter (taller
    // than wide) gets a bubble that comfortably wraps the sprite.
    // The shield-tuning's resolved `maxHealth` flows from the
    // character's tuning record so per-character overrides
    // (heavyweight / lightweight shields) are reflected verbatim.
    for (const slot of this.playerSlots) {
      const tuning = slot.character.getTuning();
      const bodyRadius = Math.max(tuning.width, tuning.height) / 2;
      // The runtime `tuning.shield` is a fully-resolved
      // `ResolvedShieldTuning`, but the public `getTuning()` declares
      // it as the partial `ShieldTuning` shape. Fall back to the
      // canonical {@link SHIELD_DEFAULTS} `maxHealth` so a partial-
      // override that omits the field still resolves to the engine's
      // canonical 50-HP cap.
      const maxHealth = tuning.shield?.maxHealth ?? SHIELD_DEFAULTS.maxHealth;
      const bubble = createShieldBubble(this, {
        bodyRadius,
        maxHealth,
      });
      this.shieldBubbles.set(slot.playerIndex, bubble);

      // Charge / wind-up indicator — same world-space overlay pattern as
      // the shield bubble (default scrollFactor, so the camera partition
      // leaves it on the world camera). Sized from the same body radius;
      // the bar floats above the head using the full body height.
      const chargeIndicator = createChargeIndicator(this, {
        bodyRadius,
        bodyHeight: tuning.height,
      });
      this.chargeIndicators.set(slot.playerIndex, chargeIndicator);

      // Melee swing trail — same world-space overlay pattern as the
      // shield bubble / charge indicator (default scrollFactor, so the
      // camera partition leaves it on the world camera). One per fighter;
      // hidden unless the fighter's active move earns a trail.
      const swingTrail = createSwingTrail(this);
      this.swingTrails.set(slot.playerIndex, swingTrail);
    }

    // ---- Hit-feedback FX + F3 debug overlay: scene-wide singletons ------
    // The hit-spark pool is shared by every fighter (sparks are spawned
    // at arbitrary contact points, not pinned to a slot); the F3 hitbox
    // debug layer batches every fighter's boxes into one Graphics redraw.
    // Both are world-camera partitioned (default scrollFactor 1).
    this.hitSparkPool = createHitSparkPool(this);
    this.hitboxDebugLayer = createHitboxDebugLayer(this);

    // ---- Sub-AC 3 of AC 303: respawn coordinator ------------------------
    // Phaser-free deterministic handler. Owns the canonical
    // teleport → reset damage → grant invincibility → face inward
    // pipeline and tracks the spawn-platform overlays for the render
    // hook below. We register every player slot, plus a side-effect
    // hook that re-arms the position-based KO watcher's out-of-bounds
    // latch so the fighter can KO again on the next blast-zone
    // crossing.
    this.respawnHandler = new RespawnHandler();
    for (const slot of this.playerSlots) {
      this.respawnHandler.registerSlot(
        {
          playerIndex: slot.playerIndex,
          spawnX: slot.spawnX,
          spawnY: slot.spawnY,
          faceOnSpawn: slot.faceOnSpawn,
        },
        slot.character,
      );
    }
    this.respawnHandler.onRespawn((event) => {
      // Re-arm the position-based KO detector. The handler's teleport
      // call has already put the body back inside the stage, so the
      // per-tick scan should consider subsequent boundary crossings
      // as fresh KOs.
      this.blastZonePositionWatcher.clearOutOfBounds(event.playerIndex);
    });

    // ---- Input dispatcher (AC 204 Sub-AC 4 → AC 5 Sub-AC 3) -------------
    // Runtime gameplay actions are sourced from the shared
    // {@link InputBindingsStore} via {@link DeviceInputDispatcher}, NOT
    // from the M1 keyboard-only `LocalInputHandler` with its hardcoded
    // WASD/arrow tables. The dispatcher consumes the per-player
    // bindings map (`bindings: bindingsStore`) and routes each
    // {@link LogicalAction} through whichever device the player has
    // bound — a keyboard rebind (e.g. "I want jump on Space"), a
    // gamepad rebind (e.g. "I want shield on RT"), or both, transparent
    // to gameplay code below. The dispatcher reads the live store on
    // every sample so a rebind committed before pressing FIGHT (or via
    // a future in-match settings overlay) takes effect on the very
    // next fixed step without rebuilding scene state.
    //
    // The same `InputBindingsStore` is also handed to the gamepad
    // connection monitor and the cross-index reconnection handler
    // below — every input subsystem agrees on one source of truth, so
    // a rebind that moves a slot from pad 0 to pad 1 (or onto a
    // keyboard) propagates everywhere on the next frame.
    const bindingsStore = this.acquireBindingsStore();
    const keyboardSource: KeyboardSource = createPhaserKeyboardSource(this);
    const gamepadSource: GamepadSource = createBrowserGamepadSource();
    this.inputDispatcher = new DeviceInputDispatcher({
      keyboard: keyboardSource,
      gamepad: gamepadSource,
      bindings: bindingsStore,
    });
    // AC 50202 Sub-AC 2 — the legacy {@link InputService} layer is
    // no longer instantiated by the scene. Every per-frame gameplay
    // read goes through the central {@link InputResolver} below; the
    // resolver shares the dispatcher (one device poll per fixed step)
    // and exposes the Seed's canonical action vocabulary (move / jump
    // / attack / special / shield / grab / dodge) with the canonical
    // dodge-chord resolution (shield + directional) baked in.

    // ---- AC 50202 Sub-AC 2: unified action-state API for gameplay ------
    // Build the central {@link InputResolver} on top of the shared
    // dispatcher (one device poll per fixed step feeds both this
    // resolver AND the existing service / replay path). The gameplay
    // loop calls `inputResolver.update(frame)` once per fixed step and
    // resolves every active slot's `CharacterInput` via
    // {@link buildCharacterInputFromResolver} — no raw key code,
    // gamepad button index, or device-specific lookup is left on the
    // gameplay path. Every action category (move, jump, attack,
    // special, shield, grab, dodge) routes through the rebindable
    // binding layer.
    //
    // Why a central multi-player resolver (instead of per-slot
    // controllers):
    //
    //   • A single named service exposes per-player action state for
    //     every slot — `getAction(playerIndex, actionName)` /
    //     `isActionHeld(playerIndex, actionName)` /
    //     `getMoveVector(playerIndex)` — so gameplay code that needs
    //     to inspect another slot's state (e.g. rendering P1's HUD
    //     while reading P3's shield held) does so through one object
    //     instead of threading four controller references.
    //
    //   • The resolver owns the per-slot prev/curr snapshot pair, so
    //     `justPressed('attack')` / `justReleased('shield')` edge
    //     queries remain scoped to each slot's history without a
    //     four-slot diff loop. The (later sub-AC) gameplay handlers
    //     that need rising-edge semantics — a smash press that fires
    //     once on the press frame, a shield drop that triggers on
    //     release — read those queries inline.
    //
    //   • Mid-match rebind handling is automatic: the dispatcher reads
    //     the live bindings store on every sample, the resolver picks
    //     up the new mapping on the next `update()` — `justPressed`
    //     fires for the new binding, `justReleased` fires for the old
    //     one in the same frame.
    //
    //   • Eliminated slots stay tracked but the update loop skips
    //     `applyInput` for them (their input still flows into the
    //     replay capture as `NEUTRAL_INPUT`). The resolver itself
    //     continues to advance in lockstep with the live slots so the
    //     edge baseline doesn't drift if the slot is later restored.
    const trackedSlots = this.playerSlots.map((slot) => slot.bindingsSlot);
    this.inputResolver = new InputResolver({
      dispatcher: this.inputDispatcher,
      slots: trackedSlots,
    });

    // ---- AC 30002 Sub-AC 2: input capture buffer ------------------------
    // Buffer slot count must equal `matchConfig.players.length` because
    // `RecordingController.start` validates buffer-vs-config alignment.
    // We use the same `resolvedPlayerCount` source the StockTracker /
    // MatchStatsTracker were initialised with above so 1P / 2P / 4P
    // configs all bind to the same canonical count, regardless of how
    // many slots the legacy `playerSlots` array eventually holds.
    this.inputCaptureBuffer = new InputCaptureBuffer({
      playerCount: resolvedPlayerCount,
    });

    // ---- AC 30004 Sub-AC 4: recording lifecycle controller --------------
    // The controller owns the IDLE → RECORDING → STOPPED state machine
    // and writes the downloadable ReplayFile artifact on demand. We
    // hand it the scene's existing `inputCaptureBuffer` via
    // `options.buffer` so there's only ONE buffer per match (no risk
    // of two parallel logs drifting). The controller's start hook
    // requires a finalised `MatchConfig`; we already resolved (and
    // trimmed to ACTUAL_SPAWNED_CHARACTERS) earlier in create() so
    // every match-state primitive (buffer, tracker, stats, recording
    // controller) reads the SAME players.length. We MUST NOT
    // re-resolve here — the second call would skip the trim and
    // re-introduce the buffer-vs-config mismatch crash.

    // ---- AC 30003 Sub-AC 3: match-start metadata snapshot ---------------
    // Capture the diagnostic + simulation-validation metadata HERE,
    // at match start, rather than lazily at save time. Anchors
    // `startedAt` to the moment the match actually began (much more
    // useful than "when did the player press S?") and pins
    // `engineVersion` / `fixedTimestepMs` to the values the
    // simulation actually used. Phaser-free helper so the same
    // snapshot logic runs under the test harness too.
    this.matchStartMetadata = buildMatchStartMetadata({
      matchConfig: this.activeMatchConfig,
      fixedTimestepMs: this.physicsEngine.fixedTimestepMs,
      // engineVersion intentionally omitted — wired up properly when
      // the build pipeline forwards `package.json#version`. The
      // helper substitutes the documented sentinel.
    });

    this.recordingController = new RecordingController({
      buffer: this.inputCaptureBuffer,
      fixedTimestepMs: this.physicsEngine.fixedTimestepMs,
      // Lock the controller's wall-clock factory to the match-start
      // timestamp so the recorded `metadata.recordedAt` reflects when
      // the match BEGAN, not when the player pressed save. The
      // metadata snapshot's `startedAt` is the canonical source.
      nowFactory: () => new Date(this.matchStartMetadata.startedAt),
    });
    this.recordingController.start({ matchConfig: this.activeMatchConfig });
    this.recordingStopped = false;

    // ---- AC 90302 Sub-AC 2: items framework spawn-manager lifecycle -----
    // Construct the deterministic per-match item-spawn scheduler. Three
    // inputs feed the manager:
    //
    //   • `frequency` — the resolved {@link ItemFrequency} dial from the
    //     active `MatchConfig`. `resolveItemFrequency` defends against
    //     a corrupt / missing field (e.g. an M1-era replay header
    //     authored before the items framework landed) by falling back
    //     to {@link DEFAULT_ITEM_FREQUENCY} (`'med'`) so existing match
    //     paths keep working without modification.
    //
    //   • `anchors` — the active stage's `itemSpawnAnchors` array.
    //     Optional in {@link StageLayout} for back-compat; when
    //     undefined or empty the manager statelessly short-circuits
    //     (no rolls, no spawns) so an items-disabled stage costs
    //     nothing.
    //
    //   • `rng` — the match-scoped {@link MatchRng} captured at the
    //     very top of `create()`. The manager pulls its dedicated
    //     `'item-spawn'` substream from here on first use, so a
    //     snapshot/restore cycle on the MatchRng (M4 hybrid replay
    //     snapshots) automatically restores the manager's roll
    //     sequence — no separate snapshot wiring required.
    //
    // The manager is intentionally Phaser-free + entity-agnostic — it
    // produces {@link ItemSpawnRequest} commands but does not own item
    // entities. A later sub-AC (item entity layer) will consume the
    // request stream from the per-step `step()` call below and
    // instantiate concrete items at the requested anchor positions;
    // sub-AC 2 only wires the lifecycle so the request stream begins
    // emitting from the canonical match-start tick.
    this.itemSpawnManager = new ItemSpawnManager({
      frequency: resolveItemFrequency(this.activeMatchConfig.itemFrequency),
      anchors: this.activeStage.itemSpawnAnchors ?? [],
      rng: this.matchRng,
    });

    // ---- AC 14 Sub-AC 2: auto-pause on controller disconnect ------------
    // Reuse the same `bindingsStore` already acquired for the input
    // dispatcher above (the rebinding screen also reads / writes this
    // store, so the monitor's per-slot affinity calculation reflects
    // any rebinds the player committed before pressing FIGHT). One
    // store across the dispatcher + monitor + reconnection handler
    // means a rebind in the settings menu propagates everywhere on the
    // next sample with no scene reload.
    this.gamepadConnectionMonitor = new GamepadConnectionMonitor({
      bindings: bindingsStore,
      // `eventTarget` defaults to `window` in the browser; in the test
      // / headless harness it resolves to null and `start()` becomes
      // a no-op. Either way the controller's emit* helpers can drive
      // it programmatically when a replay later replays the disconnect
      // markers.
    });
    this.gamepadConnectionMonitor.start();
    // ---- AC 14 Sub-AC 4: cross-index reconnect handler ----------------
    // Subscribed BEFORE the pause controller so that on a different-
    // index reconnect the handler rewrites the bindings table first
    // and forwards a synthetic connect for the original index — the
    // pause controller then releases its pause via its normal
    // index-keyed path. Listener-order independence is verified by
    // unit test, but subscribing the handler first matches the
    // documented mental model.
    this.controllerReconnectionHandler = new ControllerReconnectionHandler({
      monitor: this.gamepadConnectionMonitor,
      bindings: bindingsStore,
      onRebind: (event) => this.handleControllerRebind(event),
    });
    this.controllerReconnectionHandler.start();
    this.controllerReconnectionHandler.setActive(true);
    // Wire the monitor's events into the engine's pause flag. The
    // controller stays dormant until `setActive(true)` below — keeps
    // a stray pre-match disconnect from freezing a still-loading
    // scene. The pause-banner show/hide hooks fan out to the same
    // text object the renderer below paints.
    this.disconnectPauseController = new DisconnectPauseController({
      monitor: this.gamepadConnectionMonitor,
      simulation: this.physicsEngine,
      onPause: (event) => this.showDisconnectBanner(event),
      onResume: (event) => this.hideDisconnectBanner(event),
    });
    this.disconnectPauseController.start();
    this.disconnectPauseController.setActive(true);

    // ---- Camera (Sub-AC 2.3) ---------------------------------------------
    // Auto-frame zoom — Smash-style cinematic camera that zooms IN
    // when fighters cluster and OUT when they spread. The HUD lives
    // on a separate UI camera (set up at the end of create()) so
    // zoom on this main camera doesn't push HUD elements off-screen.
    //
    //   • maxZoom 1.4 — ~40% closer than design scale when fighters
    //     are in close combat.
    //   • minZoom 0.45 — pulls back to ~2.2× viewport area when one
    //     fighter is launched past the visible stage edge.
    //   • followLerp 0.35 — tighter target tracking than the 0.18
    //     default; eliminates "lag follow" when sprinting.
    //   • bounds default to the stage's blast zone (now wider per the
    //     bumped BLAST_ZONE_OUTSET) so the camera can dezoom to
    //     follow a launched fighter all the way to the kill line.
    this.cameraController = new CameraController(this, this.activeStage, {
      backgroundColor: '#13131f',
      maxZoom: 1.4,
      minZoom: 0.40, // pulls back further to keep launched fighters in view
      framePadding: 280, // bigger safety margin around target bbox
      followLerp: 0.85, // near-instant target tracking — fighters can't outrun the camera
      zoomLerp: 0.85,   // near-instant zoom adjustment when fighters spread/close
    });

    // ---- Debug HUD ---------------------------------------------------------
    // Tiny static label showing the captured match seed. Replay engineers
    // and bug reporters quote this number — having it on-screen means a
    // screenshot is enough to reconstruct the match. Sourced from
    // `this.matchRngSeed` (captured at match start), not the boot seed.
    this.add
      .text(width - 12, 12, `seed 0x${this.matchRngSeed.toString(16).padStart(8, '0')}`, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#6cf0c2',
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setAlpha(0.7);

    // ---- Controls help overlay -----------------------------------------------
    // Bottom-left readable cheat-sheet — reads the LIVE bindings store
    // so a player who remapped (e.g. AZERTY user moving WASD → ZQSD,
    // attack F → A) sees their actual keys, not the default-preset
    // hardcoded text. AI slots still show their device tag.
    const controlsHelpLines: string[] = [];
    for (const slot of this.playerSlots) {
      const slotConfig = this.activeMatchConfig.players.find(
        (p) => p.index === slot.bindingsSlot,
      );
      const inputType = slotConfig?.inputType;
      const aiTier = slotConfig?.aiDifficulty;
      const tag = `P${slot.bindingsSlot}`;
      if (inputType === 'ai') {
        controlsHelpLines.push(
          `${tag}: AI BOT (${(aiTier ?? 'medium').toUpperCase()})`,
        );
        continue;
      }
      // Read live bindings from the store — `getAction` returns the
      // current ReadonlyArray<InputBinding> for each logical action,
      // and `formatBindingList` produces the display label
      // (`formatKeyCode` / `formatGamepadBinding` under the hood).
      const moveLeft = formatBindingList(
        bindingsStore.getAction(slot.bindingsSlot, 'left'),
      );
      const moveRight = formatBindingList(
        bindingsStore.getAction(slot.bindingsSlot, 'right'),
      );
      const moveUp = formatBindingList(
        bindingsStore.getAction(slot.bindingsSlot, 'up'),
      );
      const moveDown = formatBindingList(
        bindingsStore.getAction(slot.bindingsSlot, 'down'),
      );
      const attack = formatBindingList(
        bindingsStore.getAction(slot.bindingsSlot, 'attack'),
      );
      const special = formatBindingList(
        bindingsStore.getAction(slot.bindingsSlot, 'special'),
      );
      const shield = formatBindingList(
        bindingsStore.getAction(slot.bindingsSlot, 'shield'),
      );
      const grab = formatBindingList(
        bindingsStore.getAction(slot.bindingsSlot, 'grab'),
      );
      controlsHelpLines.push(
        `${tag}: ${moveLeft}/${moveRight}/${moveUp}/${moveDown} move | ${attack} attack | ${special} special | ${shield} shield | ${grab} grab`,
      );
    }
    const controlsHelp = controlsHelpLines.join('\n');
    this.add
      .text(12, height - 12, controlsHelp, {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#a0a0b8',
        backgroundColor: '#000000aa',
        padding: { x: 6, y: 4 },
      })
      .setOrigin(0, 1)
      .setScrollFactor(0)
      .setDepth(1000);

    // ---- Sub-AC 3 of AC 3: FPS counter overlay --------------------------
    // Top-left readout showing render FPS + simulation tick rate +
    // configured 60 FPS target. Replaces the previous inline `fpsText`
    // line so every gameplay scene can opt in by instantiating the
    // shared component instead of re-rolling text + colour logic.
    this.fpsCounter = new FpsCounter(this, {
      leftMargin: 12,
      topMargin: 12,
      fontSize: 14,
    });
    this.frameText = this.add.text(12, 30, '', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#6cf0c2',
    }).setScrollFactor(0);
    this.camText = this.add.text(12, 48, '', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#6cf0c2',
    }).setScrollFactor(0);
    this.p1Text = this.add.text(12, 72, '', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#ffb0a0',
    }).setScrollFactor(0);
    this.p2Text = this.add.text(12, 90, '', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#a0d8ff',
    }).setScrollFactor(0);
    // Top-centre stock readout so both players can see it at a glance.
    this.stockText = this.add
      .text(width / 2, 70, '', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#ffd166',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0);
    // The "GAME!" banner during the post-match freeze. Big and centred so
    // a 4-player FFA can read the result from across the room. Driven
    // by `MatchEndDetector` — the same source-of-truth the scene uses
    // to decide when to start the results scene.
    this.matchOverText = this.add
      .text(width / 2, height / 2, '', {
        fontFamily: 'monospace',
        fontSize: '96px',
        color: '#ffd166',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setVisible(false);

    // ---- AC 14 Sub-AC 3: reconnect-prompt overlay -----------------------
    // Replaces the M1 single-line "controller disconnected" banner with
    // the structured overlay component (`ReconnectPromptOverlay`). The
    // overlay paints the affected slot label, a body-line remediation
    // hint, and a per-slot accent strip. Pinned to the viewport so the
    // player always sees it regardless of camera scroll. Text +
    // visibility are driven by the pause controller's `onPause` /
    // `onResume` hooks via the show/hide handlers above.
    this.reconnectPromptOverlay = new ReconnectPromptOverlay(this, {
      centerX: width / 2,
      centerY: height / 2 - 110,
    });

    // ---- Sub-AC 3 of AC 60003: on-screen damage HUD ----------------------
    // Big, colour-coded percent meter pinned to the bottom of the
    // viewport — one panel per active fighter. Player labels use the
    // same accent colours the visual rectangles do (warm red for Wolf,
    // cool blue for Cat) so a glance ties the meter to its owner. The
    // HUD is render-only; we feed it the live percents in the
    // interpolation hook below.
    this.damageHud = new DamageHud(
      this,
      this.playerSlots.map((slot) => ({
        playerIndex: slot.playerIndex,
        displayName: slot.character.id,
        // Sub-AC 3 of AC 13 — mirror the slot's resolved palette label
        // colour so the HUD reads as belonging to the matching fighter
        // without a legend, and the colour automatically tracks the
        // slot's `paletteIndex` (e.g. two Wolves on different palettes
        // get distinct HUD label tints instead of identical creams).
        labelColor: slot.paletteSwap.labelColor,
      })),
    );

    // Bottom-left recording HUD line — driven by RecordingController.
    // Pinned to the viewport so it doesn't drift with the camera. Uses
    // the same monospace look as the rest of the debug HUD; the actual
    // text is refreshed in the render hook.
    this.recordingHud = this.add
      .text(12, height - 36, '', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ff6b95',
      })
      .setScrollFactor(0)
      .setAlpha(0.85);
    // Toast for save-to-file confirmations (or errors). Centred at the
    // top below the title; hidden by default.
    this.saveToast = this.add
      .text(width / 2, 110, '', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#a4f37b',
        backgroundColor: '#000a',
        padding: { x: 10, y: 6 },
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setVisible(false);

    // ESC opens the in-match PAUSE MENU (Resume / Restart / Character
    // Select / Main Menu / Controls) instead of jumping straight to the
    // main menu — the menu's "Main Menu" option preserves the old exit.
    // `.on` (not `.once`) so it works every pause/resume cycle; guarded
    // so it can't re-open while already paused or during the end-game
    // freeze (the overlay owns ESC-to-resume once it is up).
    this.input.keyboard?.on('keydown-ESC', () => {
      if (this.pausedForMenu) return;
      if (this.matchEndDetector?.isMatchOver()) return;
      this.openPauseMenu();
    });

    // ---- AC 10303 Sub-AC 3: stage music on seamless loop ----------------
    // Construct a scene-owned {@link StageMusicController}. The controller
    // mints its own {@link AudioManager} from `this.sound` (Phaser's
    // BaseSoundManager structurally satisfies the {@link SoundManagerLike}
    // surface), then plays the M1 stage music key on the music bus with
    // `loop: true` baked into the cue config (see DEFAULT_AUDIO_CUES).
    //
    // The cast to {@link SoundManagerLike} is the structural-narrowing
    // hand-off described in the AudioManager module docs: Phaser's
    // {@link Phaser.Sound.BaseSoundManager#add} returns a
    // {@link Phaser.Sound.BaseSound} whose surface (isPlaying, play, stop,
    // setVolume, setMute, once, destroy) matches the {@link SoundLike}
    // interface — no adapter required.
    //
    // `start()` returns a boolean we deliberately ignore: a failure
    // (asset missing, audio context suspended, autoplay refused) is
    // swallowed by the controller's contract and the match continues
    // playing without music. We do log a warning at the boot path so
    // a missing asset shows up in dev rather than silently dropping the
    // soundtrack — but the warning only fires when the cache key is
    // genuinely missing, which the manifest test already guards.
    //
    // Idempotence: a future re-entry into `create()` (Vite HMR or a
    // scene-restart loop) can't double-spawn the voice — the SHUTDOWN
    // handler tears down the previous controller, and the AudioManager
    // path itself returns "same track already playing" if the same key
    // is requested twice. Two layers of defence keep the soundtrack
    // single-source.
    // Stage music is enabled now that a longer track ships in
    // `assets/audio/music/stage_main.ogg` (re-encoded from the user-
    // supplied "French Cancan 8-bit" cover). The earlier `false`
    // guard existed because the only shipped track was the 2-second
    // Kenney jingle (`stage_8bit_loop.ogg`) which looped aggressively
    // — that file is still on disk as the codec-fallback tail of the
    // manifest's URL list, but it's no longer the primary.
    const STAGE_MUSIC_ENABLED = true;
    if (STAGE_MUSIC_ENABLED && this.cache.audio.exists(DEFAULT_STAGE_MUSIC_KEY)) {
      this.stageMusicController = StageMusicController.fromSoundManager(
        this.sound as unknown as SoundManagerLike,
      );
      // Honour the persisted mute flag — a player who muted music in a
      // previous match shouldn't get blasted on the next one.
      const mutedAtStart = this.registry.get(BOOT_REGISTRY_KEYS.musicMuted) === true;
      if (!mutedAtStart) this.stageMusicController?.start();
      // Build the speaker toggle button in the upper-right of the HUD.
      this.buildMusicToggleButton(mutedAtStart);
    } else {
      // Stage music skipped — either disabled by the
      // STAGE_MUSIC_ENABLED guard above, or the audio asset never
      // made it into the cache (preload bypassed, file 404, decode
      // error). Distinguish the two cases in the log so future
      // diagnostics aren't misled by a single catch-all message.
      const reason = !STAGE_MUSIC_ENABLED
        ? 'STAGE_MUSIC_ENABLED is false'
        : `asset '${DEFAULT_STAGE_MUSIC_KEY}' not in audio cache`;
      // eslint-disable-next-line no-console
      console.info(`[MatchScene] stage music skipped — ${reason}.`);
    }

    // ---- AC 30004 Sub-AC 4: save-to-file hotkey -------------------------
    // 'S' is intentionally NOT bound here anymore — players found the
    // mid-match save annoying (a stray S press during play would interrupt
    // input flow). Save now lives on `ResultsScene` via the `lastReplay`
    // registry handoff stashed during the end-of-match transition below.

    // ---- UI camera (HUD/world rendering separation) ----------------------
    // Architectural fix: the HUD must NOT zoom or pan with the main
    // camera. We add a second camera covering the same viewport that
    // ONLY renders HUD elements (anything with scrollFactor === 0).
    // The main camera in turn ignores those HUD elements, so each
    // GameObject is rendered exactly once — by whichever camera owns
    // it.
    //
    // Partition rule: scrollFactorX === 0 && scrollFactorY === 0 →
    // HUD (rendered by uiCamera). Anything else → world (rendered by
    // main camera). New GameObjects added during gameplay (shield
    // bubbles, spawn-platform overlays, disconnect banner) inherit
    // the partition via the ADDED_TO_SCENE event handler.
    const isHud = (obj: Phaser.GameObjects.GameObject): boolean => {
      // Stage-background layers are scrollFactor-0 too (they parallax
      // via manual position offsets, not camera scroll) but they belong
      // to the WORLD camera — they sit at depth ≤ BACKGROUND_AMBIENT_DEPTH
      // (−30) and must render UNDER the fighters. Without this depth
      // carve-out the partition rule classifies the full-screen
      // gradient as HUD and the UI camera paints it OVER the entire
      // world render — invisible fighters on every themed stage.
      const depth = (obj as { depth?: number }).depth ?? 0;
      if (depth <= BACKGROUND_AMBIENT_DEPTH) return false;
      const x = (obj as { scrollFactorX?: number }).scrollFactorX;
      const y = (obj as { scrollFactorY?: number }).scrollFactorY;
      return x === 0 && y === 0;
    };
    const uiCamera = this.cameras.add(0, 0, width, height);
    uiCamera.setName('UI');
    // Initial partition of every GameObject already on the display list.
    for (const obj of this.children.list) {
      if (isHud(obj)) {
        this.cameras.main.ignore(obj);
      } else {
        uiCamera.ignore(obj);
      }
    }
    // Auto-partition new GameObjects as they're added during gameplay
    // (shield bubbles, spawn platform overlays, reconnect overlay).
    //
    // CRITICAL: this listener MUST be detached in the SHUTDOWN handler
    // below. Phaser only clears `this.events` listeners on scene
    // `destroy()` — not on `shutdown()`. Without an explicit `.off()`,
    // a left-over listener from the previous match runs during the new
    // match's `create()`, sees the OLD uiCamera reference (now
    // destroyed but its bit-id is reused for the new uiCamera), and
    // double-sets `cameraFilter` so the HUD ends up ignored by BOTH
    // the new main and the new uiCamera. That's the rematch
    // disappearing-HUD bug.
    const onAdded = (obj: Phaser.GameObjects.GameObject) => {
      if (isHud(obj)) {
        this.cameras.main.ignore(obj);
      } else {
        uiCamera.ignore(obj);
      }
    };
    this.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, onAdded);
    this.cameraPartitionListener = onAdded;

    // F9 — dump the platform-driver diagnostic ring buffer (see
    // `recordPlatDiag`) as a JSON download. Debug aid for the
    // "platform landing feels history-dependent" reports: press it the
    // moment a landing misbehaves and share the file.
    this.input.keyboard?.on('keydown-F9', () => {
      const data = JSON.stringify({
        stage: this.activeStage?.backgroundTheme ?? 'unknown',
        entries: this.platformDiagLog,
      });
      // eslint-disable-next-line no-console
      console.log(`[plat-diag] dumping ${this.platformDiagLog.length} entries`);
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'platform-diag.json';
      a.click();
      URL.revokeObjectURL(url);
    });

    // ---- F3 — toggle the hitbox debug overlay --------------------------
    // Mirrors the F9 platform-diag keybinding pattern: a single keydown
    // handler flips the {@link HitboxDebugLayer} on / off and updates the
    // HUD hint label. The overlay is a pure visualisation (no sim
    // effect); the world-space boxes are partitioned to the world camera
    // by the layer's default scrollFactor, while the hint text below is a
    // HUD element (scrollFactor 0). Detached implicitly on SHUTDOWN — the
    // input plugin is torn down by Phaser's scene shutdown, and the
    // overlay + hint GameObjects are destroyed in the SHUTDOWN handler.
    const HITBOX_HINT_ON = 'F3: hitboxes ON';
    const HITBOX_HINT_OFF = 'F3: hitboxes';
    // Unobtrusive bottom-left, above the damage HUD strip. Dim grey so it
    // reads as a dev affordance, not gameplay UI; brightens when active.
    this.hitboxDebugHintText = this.add
      .text(12, height - 92, HITBOX_HINT_OFF, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#888888',
      })
      .setScrollFactor(0)
      .setDepth(120);
    this.input.keyboard?.on('keydown-F3', () => {
      const enabled = this.hitboxDebugLayer.toggle();
      this.hitboxDebugHintText?.setText(enabled ? HITBOX_HINT_ON : HITBOX_HINT_OFF);
      this.hitboxDebugHintText?.setColor(enabled ? '#ff6060' : '#888888');
    });

    // Reset deterministic state when the scene shuts down.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      // Detach the camera partition listener first — Phaser's
      // SHUTDOWN doesn't clear `this.events` listeners (only DESTROY
      // does), so leaving this attached would leak it into the next
      // create() and let it set stale cameraFilter bits before the
      // new partition runs.
      if (this.cameraPartitionListener) {
        this.events.off(
          Phaser.Scenes.Events.ADDED_TO_SCENE,
          this.cameraPartitionListener,
        );
        this.cameraPartitionListener = null;
      }
      if (this.matter?.world) {
        this.matter.world.autoUpdate = true;
      }
      this.physicsEngine.reset();
      this.cameraController?.destroy();
      // Detach the blast-zone listener BEFORE destroying the characters
      // (whose own teardown also fires `world.off` for their support
      // listeners). Unsubscribing in the wrong order is harmless but
      // we want to be explicit.
      if (this.collisionStartHandler) {
        this.matter?.world?.off('collisionstart', this.collisionStartHandler);
        this.collisionStartHandler = null;
      }
      // Sub-AC 3 of AC 9: detach the lava end-handler before the
      // hazard bodies are destroyed so a final `collisionend` (which
      // Matter sometimes fires when bodies are removed mid-frame)
      // can't reference a half-torn-down watcher.
      if (this.collisionEndHandler) {
        this.matter?.world?.off('collisionend', this.collisionEndHandler);
        this.collisionEndHandler = null;
      }
      if (this.passThroughPlatformHandler) {
        this.matter?.world?.off('beforeupdate', this.passThroughPlatformHandler);
        this.passThroughPlatformHandler = null;
      }
      if (this.fighterSeparationHandler) {
        this.matter?.world?.off('afterupdate', this.fighterSeparationHandler);
        this.fighterSeparationHandler = null;
      }
      this.blastZoneWatcher?.reset();
      // Sub-AC 2 of AC 60202: drop registered bodies + out-of-bounds
      // latches so a fresh match starts with an empty position-watch
      // registry.
      this.blastZonePositionWatcher?.reset();
      // Sub-AC 3 of AC 303: drop slot bindings, side-effect hooks, and
      // any active spawn-platform overlays so a re-entry into MatchScene
      // starts with a clean handler. Phaser visuals owned by the
      // platform map are destroyed below; clearing the handler first
      // ensures the (now-orphaned) platform records can't resurrect
      // them via a stale getActiveSpawnPlatforms() call.
      this.respawnHandler?.reset();
      for (const visuals of this.spawnPlatformVisuals.values()) {
        visuals.rect.destroy();
        visuals.glow.destroy();
      }
      this.spawnPlatformVisuals.clear();
      // AC 60401 Sub-AC 1: tear down the per-fighter shield bubble
      // GameObjects so a re-entered match doesn't leak orphaned arcs
      // into the next scene's display list. `ShieldBubble.destroy()`
      // is idempotent so a defensive double-call (a SHUTDOWN handler
      // that was wired multiple times) won't crash.
      for (const bubble of this.shieldBubbles.values()) {
        bubble.destroy();
      }
      this.shieldBubbles.clear();
      // Tear down the per-fighter charge / wind-up indicator GameObjects
      // the same way so a re-entered match doesn't leak orphaned aura
      // arcs / bar rectangles. `ChargeIndicator.destroy()` is idempotent
      // so a defensive double-call won't crash.
      for (const indicator of this.chargeIndicators.values()) {
        indicator.destroy();
      }
      this.chargeIndicators.clear();
      // Hit-feedback FX + F3 debug overlay teardown — destroy every
      // pooled / per-fighter GameObject so a re-entered match doesn't
      // leak orphaned sparks / trail rects / the debug Graphics into the
      // next scene's display list. Every `destroy()` is idempotent so a
      // defensive double-shutdown won't crash.
      for (const trail of this.swingTrails.values()) {
        trail.destroy();
      }
      this.swingTrails.clear();
      this.hitSparkPool?.destroy();
      // One-shot burst flashes (dive landings + muzzle flashes).
      for (const b of this.oneShotBursts) b.arc.destroy();
      this.oneShotBursts = [];
      this.hitboxDebugLayer?.destroy();
      this.hitboxDebugHintText?.destroy();
      this.hitboxDebugHintText = null;
      // M2 — clear extra fighter slot arrays so a rematch starts
      // empty. The Character / Sprite / Rectangle / Triangle
      // GameObjects are destroyed by Phaser's own scene-shutdown
      // sweep; we just drop our references here.
      this.extraFighters = [];
      this.extraVisuals = [];
      this.extraSprites = [];
      this.extraFacingMarks = [];
      this.hitboxDamageHandler?.reset();
      this.matchEndDetector?.reset();
      // Sub-AC 1 + Sub-AC 3 of AC 16 — drop accumulated KOs / damage /
      // survival counters so a re-entered match doesn't show the
      // previous match's leaderboard. The tracker is reconstructed on
      // the next `create()`, but resetting here guards any code path
      // that holds a stale reference (e.g. a still-pending tween
      // callback) from reading orphaned values.
      this.matchStatsTracker?.reset();
      // AC 50202 Sub-AC 2: tear down the unified action-state plumbing.
      // Reset the central {@link InputResolver} so a re-entry into
      // MatchScene starts with neutral previous-frame snapshots for
      // every tracked slot (otherwise a button held through a scene
      // transition would phantom-`justPressed` on the very next
      // match's first update).
      this.inputResolver?.reset();
      // AC 14 Sub-AC 2: tear down the disconnect-pause controller and
      // its underlying monitor before the engine is reset. Calling the
      // controller's `setActive(false)` first releases any pause it
      // currently holds (otherwise a SHUTDOWN with the engine paused
      // would leak the freeze into the next scene). Then `stop()`
      // detaches its listener subscription on the monitor; the
      // monitor's own `stop()` detaches the browser-level listeners.
      if (this.disconnectPauseController) {
        this.disconnectPauseController.setActive(false);
        this.disconnectPauseController.stop();
        this.disconnectPauseController = null;
      }
      // AC 14 Sub-AC 4: tear down the reconnection handler. Goes
      // dormant first to drop any tracked records (a half-resolved
      // disconnect carrying into the next scene would silently rewire
      // bindings on whatever pad happened to plug in next); then
      // `stop()` detaches its monitor subscription.
      if (this.controllerReconnectionHandler) {
        this.controllerReconnectionHandler.setActive(false);
        this.controllerReconnectionHandler.stop();
        this.controllerReconnectionHandler = null;
      }
      if (this.gamepadConnectionMonitor) {
        this.gamepadConnectionMonitor.stop();
        this.gamepadConnectionMonitor = null;
      }
      // AC 14 Sub-AC 3: dispose the reconnect-prompt overlay's Phaser
      // children. Idempotent on re-call so a SHUTDOWN that already ran
      // once doesn't crash on the second pass.
      if (this.reconnectPromptOverlay) {
        this.reconnectPromptOverlay.destroy();
        this.reconnectPromptOverlay = null;
      }
      // ---- AC 10303 Sub-AC 3: stop + clean up the stage music ---------
      // SHUTDOWN must:
      //   • Stop the looping music track so a re-entry into MatchScene
      //     doesn't double up the soundtrack on top of itself (without
      //     this, two voices of the same loop would phase against each
      //     other on the next match).
      //   • Tear down the AudioManager the controller owns so every
      //     active SFX voice is released — otherwise a long-tail SFX
      //     (KO crash, shield clang) could outlive the scene and the
      //     next scene would inherit a half-living voice slot.
      //   • Null the reference so a defensive double-shutdown can't
      //     dereference a torn-down controller. The optional chain on
      //     `?.destroy()` already guards against `null`; the explicit
      //     null after destroy keeps the field's invariant ("non-null
      //     iff a music track is alive") greppable.
      //
      // Idempotent — `StageMusicController.destroy()` is itself a no-op
      // on second call, so a Phaser SHUTDOWN that fires twice during a
      // scene transition is safe.
      this.stageMusicController?.destroy();
      this.stageMusicController = null;
      // AC 10304 — tear down the scene-owned SFX AudioManager. Its
      // `destroy()` stops every active voice (including a lingering
      // charge loop) and marks the manager dead so any late fighter
      // emit short-circuits. Idempotent. The charge-loop bookkeeping is
      // cleared too so a scene re-entry starts with no stale "looping"
      // flag (the fresh manager would otherwise never re-trigger the
      // start edge).
      this.sfxAudioManager?.destroy();
      this.sfxAudioManager = null;
      this.chargeLoopActive.clear();
      // Tear down the music toggle button — its closure captures
      // `this.stageMusicController`, so leaving it alive across a
      // scene re-entry would dispatch onto a destroyed controller.
      this.musicToggleButton?.destroy();
      this.musicToggleButton = null;
      // AC 30004 Sub-AC 4: tear down the recording controller BEFORE
      // resetting the underlying buffer — the controller's `reset()`
      // returns it to IDLE so a re-entry into MatchScene starts a
      // fresh recording. The buffer reset happens explicitly below
      // because the controller doesn't own scene-supplied buffers.
      this.recordingController?.reset();
      // AC 30002 Sub-AC 2: drop the capture log so a re-entry into
      // MatchScene doesn't accidentally inherit the previous match's
      // frames. The replay-export path persists the log via the save
      // hotkey BEFORE shutdown if the player wants to keep it.
      this.inputCaptureBuffer?.reset();
      // Sub-AC 3 of AC 60003: drop the HUD's text objects so a fresh
      // match doesn't double-create them on top of the previous run.
      this.damageHud?.destroy();
      // Sub-AC 3 of AC 3: tear down the FPS overlay so the next match
      // boots with a clean rolling-window tick meter (otherwise the
      // first 500 ms of the new match would still see samples from the
      // previous run's last frame).
      this.fpsCounter?.destroy();
      // Sub-AC 2 of AC 10402 — detach per-slot sprite animation state
      // machines so a defensive late-tick after SHUTDOWN doesn't try to
      // dispatch a `play()` against a destroyed sprite.
      if (this.playerSlots) {
        for (const slot of this.playerSlots) {
          slot.spriteAnimSm?.detach();
        }
      }
      this.p1?.destroy();
      this.p2?.destroy();
      // ---- Stage teardown (AC 20101 Sub-AC 1 — BaseStage) ------------
      // Tear the whole stage down in one call. BaseStage drops
      // hazard watchers FIRST (so a stray late `collisionend` can't
      // reach a half-torn-down state), then destroys hazard
      // renderers (sensor bodies + visuals), then the platform /
      // blast-zone geometry. Idempotent on second call. Null the
      // mirrored field references so a defensive late access from a
      // pending callback can't dereference a destroyed handle.
      this.baseStage?.destroy();
      // Themed background teardown — destroy() is idempotent; nulling
      // the handle keeps a late tick()/updateParallax() harmless.
      this.stageBackground?.destroy();
      this.stageBackground = null;
      // ---- AC 90302 Sub-AC 2: items framework spawn-manager teardown -----
      // Drop the per-match item-spawn scheduler so a re-entry into
      // MatchScene starts with a clean schedule. The manager itself is
      // Phaser-free + entity-free + Matter-free — it owns no GameObjects,
      // no listeners, and no Matter bodies — so teardown is just nulling
      // the reference. Its `'item-spawn'` RNG substream lives on the
      // match-scoped {@link MatchRng} which is reset / dropped via the
      // registry-clear below, so the substream's PRNG state is also
      // released.
      this.itemSpawnManager = null;
      // Tear down item visuals so a rematch starts with an empty
      // stage — the data-layer registry is reset elsewhere; these
      // are the Phaser-side handles owned by the render integration.
      for (const container of this.itemVisuals.values()) {
        container.destroy();
      }
      this.itemVisuals.clear();
      this.itemSurfaceY.clear();
      this.itemFallingY.clear();
      this.itemRegistry.reset();
      // Drop the spawn-event log too — it enforces monotonically
      // increasing frame numbers for replay determinism, and a
      // rematch's first spawn frame (e.g. 385) would otherwise be
      // rejected because the prior match's last frame (e.g. 2459)
      // still sits in the log.
      this.itemSpawnEventLog.reset();
      // Drop per-player inventories so a rematch's pickup wiring
      // starts empty rather than carrying a stale held item.
      this.inventoriesByPlayerIndex.clear();
      // Tear down any in-flight projectiles + their visuals.
      for (const p of this.projectiles) p.container.destroy();
      this.projectiles = [];
      this.projectileSpawnLatch.clear();
      this.nextProjectileId = 0;
      // Tear down thrown items + swing-flash visuals.
      for (const t of this.thrownItems) t.container.destroy();
      this.thrownItems = [];
      for (const f of this.swingFlashes) f.container.destroy();
      this.swingFlashes = [];
      for (const b of this.explosionBursts) b.sprite.destroy();
      this.explosionBursts = [];
      for (const b of this.oneShotBursts) b.arc.destroy();
      this.oneShotBursts = [];
      this.prevGrabHeld.clear();
      this.suppressAttackUntilRelease.clear();
      // Clear the per-match RNG references on shutdown so a fresh
      // match doesn't accidentally inherit the previous match's PRNG
      // state (which would silently break determinism for AI/hazards
      // that pull from the registry instead of the live scene).
      this.registry.remove(BOOT_REGISTRY_KEYS.matchRng);
      this.registry.remove(BOOT_REGISTRY_KEYS.matchRngSeed);
    });
  }

  /**
   * Phaser invokes `update(time, delta)` on every rAF. We forward the
   * wall-clock delta to the deterministic loop. The accumulator inside
   * `PhysicsEngine` decides how many fixed 16.67 ms physics steps to run
   * (0..N) and renders exactly once per tick with an interpolation alpha.
   */
  update(_time: number, deltaMs: number): void {
    // ---- Pause menu (START / ESC) -----------------------------------------
    // Poll the gamepad START button (ESC is handled by its keydown
    // listener). Opening is gated to an actively-playing match so a
    // press during the end-game freeze can't strand the overlay. While
    // paused, return BEFORE touching the deterministic loop so the
    // accumulator never advances — the match freezes as a still-life
    // under the overlay and resumes byte-identically.
    if (!this.pausedForMenu && !this.matchEndDetector?.isMatchOver()) {
      const startPressed = this.isStartButtonHeld();
      if (startPressed && !this.prevStartHeld) this.openPauseMenu();
      this.prevStartHeld = startPressed;
    }
    if (this.pausedForMenu) {
      return;
    }
    const stepsThisTick = this.physicsEngine.advance(
      deltaMs,
      () => {
        const frame = this.physicsEngine.getFrame();
        // Sub-AC 4.3: while the detector is in the ENDING (post-match)
        // phase, freeze the simulation. We still tick the detector so
        // the freeze counts down deterministically, but we don't sample
        // inputs, don't step Matter, and don't drain respawns. Fighters
        // come to rest exactly on the deciding KO frame; the scene
        // becomes a still life until the transition fires.
        const matchOverFrozen = this.matchEndDetector.isMatchOver();

        if (!matchOverFrozen) {
          // ---- Inputs (AC 204 Sub-AC 4 → AC 5 Sub-AC 3 → AC 50202 Sub-AC 2)
          // Sample BEFORE stepping the world so the per-step velocity
          // commit in `Character.applyInput` is integrated by the very
          // next Matter step.
          //
          // AC 5 Sub-AC 3 — the input loop is slot-uniform: for every
          // entry in `playerSlots` we resolve the slot's
          // `CharacterInput` through the central InputResolver keyed
          // by `slot.bindingsSlot` (1–4). The bindings-slot index
          // selects the per-player profile in the live
          // {@link InputBindingsStore}, so gameplay reads remapped
          // keyboard/gamepad inputs for every player from their
          // per-player binding profile — no hardcoded WASD / arrow /
          // button-index path is left in this hot loop. The same loop
          // scales unchanged when 4-player wiring grows `playerSlots`
          // to 4 entries: P3 / P4 just read through their gamepad
          // profiles via the same call.
          //
          // AC 50202 Sub-AC 2 — every gameplay consumer (movement /
          // jump logic, attack and special triggers, shield / grab /
          // dodge handlers) reads inputs through the central
          // {@link InputResolver}. The resolver is updated exactly
          // once per fixed step so a single device sample feeds every
          // per-slot read; it exposes `getAction(playerIndex,
          // actionName)` / `isActionHeld(playerIndex, actionName)` /
          // `getMoveVector(playerIndex)` over the eight action
          // categories the Seed names (`move{Left,Right,Up,Down}` /
          // jump / attack / special / shield / grab / dodge); the
          // {@link buildCharacterInputFromResolver} helper translates
          // the resolver's per-player snapshot into the
          // `CharacterInput` record the runtime consumes. There is
          // no raw key code, gamepad button index, or device-specific
          // lookup left in the gameplay path — every action category
          // routes through the rebindable binding layer (resolver →
          // dispatcher → bindings store).
          //
          // Sub-AC 4.2: skip applyInput for eliminated fighters so a
          // ghost body on the eliminated slot doesn't keep responding
          // to its bindings. The body is left in the world but
          // unregistered from the blast-zone watcher; we'll hide its
          // visuals further down.
          //
          // AC 30002 Sub-AC 2: capture the per-player snapshot into the
          // input buffer keyed by frame number. The buffer normalises
          // each entry into a closed `RecordedCharacterInput` so the
          // (later-AC) replay player can feed it back into
          // `applyInput` byte-for-byte. Eliminated slots collapse to
          // `undefined` here, which the buffer records as
          // `NEUTRAL_INPUT` — preserving the "exactly playerCount
          // entries per frame" invariant.
          //
          // Single device poll feeds every consumer: refresh the
          // resolver ONCE here so the subsequent per-slot translator
          // calls all read off the same snapshot — no double-polling,
          // no per-slot device sample.
          this.inputResolver.update(frame);
          const frameInputs: Array<CharacterInput | undefined> =
            new Array(this.playerSlots.length);
          for (let i = 0; i < this.playerSlots.length; i += 1) {
            const slot = this.playerSlots[i]!;
            if (this.stockTracker.isEliminated(slot.playerIndex)) {
              frameInputs[i] = undefined;
              continue;
            }
            // Per-player binding lookup: slot.bindingsSlot ∈ {1..4}
            // selects which binding profile in the shared store the
            // dispatcher reads, so each player's keyboard / gamepad
            // sources go through the rebinds they configured (or the
            // defaults, if they never visited the rebinding screen).
            //
            // AC 50202 Sub-AC 2: resolve the slot's `CharacterInput`
            // through the central InputResolver — every action
            // (move vector, jump, attack, special, shield, grab,
            // dodge) is read by name through `resolver.getAction(...)
            // ` / `resolver.isActionHeld(...)`, and the result is
            // folded into the `CharacterInput` shape that
            // `Character.applyInput` consumes.
            // M2 AI bots: if this slot's `inputType` is 'ai', drive
            // it from the simpleBot AI instead of reading keyboard/
            // gamepad. Tier maps from `aiDifficulty` ('easy'|'medium'|
            // 'hard'). Stub AI walks toward the nearest opponent and
            // presses attack in range; full Easy/Medium/Hard tier
            // integration (WorldSnapshot + behavior tree) is next.
            const slotConfig = this.activeMatchConfig.players.find(
              (p) => p.index === slot.bindingsSlot,
            );
            const aiTier: 'easy' | 'medium' | 'hard' | null =
              slotConfig?.inputType === 'ai'
                ? (slotConfig.aiDifficulty ?? 'medium')
                : null;
            let input: CharacterInput;
            if (aiTier) {
              const selfPos = slot.character.getPosition();
              const others = this.playerSlots
                .filter((s) => s.playerIndex !== slot.playerIndex
                  && !this.stockTracker.isEliminated(s.playerIndex))
                .map((s) => ({
                  playerIndex: s.playerIndex,
                  position: s.character.getPosition(),
                  grounded: s.character.isGrounded(),
                }));
              input = simpleBotInput(
                slot,
                {
                  playerIndex: slot.playerIndex,
                  position: selfPos,
                  grounded: slot.character.isGrounded(),
                },
                others,
                aiTier,
              );
            } else {
              input = buildCharacterInputFromResolver(
                this.inputResolver,
                slot.bindingsSlot,
              );
            }
            frameInputs[i] = input;
            // ---- Item pickup wiring (T3 / AC 11) ----------------------
            // Per the PickupController contract, fire on the rising
            // edge of the attack press BEFORE applyInput so a
            // successful pickup installs slot overrides that the same
            // frame's tickAttack consults. Without this, picking up
            // an item and using it would split across two frames.
            // Inventory is lazy-init'd per slot the first time we see
            // it — single-slot per fighter.
            // Read the persistent post-pickup suppress latch first —
            // if a pickup just succeeded on a previous frame and the
            // player is STILL holding the attack button, we keep
            // forcing it false so the bomb / bat / ray gun's
            // slot-override doesn't fire as soon as the rising-edge
            // detector wakes up.
            let suppressAttack = this.suppressAttackUntilRelease.get(slot.playerIndex) ?? false;
            // The latch clears the moment the user releases.
            if (suppressAttack && !input.attack) {
              suppressAttack = false;
              this.suppressAttackUntilRelease.set(slot.playerIndex, false);
            }
            let pickedUpThisFrame = false;
            if (input.attack && !suppressAttack && !this.stockTracker.isEliminated(slot.playerIndex)) {
              let inventory = this.inventoriesByPlayerIndex.get(slot.playerIndex);
              if (!inventory) {
                inventory = new Inventory(slot.character);
                this.inventoriesByPlayerIndex.set(slot.playerIndex, inventory);
              }
              const picked = this.pickupController.tryPickup(
                slot.character,
                inventory,
                this.itemRegistry,
                slot.playerIndex,
                frame,
                true,
              );
              if (picked !== null) {
                pickedUpThisFrame = true;
                // Latch: keep suppressing attack until the player
                // releases the button. Clears in the branch above on
                // the first frame `input.attack` is false.
                this.suppressAttackUntilRelease.set(slot.playerIndex, true);
                suppressAttack = true;
              }
            }
            // User feedback: picking up an item should NOT also fire
            // the item's use on the same frame. While the suppress
            // latch is armed (pickup just happened, player still
            // holding attack), force `input.attack` false so the
            // rising-edge detector inside Character.applyInput stays
            // quiet until the next clean press.
            void pickedUpThisFrame;
            const inputForCharacter = suppressAttack
              ? { ...input, attack: false }
              : input;
            slot.character.applyInput(inputForCharacter);
            // ---- Held-item position tracking ---------------------------
            // While holding, the item's snapshot position mirrors the
            // holder's HAND each tick — body centre + the fighter's
            // grip anchor, mirrored by facing — so the visual sits in
            // the hand (not at the waist), swaps sides on turnaround,
            // and the throw / projectile spawn origin reads from the
            // same point the player sees the weapon at.
            const inv = this.inventoriesByPlayerIndex.get(slot.playerIndex);
            const heldItem = inv?.getHeldItem();
            if (heldItem) {
              heldItem.updateHeldPosition(
                computeHeldItemPosition(
                  slot.character.getPosition(),
                  slot.character.getFacing(),
                  slot.character.id,
                ),
              );
            }
          }
          this.inputCaptureBuffer.captureFrame(frame, frameInputs);

          // ---- Ledge-TRUMP (Ultimate ledge-occupancy) -------------------
          // A fighter that JUST grabbed a ledge another was already hanging on
          // steals it and knocks the prior occupant off. Resolved here, after
          // every fighter's applyInput, against the previous step's keys.
          {
            const trumpSnaps = this.playerSlots.map((s) => {
              const nowKey = s.character.getHangingLedgeKey();
              const wasKey = this.prevLedgeKeys.get(s.playerIndex) ?? null;
              return {
                id: s.playerIndex,
                wasHanging: wasKey !== null,
                wasKey,
                nowHanging: nowKey !== null,
                nowKey,
              };
            });
            for (const victimId of resolveLedgeTrumps(trumpSnaps)) {
              this.playerSlots
                .find((s) => s.playerIndex === victimId)
                ?.character.trumpOffLedge();
            }
            for (const s of this.playerSlots) {
              this.prevLedgeKeys.set(
                s.playerIndex,
                s.character.getHangingLedgeKey(),
              );
            }
          }

          // ---- Hazard pre-step tick (AC 20101 Sub-AC 1 — BaseStage) ----
          // Tick every hazard entity (lava + wind, plus any future
          // hazard family the stage owns) exactly once before
          // `matter.world.step` so the freshly-computed bounds /
          // active state are reflected in the sensor body update —
          // and so a fighter that walks onto newly-active lava on
          // this step gets KO'd at the same frame the lava became
          // lethal. The stage is a no-op on hazard-free layouts so
          // the flat stage still pays zero cost.
          this.baseStage.tickHazards(frame);
          // Ambient background pulse rides the same fixed frame counter
          // so replays repaint identically.
          this.stageBackground?.tick(frame);

          // One deterministic 16.67 ms physics step. Step the Matter world
          // explicitly so its integration uses *our* fixed dt, not Phaser's
          // variable rAF delta. Blast-zone collisions for *this* step's
          // motion fire during this call and the watcher records stock
          // losses against the current frame.
          this.matter.world.step(this.physicsEngine.fixedTimestepMs);

          // ---- Hazard post-step effects (AC 20101 Sub-AC 1 — BaseStage)
          // Drains the lava-KO and wind-force overlap queues. Lava
          // fires once per overlap session (leave + re-enter to re-
          // arm); wind is continuous (every active tick fires — the
          // gust is supposed to push every frame). Same `frame` that
          // drove `tickHazards` is forwarded so the listener
          // callbacks stamp the correct simulation frame onto stats /
          // replay events. No-op on hazard-free stages.
          this.baseStage.applyHazardEffects(frame);

          // ---- AC 90302 Sub-AC 2: items framework spawn-manager tick ---
          // Advance the per-match item-spawn schedule by exactly one
          // fixed-step. Driven AFTER hazard effects so the spawn cadence
          // observes the same `frame` the rest of the simulation just
          // committed against — every replay reproduces the same spawn
          // schedule tick-for-tick under the same `MatchConfig`.
          //
          // `activeItemCount` is hard-zero for now because the item-
          // entity layer (and its live-on-field registry) lands in a
          // later sub-AC. The manager treats `0` as "field empty, OK to
          // spawn" — which is the correct steady-state for a match with
          // no item entities yet. Once the entity layer wires in, the
          // count will read from the live items registry instead.
          //
          // Returned spawn requests are intentionally discarded here:
          // sub-AC 2 wires only the lifecycle so the `'item-spawn'` RNG
          // substream begins materialising from the canonical match-start
          // tick. A follow-up sub-AC will replace the discard with a
          // real `spawnItemAt(req.anchor, req.frame)` callsite without
          // touching the lifecycle wiring established here.
          if (this.itemSpawnManager) {
            // T3 (AC 10, 17) — drive the spawn manager with the live
            // active count so the on-field cap is respected.
            const reqs = this.itemSpawnManager.step(
              frame,
              this.itemRegistry.getActiveCount(),
            );
            // Inline viewport-translation closures because the
            // `toViewportX/Y` helpers from `create()` aren't in scope
            // here in `update()`. Same math, same source of truth.
            const stageOffsetX = this.baseStage.transform.offsetX;
            const stageOffsetY = this.baseStage.transform.offsetY;
            const stageScale = this.stage.scale;
            const toVx = (dx: number): number => stageOffsetX + dx * stageScale;
            const toVy = (dy: number): number => stageOffsetY + dy * stageScale;
            for (const req of reqs) {
              const def = this.nextItemType();
              const entity = this.itemRegistry.spawn(
                def,
                req.spawnPosition,
                req.frame,
                ItemEntity,
              );
              this.itemSpawnEventLog.record({
                frame: req.frame,
                type: def.type,
                x: req.spawnPosition.x,
                y: req.spawnPosition.y,
                anchorIndex: req.anchorIndex,
              });
              // ---- Phaser render integration --------------------------
              // Visuals attached here so items are visible. Color
              // codes per category; letter label identifies the type.
              const fillColor =
                def.category === 'melee-weapon'
                  ? 0x8b6f47 // wood brown — bat
                  : def.category === 'ranged-weapon'
                  ? 0x40c4ff // cyan — ray gun
                  : def.category === 'throwable'
                  ? 0xff4444 // red — bomb
                  : 0xc8a2ff; // violet — effect/consumable
              const labelChar =
                def.type === 'bat'
                  ? 'B'
                  : def.type === 'sword'
                  ? 'S'
                  : def.type === 'hammer'
                  ? 'H'
                  : def.type === 'spear'
                  ? 'P'
                  : def.type === 'rayGun'
                  ? 'R'
                  : def.type === 'bomb'
                  ? '!'
                  : '?';
              const vx = toVx(req.spawnPosition.x);
              const vy = toVy(req.spawnPosition.y);
              // Per-category silhouettes so weapons read at a glance
              // even without sprite art. Container's "anchor point"
              // is at the BOTTOM of each shape — i.e. drawing from
              // y = container.y upward — so when container.y matches
              // the platform top, the visible silhouette sits ON the
              // platform instead of sinking halfway through it.
              const visualParts: Phaser.GameObjects.GameObject[] = [];
              if (def.type === 'sword') {
                // Sword — long steel blade + crossguard + grip. The
                // blade reads as the longest thin silhouette so the
                // tipper weapon is recognisable at a glance.
                const blade = this.add
                  .rectangle(0, -24, 8, 40, 0xd8dde6, 1)
                  .setStrokeStyle(2, 0x000000, 0.7);
                const guard = this.add
                  .rectangle(0, -5, 18, 4, 0xc9a86a, 1)
                  .setStrokeStyle(1, 0x000000, 0.6);
                const grip = this.add
                  .rectangle(0, 0, 6, 8, 0x4d3a23, 1)
                  .setStrokeStyle(1, 0x000000, 0.6);
                visualParts.push(blade, guard, grip);
              } else if (def.type === 'hammer') {
                // Hammer — short shaft with a massive head: the
                // unmistakable "this thing KOs" silhouette.
                const shaft = this.add
                  .rectangle(0, -14, 7, 30, 0x8b6f47, 1)
                  .setStrokeStyle(2, 0x000000, 0.7);
                const head = this.add
                  .rectangle(0, -30, 30, 16, 0x9aa3ad, 1)
                  .setStrokeStyle(2, 0x000000, 0.7);
                visualParts.push(shaft, head);
              } else if (def.type === 'spear') {
                // Spear — the longest, thinnest shaft with a leaf tip.
                const shaft = this.add
                  .rectangle(0, -24, 5, 46, 0x8b6f47, 1)
                  .setStrokeStyle(2, 0x000000, 0.7);
                const tip = this.add
                  .triangle(0, -50, 0, 8, 5, 0, 10, 8, 0xd8dde6)
                  .setStrokeStyle(1, 0x000000, 0.7);
                visualParts.push(shaft, tip);
              } else if (def.category === 'melee-weapon') {
                // Bat — procedural tapered baseball-bat PNG
                // (`ASSET_KEYS.itemBat`). Falls back to the legacy
                // shaft+grip rectangles if the texture failed to load.
                if (this.textures.exists(ASSET_KEYS.itemBat)) {
                  const sprite = this.add.image(0, -16, ASSET_KEYS.itemBat)
                    .setOrigin(0.5, 0.5)
                    .setDisplaySize(14, 40);
                  visualParts.push(sprite);
                } else {
                  const shaft = this.add
                    .rectangle(0, -16, 12, 32, fillColor, 1)
                    .setStrokeStyle(2, 0x000000, 0.7);
                  const grip = this.add
                    .rectangle(0, -2, 8, 4, 0x4d3a23, 1)
                    .setStrokeStyle(1, 0x000000, 0.6);
                  visualParts.push(shaft, grip);
                }
              } else if (def.category === 'ranged-weapon') {
                // Ray gun — Kenney Platformer Art Deluxe `raygun.png`
                // (`ASSET_KEYS.itemRayGun`). Falls back to the legacy
                // body+barrel rectangles if the texture didn't load.
                if (this.textures.exists(ASSET_KEYS.itemRayGun)) {
                  const sprite = this.add.image(0, -14, ASSET_KEYS.itemRayGun)
                    .setOrigin(0.5, 0.5)
                    .setDisplaySize(34, 30);
                  visualParts.push(sprite);
                } else {
                  const body = this.add
                    .rectangle(0, -10, 24, 20, fillColor, 1)
                    .setStrokeStyle(2, 0x000000, 0.7);
                  const barrel = this.add
                    .rectangle(12, -12, 14, 6, 0xaaeaff, 1)
                    .setStrokeStyle(1, 0x000000, 0.6);
                  visualParts.push(body, barrel);
                }
              } else if (def.category === 'throwable') {
                // Bomb — Kenney Particle Pack `fire_01.png` resized
                // to 40×40 with a procedural fuse on top, registered
                // as `ASSET_KEYS.itemBomb`. Falls back to the
                // procedural circle+fuse if the texture didn't load
                // (e.g. headless tests).
                if (this.textures.exists(ASSET_KEYS.itemBomb)) {
                  const sprite = this.add.image(0, -14, ASSET_KEYS.itemBomb)
                    .setOrigin(0.5, 0.5)
                    .setDisplaySize(28, 28);
                  visualParts.push(sprite);
                } else {
                  const body = this.add
                    .circle(0, -14, 13, fillColor, 1)
                    .setStrokeStyle(2, 0x000000, 0.7);
                  const fuse = this.add
                    .rectangle(0, -28, 3, 6, 0x222222, 1);
                  visualParts.push(body, fuse);
                }
              } else {
                const generic = this.add
                  .rectangle(0, -14, 22, 28, fillColor, 1)
                  .setStrokeStyle(2, 0x000000, 0.6);
                visualParts.push(generic);
              }
              const label = this.add.text(0, -14, labelChar, {
                fontFamily: 'monospace',
                fontSize: '12px',
                color: '#000000',
                fontStyle: 'bold',
              }).setOrigin(0.5, 0.5);
              visualParts.push(label);
              const container = this.add.container(vx, vy, visualParts);
              container.setDepth(2);
              this.itemVisuals.set(entity.id, container);
              // The stage authoring places `anchor.y` 60 design pixels
              // ABOVE the platform top (see
              // `FLAT_STAGE_DEFAULTS.itemAnchorHoverOffset` in
              // stageDefinitions.ts) — that's the SPAWN hover point,
              // not the rest position. Compensating here lands items
              // on the platform top. Container parts are drawn from
              // y=0 upward so container.y == platform top puts the
              // silhouette's BASE on the platform (not its centre,
              // which would sink it halfway through).
              const ITEM_ANCHOR_HOVER_OFFSET_PX = 60;
              this.itemSurfaceY.set(
                entity.id,
                req.anchor.y + ITEM_ANCHOR_HOVER_OFFSET_PX,
              );
              this.itemFallingY.set(entity.id, req.spawnPosition.y);
              entity.attachedRender = container;
            }
            // T3 — falling-simulation + held-tracking + visual sync.
            const FALL_VELOCITY_PER_TICK = 6; // design pixels / tick
            // Bug fix: a falling item without a registered `surfaceY`
            // (e.g. spawn anchor was stale or missing) used to freeze
            // in place mid-air. Compute a fallback surface from the
            // nearest solid platform under the item's x position so
            // every falling item lands on something.
            const nearestSolidPlatformTopBelow = (x: number, y: number): number | null => {
              let best: number | null = null;
              for (const p of this.activeStage.platforms) {
                if (p.passThrough) continue;
                const halfW = p.width / 2;
                if (Math.abs(x - p.x) > halfW) continue;
                const top = p.y - p.height / 2;
                if (top < y) continue; // platform above the item — skip
                if (best === null || top < best) best = top;
              }
              return best;
            };
            for (const entity of this.itemRegistry.getActive()) {
              const container = this.itemVisuals.get(entity.id);
              const state = entity.getSnapshot().state;
              if (state === 'falling') {
                let surfaceY = this.itemSurfaceY.get(entity.id);
                let visualY = this.itemFallingY.get(entity.id);
                // Recover from a missing `itemSurfaceY` entry (e.g. an
                // item spawned via a path that didn't register one):
                // use the nearest platform below as the fall target.
                if (visualY === undefined) {
                  visualY = entity.getPosition().y;
                  this.itemFallingY.set(entity.id, visualY);
                }
                if (surfaceY === undefined) {
                  const fallback = nearestSolidPlatformTopBelow(
                    entity.getPosition().x,
                    visualY,
                  );
                  if (fallback !== null) {
                    surfaceY = fallback;
                    this.itemSurfaceY.set(entity.id, surfaceY);
                  }
                }
                if (surfaceY !== undefined) {
                  const nextY = visualY + FALL_VELOCITY_PER_TICK;
                  if (nextY >= surfaceY) {
                    entity.markGrounded(frame, {
                      x: entity.getPosition().x,
                      y: surfaceY,
                    });
                    this.itemFallingY.delete(entity.id);
                    if (container) container.y = toVy(surfaceY);
                  } else {
                    this.itemFallingY.set(entity.id, nextY);
                    if (container) container.y = toVy(nextY);
                  }
                  if (container) {
                    container.x = toVx(entity.getPosition().x);
                  }
                } else if (container) {
                  // No platform under the item at all — fall freely
                  // until it crosses the bottom blast-zone threshold,
                  // then despawn it so it doesn't leak into the
                  // active-item count and starve future spawns.
                  // Bug fix: previously this branch fell forever and
                  // items stopped spawning once the cap was hit.
                  const nextY = visualY + FALL_VELOCITY_PER_TICK;
                  const FALL_OFF_STAGE_Y = 1800;
                  if (nextY > FALL_OFF_STAGE_Y) {
                    entity.markDespawned(frame);
                    container.destroy();
                    this.itemVisuals.delete(entity.id);
                    this.itemSurfaceY.delete(entity.id);
                    this.itemFallingY.delete(entity.id);
                  } else {
                    this.itemFallingY.set(entity.id, nextY);
                    container.x = toVx(entity.getPosition().x);
                    container.y = toVy(nextY);
                  }
                }
              } else if (container) {
                const pos = entity.getPosition();
                container.x = toVx(pos.x);
                container.y = toVy(pos.y);
                // Held items mirror with the holder's facing so the
                // weapon visually swaps hands on turnaround — the
                // counterpart of the hitbox `offsetX * facing` mirror
                // in attacks.ts. Grounded / thrown items stay unflipped.
                const snap = entity.getSnapshot();
                if (snap.state === 'held' && snap.holderPlayerIndex !== null) {
                  const holder = this.playerSlots.find(
                    (s) => s.playerIndex === snap.holderPlayerIndex,
                  );
                  if (holder) {
                    const sign = holder.character.getFacing() < 0 ? -1 : 1;
                    container.setScale(sign, 1);
                    // Counter-flip text children so the letter label
                    // stays readable when the weapon mirrors (parent
                    // −1 × child −1 = +1).
                    for (const child of container.list) {
                      if (child instanceof Phaser.GameObjects.Text) {
                        child.setScale(sign, 1);
                      }
                    }
                  }
                } else {
                  container.setScale(1, 1);
                  for (const child of container.list) {
                    if (child instanceof Phaser.GameObjects.Text) {
                      child.setScale(1, 1);
                    }
                  }
                }
                if (entity.isBroken()) container.setAlpha(0.4);
              }
            }
            // Per-tick despawn / TTL housekeeping.
            const despawnedIds = this.itemRegistry.tick(frame);
            for (const id of despawnedIds) {
              const container = this.itemVisuals.get(id);
              if (container) container.destroy();
              this.itemVisuals.delete(id);
              this.itemSurfaceY.delete(id);
              this.itemFallingY.delete(id);
            }
            // Auto-detach broken / despawned items from inventories.
            // The slot-override callback marks an item `broken` when
            // durability hits 0 but doesn't clear the holder's
            // inventory — without this sweep, the player keeps
            // "holding" a defunct item and every subsequent pickup
            // attempt is rejected by the single-slot invariant.
            for (const inv of this.inventoriesByPlayerIndex.values()) {
              const held = inv.getHeldItem();
              if (held && (held.isBroken() || held.isDespawned())) {
                inv.detachWithoutDrop();
              }
            }
          }

          // ---- Projectile system -------------------------------------
          // Spawn: any slot whose active attack is a `projectile` kind
          // and just entered the active phase (framesElapsed ===
          // startupFrames) emits exactly one projectile this frame.
          // The `projectileSpawnLatch` prevents repeats across the
          // multi-frame active window.
          for (const slot of this.playerSlots) {
            const active = slot.character.getActiveAttack();
            if (!active) continue;
            const move = active.move as unknown as {
              specialKind?: string;
              projectile?: {
                speed: number;
                lifetimeFrames: number;
                width: number;
                height: number;
                spawnOffsetX: number;
                spawnOffsetY: number;
              };
              chargedProjectile?: {
                charge: ChargeSpec;
                maxSpeed: number;
                maxWidth: number;
                maxHeight: number;
              };
              startupFrames: number;
              id: string;
            };
            if (move.specialKind !== 'projectile' || !move.projectile) continue;
            const latchKey = `${slot.playerIndex}:${move.id}:${active.framesElapsed}`;
            const inActive = active.framesElapsed === move.startupFrames;
            const slotMoveKey = `${slot.playerIndex}:${move.id}`;
            if (inActive && !this.projectileSpawnLatch.has(slotMoveKey)) {
              this.projectileSpawnLatch.add(slotMoveKey);
              const facing = active.facing;
              const pos = slot.character.getPosition();
              const proj = move.projectile;
              // Samus charge-beam scaling: the released shot's damage,
              // knockback, travel speed, and size all lerp from the
              // un-charged baseline (the move's authored damage/knockback
              // and the parent projectile speed/width/height — the t=0
              // endpoint) up to the full-charge endpoint, by how long the
              // button was held. Pure integer-frame lerp → replay-safe.
              const cp = move.chargedProjectile;
              const heldFrames = active.chargeHeldFrames ?? 0;
              const chargeT = cp ? computeChargeTFromSpec(cp.charge, heldFrames) : 0;
              const pSpeed = cp ? proj.speed + (cp.maxSpeed - proj.speed) * chargeT : proj.speed;
              const pWidth = cp ? proj.width + (cp.maxWidth - proj.width) * chargeT : proj.width;
              const pHeight = cp ? proj.height + (cp.maxHeight - proj.height) * chargeT : proj.height;
              const pDamage = cp ? computeChargedDamageFromSpec(cp.charge, heldFrames) : active.move.damage;
              const pKnockback = cp ? computeChargedKnockbackFromSpec(cp.charge, heldFrames) : active.move.knockback;
              const px = pos.x + facing * proj.spawnOffsetX;
              const py = pos.y + proj.spawnOffsetY;
              const id = this.nextProjectileId;
              this.nextProjectileId += 1;
              // Procedural sprite — pointed shape per character.
              // Cat shuriken: yellow diamond. Owl feather: amber teardrop.
              // Nova: a plasma orb that grows + brightens with charge.
              const isOwl = move.id.startsWith('owl');
              const isNova = move.id.startsWith('nova');
              const shapeColor = isOwl ? 0xfff0a8 : 0xffd840;
              const accentColor = isOwl ? 0x8b4513 : 0xff8800;
              const parts: Phaser.GameObjects.GameObject[] = [];
              if (isNova) {
                // Charge beam — concentric plasma orb. Cyan when weak,
                // white-hot at full charge; an outer glow halo doubles the
                // visible radius so a full shot reads as a real threat.
                const hot = chargeT >= 0.85;
                const coreColor = hot ? 0xffffff : 0x66e0ff;
                const glowColor = hot ? 0x99f0ff : 0x2aa0ff;
                const glow = this.add.circle(0, 0, pWidth * 0.75, glowColor, 0.3);
                const core = this.add
                  .circle(0, 0, pWidth * 0.5, coreColor, 1)
                  .setStrokeStyle(2, 0xffffff, 0.9);
                parts.push(glow, core);
              } else if (isOwl) {
                // Feather-bolt — elongated body with a darker tip.
                const body = this.add
                  .rectangle(0, 0, pWidth, pHeight, shapeColor, 1)
                  .setStrokeStyle(2, 0x000000, 0.6);
                const tip = this.add
                  .rectangle(facing * (pWidth / 2 - 4), 0, 8, pHeight * 0.6, accentColor, 1);
                parts.push(body, tip);
              } else {
                // Shuriken — yellow center + cross arms.
                const armH = this.add
                  .rectangle(0, 0, pWidth, pHeight * 0.4, shapeColor, 1)
                  .setStrokeStyle(2, 0x000000, 0.6);
                const armV = this.add
                  .rectangle(0, 0, pWidth * 0.4, pHeight, shapeColor, 1)
                  .setStrokeStyle(2, 0x000000, 0.6);
                parts.push(armH, armV);
              }
              const stageOffsetX = this.baseStage.transform.offsetX;
              const stageOffsetY = this.baseStage.transform.offsetY;
              const stageScale = this.stage.scale;
              const cont = this.add
                .container(
                  stageOffsetX + px * stageScale,
                  stageOffsetY + py * stageScale,
                  parts,
                )
                .setDepth(3);
              this.projectiles.push({
                id,
                ownerSlotIndex: slot.playerIndex,
                moveId: move.id,
                facing,
                damage: pDamage,
                knockback: pKnockback,
                x: px,
                y: py,
                vx: facing * pSpeed,
                vy: 0,
                width: pWidth,
                height: pHeight,
                framesRemaining: proj.lifetimeFrames,
                container: cont,
                spawnedThisFrameByMove: move.id,
              });
              // Charge-beam MUZZLE flash at the cannon mouth — a quick
              // bright pop the frame the shot leaves, sized/coloured by how
              // charged it was (render-only). Design-space origin, so it
              // takes the stage transform like the projectile.
              if (isNova) {
                const muzzleHot = chargeT >= 0.85;
                this.spawnBurst(
                  stageOffsetX + px * stageScale,
                  stageOffsetY + py * stageScale,
                  muzzleHot ? 0xffffff : 0x88e8ff,
                  pWidth * 0.6 + 6,
                  8,
                  1.5,
                  4,
                );
              }
            }
            // Drop the latch when the move ends so the NEXT press of
            // the same special spawns a fresh projectile.
            const totalBusy = move.startupFrames + (active.move.activeFrames ?? 0) + (active.move.recoveryFrames ?? 0);
            if (active.framesElapsed >= totalBusy - 1) {
              this.projectileSpawnLatch.delete(slotMoveKey);
            }
            void latchKey;
          }

          // ---- Swing-flash visual for held-item moves ----------------
          // The bat / bomb moves spawn a real Matter hitbox via the
          // canonical attemptAttack path, but there's no sprite anim
          // shipping with the swing — the player would otherwise see
          // damage land with no visible cause. Flash a translucent
          // rectangle at the hitbox location for ~6 frames whenever a
          // known held-item swing JUST entered its active phase.
          for (const slot of this.playerSlots) {
            const active = slot.character.getActiveAttack();
            if (!active) continue;
            const isHeldItemSwing =
              active.move.id === 'item.bat.swing' ||
              active.move.id === 'item.bomb.detonate';
            if (!isHeldItemSwing) continue;
            const justActive = active.framesElapsed === active.move.startupFrames;
            if (!justActive) continue;
            const stageOffsetX = this.baseStage.transform.offsetX;
            const stageOffsetY = this.baseStage.transform.offsetY;
            const stageScale = this.stage.scale;
            const pos = slot.character.getPosition();
            const fx = stageOffsetX + (pos.x + active.facing * active.move.hitbox.offsetX) * stageScale;
            const fy = stageOffsetY + (pos.y + active.move.hitbox.offsetY) * stageScale;
            const fw = active.move.hitbox.width * stageScale;
            const fh = active.move.hitbox.height * stageScale;
            const color =
              active.move.id === 'item.bat.swing' ? 0xfff080 : 0xff7040;
            const flash = this.add
              .rectangle(fx, fy, fw, fh, color, 0.55)
              .setStrokeStyle(2, 0x000000, 0.7)
              .setDepth(4);
            this.swingFlashes.push({ container: flash as unknown as Phaser.GameObjects.Rectangle, framesRemaining: 6 });

            // Explosion sprite — for bomb detonations only, layer the
            // 3-frame Kenney Particle Pack explosion strip on top of
            // the swing-flash for a "real" explosion read instead of
            // just an orange rectangle. Tween scale + alpha so the
            // burst grows + fades over its 18-frame run.
            if (
              active.move.id === 'item.bomb.detonate' &&
              this.textures.exists(ASSET_KEYS.itemExplosion)
            ) {
              const burst = this.add
                .sprite(fx, fy, ASSET_KEYS.itemExplosion, 0)
                .setOrigin(0.5, 0.5)
                .setDepth(5)
                .setDisplaySize(fw * 1.4, fh * 1.4)
                .setBlendMode(Phaser.BlendModes.ADD);
              this.explosionBursts.push({ sprite: burst, framesRemaining: 18 });
            }

            // Bomb explosion → push nearby grounded / falling items
            // outward so the explosion visibly affects the world's
            // physics, not just the characters. Re-uses the
            // `thrownItems` system as the carrier for dynamic
            // velocity — an item kicked by a blast is structurally a
            // "thrown" item with a brief air-time and platform
            // collision against the existing thrown-items handler.
            if (active.move.id === 'item.bomb.detonate') {
              const blastRadius =
                Math.max(active.move.hitbox.width, active.move.hitbox.height) / 2 + 20;
              const blastCx = pos.x + active.facing * active.move.hitbox.offsetX;
              const blastCy = pos.y + active.move.hitbox.offsetY;
              for (const itemEntity of this.itemRegistry.getActive()) {
                if (itemEntity.isHeld()) continue;
                if (itemEntity.isBroken() || itemEntity.isDespawned()) continue;
                // Skip items already in flight (they're in
                // `thrownItems` and will get the impulse via the
                // throw-tick rather than this code path).
                const alreadyInFlight = this.thrownItems.some(
                  (t) => t.entity.id === itemEntity.id,
                );
                if (alreadyInFlight) continue;
                const ipos = itemEntity.getPosition();
                const dx = ipos.x - blastCx;
                const dy = ipos.y - blastCy;
                const dist = Math.hypot(dx, dy);
                if (dist > blastRadius) continue;
                // Outward unit vector — fall back to a tiny random
                // direction sampled deterministically off the entity
                // id so a perfectly-centred item still moves.
                const safe = dist === 0 ? 1 : dist;
                const idSign = (itemEntity.id & 1) === 0 ? 1 : -1;
                const ux = dist === 0 ? idSign : dx / safe;
                const uy = dist === 0 ? -1 : dy / safe;
                // Falloff — closer items get a stronger kick.
                const falloff = 1 - dist / blastRadius;
                const KICK_BASE_SPEED = 18;
                const kickSpeed = KICK_BASE_SPEED * (0.4 + 0.6 * falloff);
                // Bias the launch upward so items pop into the air.
                const vx = ux * kickSpeed;
                const vy = uy * kickSpeed - 6;
                const container = this.itemVisuals.get(itemEntity.id);
                if (!container) continue;
                // Remove resting-surface tracking — the item is now
                // airborne and will re-settle via the thrown-items
                // platform collision path.
                this.itemSurfaceY.delete(itemEntity.id);
                this.itemFallingY.delete(itemEntity.id);
                this.thrownItems.push({
                  entity: itemEntity,
                  ownerSlotIndex: slot.playerIndex,
                  x: ipos.x,
                  y: ipos.y,
                  vx,
                  vy,
                  framesRemaining: 90,
                  // Items kicked by an explosion don't auto-detonate
                  // on their next contact — they survive the blast
                  // and can be re-picked-up where they land.
                  consumeOnImpact: false,
                  container,
                });
              }
            }
          }
          // Tick swing flashes — fade + destroy after a few frames.
          if (this.swingFlashes.length > 0) {
            const flashSurvivors: typeof this.swingFlashes = [];
            for (const f of this.swingFlashes) {
              f.framesRemaining -= 1;
              const t = Math.max(0, f.framesRemaining / 6);
              f.container.setAlpha(0.55 * t);
              if (f.framesRemaining <= 0) {
                f.container.destroy();
              } else {
                flashSurvivors.push(f);
              }
            }
            this.swingFlashes = flashSurvivors;
          }
          // Tick explosion bursts — 18-frame total run, 6 frames per
          // sprite-frame (flash 0..5, fireball 6..11, smoke 12..17).
          // Scale grows from 1.0 → 1.6, alpha fades from 1.0 → 0 in
          // the smoke phase.
          if (this.explosionBursts.length > 0) {
            const burstSurvivors: typeof this.explosionBursts = [];
            for (const b of this.explosionBursts) {
              const elapsed = 18 - b.framesRemaining;
              const frameIdx = Math.min(2, Math.floor(elapsed / 6));
              b.sprite.setFrame(frameIdx);
              const phaseT = (elapsed % 6) / 6;
              b.sprite.setScale(b.sprite.scaleX * (1 + 0.04 * phaseT));
              if (frameIdx === 2) {
                // Fade smoke phase out gradually.
                const smokeT = phaseT;
                b.sprite.setAlpha(Math.max(0, 1 - smokeT));
              }
              b.framesRemaining -= 1;
              if (b.framesRemaining <= 0) {
                b.sprite.destroy();
              } else {
                burstSurvivors.push(b);
              }
            }
            this.explosionBursts = burstSurvivors;
          }

          // ---- Throw input wiring ------------------------------------
          // Rising-edge `grab` press while holding an item launches it
          // along the item's `throwBehavior` vector keyed by the
          // current movement input (forward/back/up/down/drop).
          // The rebinding store has no dedicated `'throw'` action so
          // we hijack `grab` only when the holder has an item.
          for (const slot of this.playerSlots) {
            const inv = this.inventoriesByPlayerIndex.get(slot.playerIndex);
            if (!inv) continue;
            const held = inv.getHeldItem();
            if (!held) {
              this.prevGrabHeld.set(slot.playerIndex, false);
              continue;
            }
            const slotIdx = this.playerSlots.indexOf(slot);
            const fi = frameInputs[slotIdx];
            const grabHeld = fi?.grab ?? false;
            const wasGrabHeld = this.prevGrabHeld.get(slot.playerIndex) ?? false;
            const grabPressed = grabHeld && !wasGrabHeld;
            this.prevGrabHeld.set(slot.playerIndex, grabHeld);
            if (!grabPressed) continue;

            // Direction = analog stick rounded to 4 cardinals + drop.
            // Read the CAPTURED frame input (same record the replay
            // buffer stores) — a live resolver read here would bypass
            // the capture pipeline and desync item throws on playback.
            const facing = slot.character.getFacing();
            const moveX = fi?.moveX ?? 0;
            const moveY = fi?.moveY ?? 0;
            const def = held.definition;
            let throwVec = def.throwBehavior.drop;
            if (Math.abs(moveX) > 0.4) {
              throwVec = (moveX * facing > 0) ? def.throwBehavior.forward : def.throwBehavior.back;
            } else if (moveY < -0.4) {
              throwVec = def.throwBehavior.up;
            } else if (moveY > 0.4) {
              throwVec = def.throwBehavior.down;
            }
            // Pop visual out of held position, attach to thrown
            // runtime. Detach from inventory but don't despawn — the
            // thrown runtime drives lifecycle now.
            const pos = slot.character.getPosition();
            const container = this.itemVisuals.get(held.id);
            const detached = inv.detachWithoutDrop();
            if (!detached || !container) continue;
            // Mirror velocity by facing for forward/back vectors —
            // throwBehavior is authored facing-right; flip x for left.
            const vx = throwVec.velocityX * facing;
            const vy = throwVec.velocityY;
            const throwStartX = pos.x;
            const throwStartY = pos.y - 30; // chest height
            // Bug fix: transition the entity out of 'held' so the
            // per-tick falling-sim's "set container to
            // entity.getPosition()" override doesn't keep snapping
            // the visual back to the pickup-time chest position.
            // markDropped takes us 'held' → 'grounded' — the
            // thrown-items tick will subsequently call
            // updateFreePosition each frame so the snapshot tracks
            // the in-flight position.
            held.markDropped(frame, { x: throwStartX, y: throwStartY });
            this.thrownItems.push({
              entity: held,
              ownerSlotIndex: slot.playerIndex,
              x: throwStartX,
              y: throwStartY,
              vx,
              vy,
              framesRemaining: 90, // ~1.5s air time cap
              consumeOnImpact: def.throwBehavior.consumeOnImpact,
              container,
            });
          }
          // Tick thrown items — gravity + AABB hit-check + platform collision.
          if (this.thrownItems.length > 0) {
            const stageOffsetX = this.baseStage.transform.offsetX;
            const stageOffsetY = this.baseStage.transform.offsetY;
            const stageScale = this.stage.scale;
            const GRAVITY_PER_TICK = 0.45; // design px/tick² — gentle arc
            // Approximate item half-extent for platform collision.
            // Thrown items are visualised inside ~28×40 containers so a
            // 14 px half-height reads as "the item rests on the surface
            // not floating above it."
            const ITEM_HALF_HEIGHT = 14;
            const platforms = this.activeStage.platforms;
            const survivors: typeof this.thrownItems = [];
            for (const t of this.thrownItems) {
              const prevX = t.x;
              const prevY = t.y;
              t.x += t.vx;
              t.y += t.vy;
              t.vy += GRAVITY_PER_TICK;
              t.framesRemaining -= 1;
              t.container.x = stageOffsetX + t.x * stageScale;
              t.container.y = stageOffsetY + t.y * stageScale;
              // Sync the entity snapshot position to the in-flight
              // position so the per-tick falling-sim's container-
              // sync block (which reads entity.getPosition()) doesn't
              // contradict the throw arc. Belt-and-braces against
              // the held-position-snap-back bug.
              t.entity.updateFreePosition({ x: t.x, y: t.y });
              // Platform collision — only check on a downward step
              // and only against solid (non-passThrough) platforms,
              // mirroring how the character physics layer treats
              // pass-through platforms (you fall onto them only if
              // not already inside; thrown items skip pass-through to
              // avoid teleporting through them mid-arc).
              let landedPlatformY: number | null = null;
              if (t.vy > 0) {
                for (const p of platforms) {
                  if (p.passThrough) continue;
                  const halfW = p.width / 2;
                  const halfH = p.height / 2;
                  const inX = Math.abs(t.x - p.x) <= halfW;
                  if (!inX) continue;
                  const top = p.y - halfH;
                  // Cross from above to below the platform top this step.
                  const wasAbove = prevY + ITEM_HALF_HEIGHT <= top + 0.5;
                  const nowOverlap = t.y + ITEM_HALF_HEIGHT >= top;
                  if (wasAbove && nowOverlap) {
                    landedPlatformY = top;
                    break;
                  }
                }
              }
              if (landedPlatformY !== null) {
                // Snap onto the platform top so the visual rests on
                // the surface; suppress further travel + impact loop.
                t.y = landedPlatformY - ITEM_HALF_HEIGHT;
                t.container.x = stageOffsetX + t.x * stageScale;
                t.container.y = stageOffsetY + t.y * stageScale;
              }
              // Was prevX touched? Keep a reference so the linter is happy
              // (Matter doesn't need it but the platform sweep above
              // intentionally compares against `prevY`, not `prevX`).
              void prevX;
              let impact = false;
              // Skip impact checks for the first 3 frames after
              // throw — without this, a bomb thrown next to an
              // opponent often AABB-overlaps them on the throw
              // frame and detonates instantly with no visible flight
              // arc. 3 frames at 60 Hz ≈ 50 ms grace.
              const THROW_IMPACT_GRACE_FRAMES = 3;
              const framesSinceThrow = 90 - t.framesRemaining;
              const canImpact = framesSinceThrow >= THROW_IMPACT_GRACE_FRAMES;
              for (const s of this.playerSlots) {
                if (!canImpact) break;
                if (s.playerIndex === t.ownerSlotIndex) continue;
                if (this.stockTracker.isEliminated(s.playerIndex)) continue;
                const tuning = s.character.getTuning();
                const tpos = s.character.getPosition();
                const halfW = (tuning.width + 28) / 2;
                const halfH = (tuning.height + 28) / 2;
                if (Math.abs(t.x - tpos.x) <= halfW && Math.abs(t.y - tpos.y) <= halfH) {
                  // Use the item's first authored attack move's
                  // damage / knockback if present, else a sensible
                  // default for raw thrown items.
                  const move = t.entity.definition.attackMoves?.[0];
                  s.character.applyHit({
                    damage: move?.damage ?? 8,
                    knockback: move?.knockback ?? { x: 2.5, y: -1.0, scaling: 0.18 },
                    facing: t.vx >= 0 ? 1 : -1,
                  });
                  impact = true;
                  break;
                }
              }
              const offStage = t.x < -200 || t.x > 4400 || t.y > 1800;
              const settledOnPlatform = landedPlatformY !== null;
              if (impact || offStage || t.framesRemaining <= 0 || settledOnPlatform) {
                if (t.consumeOnImpact || impact) {
                  // Bomb-style: destroy the entity + visual.
                  // For bombs specifically, also spawn an explosion
                  // sprite at the impact position so the player
                  // sees the same flash → fireball → smoke burst
                  // they'd see from in-hand detonation. Without
                  // this, throwing a bomb instantly removed the
                  // visual with no replacement effect (the sprite
                  // for "bomb went off" was missing).
                  if (
                    t.entity.definition.type === 'bomb' &&
                    this.textures.exists(ASSET_KEYS.itemExplosion)
                  ) {
                    const fx = stageOffsetX + t.x * stageScale;
                    const fy = stageOffsetY + t.y * stageScale;
                    const burst = this.add
                      .sprite(fx, fy, ASSET_KEYS.itemExplosion, 0)
                      .setOrigin(0.5, 0.5)
                      .setDepth(5)
                      .setDisplaySize(120, 120)
                      .setBlendMode(Phaser.BlendModes.ADD);
                    this.explosionBursts.push({ sprite: burst, framesRemaining: 18 });
                  }
                  t.container.destroy();
                  this.itemVisuals.delete(t.entity.id);
                  this.itemSurfaceY.delete(t.entity.id);
                  this.itemFallingY.delete(t.entity.id);
                  t.entity.markBroken(frame, { x: t.x, y: t.y });
                } else {
                  // Bat / RayGun: settle as grounded so it can be
                  // re-picked-up. Snap visual to landing position +
                  // record the surface Y so subsequent pickup logic
                  // sees a clean rest position.
                  t.entity.markGrounded(frame, { x: t.x, y: t.y });
                  t.container.x = stageOffsetX + t.x * stageScale;
                  t.container.y = stageOffsetY + t.y * stageScale;
                  this.itemSurfaceY.set(t.entity.id, t.y);
                  this.itemFallingY.delete(t.entity.id);
                }
              } else {
                survivors.push(t);
              }
            }
            this.thrownItems = survivors;
          }
          // Tick projectiles — advance position, sync visual, AABB
          // hit-check vs every other slot's body, despawn on hit or
          // lifetime expiry.
          if (this.projectiles.length > 0) {
            const stageOffsetX = this.baseStage.transform.offsetX;
            const stageOffsetY = this.baseStage.transform.offsetY;
            const stageScale = this.stage.scale;
            const survivors: typeof this.projectiles = [];
            for (const p of this.projectiles) {
              p.x += p.vx;
              p.y += p.vy;
              p.framesRemaining -= 1;
              p.container.x = stageOffsetX + p.x * stageScale;
              p.container.y = stageOffsetY + p.y * stageScale;

              // ---- Reflector field (Owl side-B) -------------------------
              // A projectile crossing an ACTIVE reflector it does NOT
              // already own is bounced back: flipped, scaled up by
              // `velocityScale`, damage amplified by `reflectMultiplier`,
              // and RE-OWNED by the reflecting fighter. Re-owning is what
              // stops the same reflector re-reflecting it next frame (the
              // `playerIndex === p.ownerSlotIndex` guard now skips it), and
              // lets the bounced shot hit the original attacker.
              let reflected = false;
              for (const s of this.playerSlots) {
                if (s.playerIndex === p.ownerSlotIndex) continue;
                if (this.stockTracker.isEliminated(s.playerIndex)) continue;
                const ra = s.character.getActiveAttack();
                if (!ra || ra.phase !== 'active') continue;
                const rmove = ra.move as unknown as {
                  sideSpecialKind?: string;
                  reflector?: {
                    reflectMultiplier: number;
                    velocityScale: number;
                    reflectorBody: { offsetX: number; offsetY: number; width: number; height: number };
                  };
                };
                if (rmove.sideSpecialKind !== 'reflector' || !rmove.reflector) continue;
                const rpos = s.character.getPosition();
                const rb = rmove.reflector.reflectorBody;
                const rx = rpos.x + ra.facing * rb.offsetX;
                const ry = rpos.y + rb.offsetY;
                if (
                  Math.abs(p.x - rx) <= (rb.width + p.width) / 2 &&
                  Math.abs(p.y - ry) <= (rb.height + p.height) / 2
                ) {
                  p.vx = -p.vx * rmove.reflector.velocityScale;
                  p.vy = p.vy * rmove.reflector.velocityScale;
                  p.facing = (p.facing === 1 ? -1 : 1) as 1 | -1;
                  p.damage *= rmove.reflector.reflectMultiplier;
                  p.ownerSlotIndex = s.playerIndex;
                  reflected = true;
                  break;
                }
              }

              let hit = false;
              if (!reflected) {
                for (const s of this.playerSlots) {
                  if (s.playerIndex === p.ownerSlotIndex) continue;
                  if (this.stockTracker.isEliminated(s.playerIndex)) continue;
                  const tuning = s.character.getTuning();
                  const tpos = s.character.getPosition();
                  const halfW = (tuning.width + p.width) / 2;
                  const halfH = (tuning.height + p.height) / 2;
                  if (Math.abs(p.x - tpos.x) <= halfW && Math.abs(p.y - tpos.y) <= halfH) {
                    s.character.applyHit({
                      damage: p.damage,
                      knockback: p.knockback,
                      facing: p.facing,
                    });
                    hit = true;
                    break;
                  }
                }
              }
              if (hit || p.framesRemaining <= 0 || p.x < -200 || p.x > 4200) {
                p.container.destroy();
              } else {
                survivors.push(p);
              }
            }
            this.projectiles = survivors;
          }

          // ---- Sub-AC 2 of AC 60202: position-based KO scan -------------
          // Run AFTER the Matter step so the body positions reflect this
          // step's integration. The watcher reads each registered
          // fighter's centre-of-mass, compares it against the configured
          // blast-zone rect, and fires `loseStock` for every fighter that
          // newly crossed an edge. Tunnelling-safe (a body moving past
          // the boundary at >sensor-thickness/step still registers) and
          // deterministic (pure position math, frame-stamped).
          this.blastZonePositionWatcher.update(frame);

          // ---- Sub-AC 3 of AC 303: drive respawns + finalise eliminations
          // Drained AFTER stepping the world so any blast-zone touch from
          // this step is included in `loseStock` calls and queued
          // respawns whose fire-frame just elapsed get re-spawned this
          // very same step (zero perceptual delay at respawnDelay=0).
          //
          // The whole respawn pipeline — teleport (state reset), damage
          // → 0, invincibility window, face inward, spawn-platform
          // overlay creation, and the position-watcher latch reset
          // (registered as a side-effect hook in `create()`) — lives in
          // the dedicated `RespawnHandler` so the logic is testable
          // under plain Node and replayable byte-for-byte.
          const ready = this.stockTracker.consumePendingRespawns(frame);
          this.respawnHandler.applyRespawns(ready, frame);
          // Tick the spawn-platform expiry. Returned list of expired
          // platforms drives the visual cleanup loop in the render hook.
          this.respawnHandler.update(frame);

          // Eliminated slots: unregister from the watcher so a corpse
          // body lingering at the blast-zone edge can't fire phantom
          // stock losses, AND from the damage handler so a stray hitbox
          // overlap on the corpse can't fire a phantom hit. Idempotent
          // — `unregisterPlayer` is a no-op for an already-removed slot.
          for (const slot of this.playerSlots) {
            if (this.stockTracker.isEliminated(slot.playerIndex)) {
              if (this.blastZoneWatcher.isRegistered(slot.playerIndex)) {
                this.blastZoneWatcher.unregisterPlayer(slot.playerIndex);
              }
              // Sub-AC 2 of AC 60202: also drop the corpse from the
              // position-based watcher so its post-elimination drift
              // past a boundary doesn't fire a phantom stock-loss.
              if (this.blastZonePositionWatcher.isRegistered(slot.playerIndex)) {
                this.blastZonePositionWatcher.unregisterPlayer(slot.playerIndex);
              }
              if (this.hitboxDamageHandler.isRegistered(slot.playerIndex)) {
                this.hitboxDamageHandler.unregisterPlayer(slot.playerIndex);
              }
              // AC 20101 Sub-AC 1 — drop the corpse from every
              // stage-owned hazard adapter (lava overlap registry,
              // wind force controller, and any future hazard family
              // a custom-stage trap watcher adds). The stage's
              // `unregisterPlayer` is idempotent and a no-op for
              // hazard-free layouts, so the flat-stage path stays
              // free.
              this.baseStage.unregisterPlayer(slot.playerIndex);
            }
          }
        }

        // ---- Sub-AC 4.3: tick the match-end state machine ---------------
        // Always called — even during the freeze — because it is the
        // module driving the freeze countdown. After the configured
        // ending duration it flips to READY and we hand off to the
        // results scene exactly once.
        this.matchEndDetector.update(frame);

        // ---- AC 30004 Sub-AC 4: stop recording on first match-over -----
        // Latch on the first tick the detector reports match-over so the
        // replay's last captured frame is the deciding KO. The
        // controller's `stop()` is idempotent — the latch here is just
        // so the scene knows "we already crossed the boundary" for any
        // one-shot effects (a future "match saved automatically" toast,
        // for instance). We do NOT auto-save: the player presses S
        // (or a future M2 menu button) to keep the file.
        if (
          !this.recordingStopped &&
          this.matchEndDetector.isMatchOver()
        ) {
          this.recordingController.stop();
          this.recordingStopped = true;
        }

        if (this.matchEndDetector.consumeShouldTransition()) {
          const payload = this.matchEndDetector.getResultPayload();
          // Restore Matter's auto-update so the next scene boots in a
          // sane state. Mirrors the SHUTDOWN-hook reset; doing it here
          // means a paranoid double-fire of `start` doesn't leave the
          // world stuck on manual-step.
          this.matter.world.autoUpdate = true;
          // Stash a finalised replay in the global registry so
          // ResultsScene's `S` hotkey can offer the download. We stop
          // recording here (idempotent) and build the artifact eagerly
          // — building once and reusing means a held-S spam on the
          // results screen doesn't re-serialise the buffer.
          try {
            if (this.recordingController.isRecording()) {
              this.recordingController.stop();
              this.recordingStopped = true;
            }
            const replayFile = this.recordingController.buildReplayFile();
            const fileName = this.recordingController.suggestFileName();
            this.registry.set('lastReplay', { replayFile, fileName });
          } catch {
            // Save is best-effort; if buffer is empty (e.g. headless test
            // path) we still want the scene to advance to results.
            this.registry.set('lastReplay', null);
          }
          this.scene.start('ResultsScene', payload ?? undefined);
        }
      },
      (alpha) => {
        // ---- Camera (Sub-AC 2.3) --------------------------------------
        // Follow only fighters that are still alive — eliminated slots
        // are left wherever they fell so the camera doesn't keep
        // framing a corpse.
        const targets: CameraTarget[] = this.playerSlots
          .filter((slot) => !this.stockTracker.isEliminated(slot.playerIndex))
          .map((slot) => {
            const pos = slot.character.getPosition();
            return { x: pos.x, y: pos.y, active: true };
          });
        // Camera needs at least one target — fall back to the centre
        // of the stage if everyone's eliminated (match-over freeze).
        if (targets.length === 0) {
          targets.push({
            x: this.scale.gameSize.width / 2,
            y: this.scale.gameSize.height / 2,
            active: true,
          });
        }
        this.cameraController.setTargets(targets);
        this.cameraController.update(deltaMs);
        // Parallax layers track the freshly-updated camera scroll so
        // the background drifts slower than the action (depth cue).
        {
          const cam = this.cameras.main;
          this.stageBackground?.updateParallax(cam.scrollX, cam.scrollY);
        }

        // ---- Visual proxies pinned to each body -----------------------
        // Iterate every player slot (M2 4-player FFA) — each slot
        // owns its own visual rect + facing mark, so the same loop
        // pins all of them. p1/p2 still exist as the first 2 entries
        // for backwards-compat with code that hasn't been migrated.
        for (const slot of this.playerSlots) {
          const pos = slot.character.getPosition();
          const facing = slot.character.getFacing();
          const tuning = slot.character.getTuning();
          slot.visual.setPosition(pos.x, pos.y);
          slot.facingMark.setPosition(
            pos.x + facing * (tuning.width / 2 + 6),
            pos.y - tuning.height / 2 + 14,
          );
          slot.facingMark.setScale(facing, 1);
        }

        // ---- AC 10401 Sub-AC 1: pin real sprite frames to each body -----
        // Re-position and face-flip every render frame so the visible
        // sprite tracks the underlying Matter body 1:1. `setFlipX` is
        // the engine-canonical way to mirror a sprite without negating
        // the scale (negative scale would also invert the texture's
        // sub-rect during animation atlas dispatch).
        //
        // Sub-AC 2 of AC 10402 — also tick the per-slot sprite
        // animation state machine. The SM polls the live Character for
        // (grounded, velocity, isAttacking, hitstun) and dispatches a
        // `sprite.play()` against the matching animation key when the
        // resolved state changes. Same-state ticks are a cheap no-op.
        for (const slot of this.playerSlots) {
          const sprite = slot.sprite;
          if (!sprite) continue;
          const pos = slot.character.getPosition();
          const tuning = slot.character.getTuning();
          // Flip relative to the source art's BASE facing — the new
          // packs (Blaze/Puff/Aegis) are drawn facing left, so a bare
          // `facing < 0` test ran them backwards. `shouldFlipSprite`
          // folds in each fighter's authored direction.
          const flipped = shouldFlipSprite(
            slot.character.id,
            slot.character.getFacing(),
          );
          sprite.setFlipX(flipped);
          slot.spriteAnimSm?.tick();
          // Per-move / crouch override: every attack plays its OWN clip
          // (`<char>.<move>.anim`) and a held crouch plays a real duck clip
          // instead of the procedural squash — for fighters that ship those
          // sheets. Change-guarded against the sprite's live anim so a clip is
          // never restarted mid-play. Fighters without per-move sheets fall
          // through to the SM's collapsed `attack` / the squash below.
          const charId = slot.character.id;
          const activeAtk = slot.character.getActiveAttack();
          const grabState = slot.character.getGrabState();
          const snap = slot.character.getAnimationSnapshot();
          const overrideSheet = snap.hitstunRemaining > 0
            ? 'hurt'
            : slot.character.isGrabbed()
              ? 'hurt'
              : activeAtk
              ? attackMoveToSheet(activeAtk.move)
              : (grabState.name === 'whiffStartup' || grabState.name === 'whiffActive')
                ? 'grab'
                : grabState.name === 'holding'
                  ? 'pummel'
                  : grabState.name === 'throwing'
                    ? (grabState.active?.throwDirection === 'forward' ? 'fthrow'
                      : grabState.active?.throwDirection === 'back'    ? 'bthrow'
                      : grabState.active?.throwDirection === 'up'      ? 'uthrow'
                      : 'dthrow')
                    : slot.character.isShielding()
                      ? 'shield'
                      : slot.character.isCrouching()
                        ? 'crouch'
                        : null;
          const overrideKey = getMoveAnimKey(charId, overrideSheet);
          const curAnimKey =
            (sprite.anims && sprite.anims.currentAnim && sprite.anims.currentAnim.key) || null;
          let crouchAnimActive = false;
          if (overrideKey && this.anims.exists(overrideKey)) {
            if (curAnimKey !== overrideKey) sprite.play(overrideKey, true);
            crouchAnimActive = overrideSheet !== null;
          } else if (
            curAnimKey !== null &&
            MOVE_SHEET_NAMES.some((s) => curAnimKey === `${charId}.${s}.anim`)
          ) {
            // A per-move/crouch clip is still showing but no override applies now
            // (e.g. the duck just ended). The SM only re-dispatches on its OWN
            // state change, so restore its base clip explicitly.
            const baseKey = getSpriteAnimationKey(charId, slot.spriteAnimSm?.current() ?? 'idle');
            if (baseKey && curAnimKey !== baseKey) sprite.play(baseKey, true);
          }
          // Phaser's `play(animKey)` resets displaySize and origin
          // back to the native frame defaults — re-apply each frame
          // from the shared visual-scale table so the visible sprite
          // stays at its configured size + bottom-anchored.
          const size = getCharacterSpriteDisplaySize(slot.character.id);
          applySpriteDisplayHeight(sprite, size);
          sprite.setOrigin(0.5, 1.0);
          // Tier 5 — visually DUCK while crouching: squash the sprite
          // vertically (the bottom-anchored origin keeps the feet planted
          // and drops the head) and widen it a touch, matching the lowered
          // crouch hurtbox so the on-screen body reads as a crouch.
          if (slot.character.isCrouching() && !crouchAnimActive) {
            // Fallback duck for fighters WITHOUT a dedicated crouch clip: squash
            // the sprite vertically (bottom-anchored origin keeps the feet planted).
            const CROUCH_SQUASH_Y = 0.62;
            const CROUCH_WIDEN_X = 1.12;
            sprite.setScale(
              sprite.scaleX * CROUCH_WIDEN_X,
              sprite.scaleY * CROUCH_SQUASH_Y,
            );
          }
          // Anchor at body bottom (origin 0.5, 1.0). `pos` is the body
          // CENTER, so y = pos.y + height/2 puts the sprite's bottom edge on
          // the body's bottom edge. X is re-centred: a few sheets draw the
          // character off-centre in the cell, so shift by `-offset×width`
          // (flipped with facing) to put the VISIBLE body on the body X —
          // otherwise the hurtbox reads off to one side (Blaze/Puff).
          const artOffX = getCharacterSpriteArtOffsetX(slot.character.id);
          const shiftX =
            artOffX === 0 ? 0 : -artOffX * sprite.displayWidth * (flipped ? -1 : 1);
          // Seat the feet on the body bottom: shift DOWN by the sprite's
          // transparent foot padding (fraction × CURRENT display height, so it
          // tracks the crouch squash applied just above). The padding then
          // hangs below into the floor instead of floating the feet.
          const footShiftY =
            getCharacterSpriteArtOffsetY(slot.character.id) * sprite.displayHeight;
          sprite.setPosition(pos.x + shiftX, pos.y + tuning.height / 2 + footShiftY);
        }

        // ---- Sub-AC 3 of AC 303: spawn-platform overlays --------------
        // Reconcile the live Phaser visuals with the handler's active
        // spawn-platform list. Handler-side records are authoritative;
        // the renderer's job is just to mirror them. Visual style: a
        // soft-rounded rectangle with a faint underline glow. The rect's
        // alpha fades as the platform's lifetime ticks down so the
        // player gets a smooth visual cue that their grace window is
        // expiring.
        const renderFrame = this.physicsEngine.getFrame();
        const activePlatforms = this.respawnHandler.getActiveSpawnPlatforms();
        const seenPlatformSlots = new Set<number>();
        for (const platform of activePlatforms) {
          seenPlatformSlots.add(platform.playerIndex);
          const elapsed = renderFrame - platform.spawnedFrame;
          const lifetime = Math.max(1, platform.invincibilityFrames);
          // 1.0 at spawn, 0.0 at expiry. Clamp to [0, 1] so a stale
          // render frame outside the lifetime doesn't produce negative
          // alpha or > 1.0 alpha.
          const lifeAlpha = Math.max(0, Math.min(1, 1 - elapsed / lifetime));
          let visuals = this.spawnPlatformVisuals.get(platform.playerIndex);
          if (!visuals) {
            // Sub-AC 3 of AC 13 — slot accent colour reads from the
            // resolved palette swap so the platform automatically
            // tracks the slot's `paletteIndex`. Falls back to a
            // neutral cream if a (defensively-impossible) platform
            // record arrives for an un-tracked slot index.
            const ownerSlot = this.playerSlots.find(
              (s) => s.playerIndex === platform.playerIndex,
            );
            const tint = ownerSlot?.paletteSwap.accentColor ?? 0xffe0a0;
            const rect = this.add
              .rectangle(platform.x, platform.y, platform.width, platform.height, tint, 0.7)
              .setStrokeStyle(2, tint, 0.9)
              .setDepth(-1); // Behind the fighter sprite.
            const glow = this.add
              .rectangle(
                platform.x,
                platform.y + platform.height / 2 + 4,
                platform.width * 0.85,
                4,
                tint,
                0.45,
              )
              .setDepth(-1);
            visuals = { rect, glow };
            this.spawnPlatformVisuals.set(platform.playerIndex, visuals);
          }
          // Re-position every render frame so a respawn that lands the
          // same step the previous platform was deleted still snaps the
          // visuals to the right place.
          visuals.rect.setPosition(platform.x, platform.y);
          visuals.rect.setSize(platform.width, platform.height);
          visuals.rect.setAlpha(0.15 + 0.55 * lifeAlpha); // floor at 0.15 to stay readable
          visuals.glow.setPosition(platform.x, platform.y + platform.height / 2 + 4);
          visuals.glow.setAlpha(0.05 + 0.4 * lifeAlpha);
        }
        // Tear down visuals whose underlying platform expired this tick.
        for (const [playerIndex, visuals] of this.spawnPlatformVisuals.entries()) {
          if (!seenPlatformSlots.has(playerIndex)) {
            visuals.rect.destroy();
            visuals.glow.destroy();
            this.spawnPlatformVisuals.delete(playerIndex);
          }
        }

        // ---- Sub-AC 4.2 visuals: invincibility flicker + elimination --
        // Strobe the visual rectangle while invincible so the player
        // gets unmissable feedback that they're in their grace window.
        // Uses simulated frame index (deterministic) — not wall clock —
        // so a replay produces the same flicker.
        const frame = renderFrame;
        for (const slot of this.playerSlots) {
          // AC 10401 Sub-AC 1 — when a real sprite is wired, the body
          // rectangle reads as a faint hurtbox-debug overlay (rectAlpha
          // = 0.25) and the sprite owns the visible body alpha. The
          // sprite alpha mirrors the same flicker / elimination logic
          // that previously drove the rectangle, so a fighter's
          // invincibility window or KO state is communicated through
          // the real silhouette.
          const hasSprite = slot.sprite !== null;
          const baseRectAlpha = hasSprite ? 0.25 : 0.85;
          // The sprite already conveys facing via `setFlipX`; the
          // arrow triangle is only useful for the procedural-rect
          // fallback. Once a sprite is present, keep the triangle
          // invisible so it doesn't read as a debug overlay.
          const facingAlpha = hasSprite ? 0 : 0.85;
          if (this.stockTracker.isEliminated(slot.playerIndex)) {
            slot.visual.setAlpha(0.18);
            slot.facingMark.setAlpha(0);
            slot.sprite?.setAlpha(0.18);
          } else if (slot.character.isInvincible()) {
            // 6-frame on/off blink. Even multiples of 6 → on; odd → dim.
            const blinkOn = Math.floor(frame / 6) % 2 === 0;
            slot.visual.setAlpha(blinkOn ? baseRectAlpha : baseRectAlpha * 0.4);
            slot.facingMark.setAlpha(facingAlpha);
            slot.sprite?.setAlpha(blinkOn ? 1 : 0.4);
          } else {
            slot.visual.setAlpha(baseRectAlpha);
            slot.facingMark.setAlpha(facingAlpha);
            slot.sprite?.setAlpha(1);
          }
        }

        // ---- AC 60401 Sub-AC 1: per-fighter shield bubble overlay ------
        // Refresh each fighter's shield bubble from their live shield
        // state. Eliminated fighters have their bubble hidden so a
        // corpse rectangle doesn't carry a stale defensive glow.
        // The bubble's `update` reads the simulated `frame` for the
        // broken-state strobe so the visual is replay-deterministic.
        for (const slot of this.playerSlots) {
          const bubble = this.shieldBubbles.get(slot.playerIndex);
          if (!bubble) continue;
          if (this.stockTracker.isEliminated(slot.playerIndex)) {
            bubble.hide();
            continue;
          }
          const pos = slot.character.getPosition();
          bubble.update({
            state: slot.character.getShieldState(),
            x: pos.x,
            y: pos.y,
            frame,
          });
        }

        // ---- Per-fighter charge / wind-up indicator overlay ------------
        // Refresh each fighter's charge indicator from their live charge
        // progress. `getChargeProgress()` returns `null` whenever the
        // fighter isn't winding a charge-type move up, so the indicator
        // hides on its own; eliminated fighters are hidden explicitly so
        // a corpse never carries a stale aura. The indicator's `update`
        // reads the simulated `frame` for the pulse phase so the wind-up
        // glow is replay-deterministic.
        // AC 10304 — alongside the visual indicator, drive the looping
        // charge wind-up hum. The hum is a single shared voice (the
        // `sfx.charge` cue is registered `loop: true, voiceLimit: 1`):
        // we aggregate "is ANY non-eliminated fighter mid-wind-up" this
        // frame and start / stop the loop on that edge. `playSfxLoop` is
        // idempotent (a no-op while already looping) so calling it every
        // charging frame doesn't restart the sample; `stopSfx` ends it
        // the frame the last charge finishes. Reads `getChargeProgress()`
        // (the same deterministic source the indicator paints from) —
        // the loop is a pure presentation side-effect, not sim state.
        let anyCharging = false;
        for (const slot of this.playerSlots) {
          const indicator = this.chargeIndicators.get(slot.playerIndex);
          const eliminated = this.stockTracker.isEliminated(slot.playerIndex);
          const progress = eliminated ? null : slot.character.getChargeProgress();
          if (progress !== null) anyCharging = true;
          if (!indicator) continue;
          if (eliminated) {
            indicator.hide();
            continue;
          }
          const pos = slot.character.getPosition();
          indicator.update({
            chargeProgress: progress,
            x: pos.x,
            y: pos.y,
            frame,
          });
        }
        // Edge-trigger the shared charge loop off the aggregate.
        if (this.sfxAudioManager) {
          const wasCharging = this.chargeLoopActive.get(0) === true;
          if (anyCharging && !wasCharging) {
            this.sfxAudioManager.playSfxLoop(ASSET_KEYS.sfxCharge);
            this.chargeLoopActive.set(0, true);
          } else if (!anyCharging && wasCharging) {
            this.sfxAudioManager.stopSfx(ASSET_KEYS.sfxCharge);
            this.chargeLoopActive.set(0, false);
          }
        }

        // ---- Hit-feedback FX: per-fighter swing trails -----------------
        // Draw a translucent streak along a held weapon's / smash
        // finisher's active-frame hitbox sweep so the swing has a visible
        // arc. Tied to the live `getActiveAttack()` geometry; the
        // formatter hides the trail for non-trailed moves / non-active
        // phases, so a fighter who isn't mid-weapon-swing shows nothing.
        // Eliminated fighters are hidden so a corpse never trails.
        for (const slot of this.playerSlots) {
          const trail = this.swingTrails.get(slot.playerIndex);
          if (!trail) continue;
          if (this.stockTracker.isEliminated(slot.playerIndex)) {
            trail.hide();
            continue;
          }
          const active = slot.character.getActiveAttack();
          if (!active) {
            trail.hide();
            continue;
          }
          const pos = slot.character.getPosition();
          trail.update({
            moveId: active.move.id,
            moveType: active.move.type,
            damage: active.move.damage,
            phase: active.phase,
            framesIntoActive: active.framesElapsed - active.move.startupFrames,
            hitbox: active.move.hitbox,
            facing: active.facing,
            bodyX: pos.x,
            bodyY: pos.y,
          });
        }

        // ---- Hit-feedback FX: advance live hit sparks ------------------
        // Age every live spark off the simulated frame counter and
        // recycle expired ones. Spawning happens in the hitbox-damage
        // callback; this only drives the per-frame expand / fade.
        this.hitSparkPool.update(frame);

        // ---- Down-special dive LANDING burst ---------------------------
        // Poll each fighter's one-shot landing event (set in the sim the
        // frame a dive touches down). A whiffed dive fires no collisionstart
        // and so no hit spark — this flashes a shockwave ring regardless,
        // at the RAW world landing point (fighter-anchored, like the hit
        // spark — NOT the stage transform).
        for (const slot of this.playerSlots) {
          const landing = slot.character.consumeDiveLandingEvent();
          if (landing !== null) {
            this.spawnBurst(landing.x, landing.y, 0xffe08a, 22, 14, 4, 5);
            this.spawnBurst(landing.x, landing.y, 0xffffff, 12, 10, 3, 5);
          }
        }
        // Advance + fade every one-shot burst (dive landings + muzzle flashes).
        this.tickOneShotBursts();

        // ---- F3 hitbox debug overlay -----------------------------------
        // Redraw the diagnostic boxes from each fighter's live geometry
        // when enabled (a cheap no-op while toggled off). Snapshots feed
        // the SAME `computeHitboxCenter` math the runtime spawns sensors
        // from, so the red boxes are truthful. Eliminated fighters are
        // skipped so a corpse doesn't carry stale boxes.
        if (this.hitboxDebugLayer.isEnabled()) {
          const debugSnapshots: HitboxDebugFighterSnapshot[] = [];
          for (const slot of this.playerSlots) {
            if (this.stockTracker.isEliminated(slot.playerIndex)) continue;
            const pos = slot.character.getPosition();
            const active = slot.character.getActiveAttack();
            const grabState = slot.character.getGrabState();
            const grabSpec = slot.character.getGrabSpec();
            // The grab range sensor is live only during the grab's
            // `whiffActive` window (mirrors `handleGrabStateTransition`).
            const grabRangeLive =
              grabState.name === 'whiffActive' && grabSpec !== null;
            debugSnapshots.push({
              bodyX: pos.x,
              bodyY: pos.y,
              facing: slot.character.getFacing(),
              hurtboxes: slot.character.getActiveHurtboxes(),
              activeAttack: active
                ? { move: active.move, facing: active.facing, phase: active.phase }
                : null,
              activeGrab:
                grabRangeLive && grabSpec
                  ? { hitbox: grabSpec.hitbox }
                  : null,
            });
          }
          this.hitboxDebugLayer.render(debugSnapshots);
        }

        // ---- HUD -------------------------------------------------------
        // Sub-AC 3 of AC 3: refresh the FPS overlay. Render FPS comes
        // from Phaser's smoothed `actualFps`; simulation tick rate comes
        // from the rolling-window meter the counter owns (fed by
        // `recordSimSteps` in the outer `update()` below).
        this.fpsCounter.update();
        this.frameText.setText(
          `Frame: ${this.physicsEngine.getFrame()}  α=${alpha.toFixed(2)}`,
        );
        const cam = this.cameraController.getCamera();
        const center = this.cameraController.getTargetCenter();
        this.camText.setText(
          `Cam (${cam.midPoint.x.toFixed(0)}, ${cam.midPoint.y.toFixed(0)})  ` +
            `→ (${center.x.toFixed(0)}, ${center.y.toFixed(0)})  ` +
            `zoom ${cam.zoom.toFixed(2)}`,
        );
        const p1Stocks = this.stockTracker.getStocks(0);
        const p2Stocks = this.stockTracker.getStocks(1);
        // Debug HUD pos/facing/tuning helpers for the per-fighter
        // dev-mode text overlays. Re-derive here (the per-frame loop
        // above iterates `playerSlots` directly and no longer keeps
        // these locals around).
        const p1Pos = this.p1.getPosition();
        const p2Pos = this.p2.getPosition();
        const p1Facing = this.p1.getFacing();
        const p2Facing = this.p2.getFacing();
        const p1Tuning = this.p1.getTuning();
        const p2Tuning = this.p2.getTuning();
        this.p1Text.setText(
          `P1 Wolf  pos(${p1Pos.x.toFixed(0)},${p1Pos.y.toFixed(0)})  ` +
            `face ${p1Facing > 0 ? '→' : '←'}  ` +
            `jumps ${this.p1.getJumpsUsed()}/${p1Tuning.maxJumps}  ` +
            `${this.p1.isAttacking() ? 'ATK' : '   '}` +
            `${this.p1.isGrounded() ? '  grnd' : '  air '}` +
            `  ${this.p1.getDamagePercent().toFixed(0)}%` +
            `  ${this.p1.isInvincible() ? `INV(${this.p1.getInvincibilityRemaining()})` : '         '}`,
        );
        this.p2Text.setText(
          `P2 Cat   pos(${p2Pos.x.toFixed(0)},${p2Pos.y.toFixed(0)})  ` +
            `face ${p2Facing > 0 ? '→' : '←'}  ` +
            `jumps ${this.p2.getJumpsUsed()}/${p2Tuning.maxJumps}  ` +
            `${this.p2.isAttacking() ? 'ATK' : '   '}` +
            `${this.p2.isGrounded() ? '  grnd' : '  air '}` +
            `  ${this.p2.getDamagePercent().toFixed(0)}%` +
            `  ${this.p2.isInvincible() ? `INV(${this.p2.getInvincibilityRemaining()})` : '         '}`,
        );
        this.stockText.setText(
          `P1 ${stockGlyphs(p1Stocks)}    P2 ${stockGlyphs(p2Stocks)}`,
        );

        // ---- Sub-AC 3 of AC 60003: damage-percent HUD ----------------
        // Refresh the bottom-strip percent meters in slot order. Reading
        // `playerSlots` (not `p1`/`p2` directly) keeps the HUD wiring
        // generic for the M2 4-player FFA — we just hand the HUD however
        // many percents the slot table reports.
        this.damageHud.update(
          this.playerSlots.map((slot) => slot.character.getDamagePercent()),
        );

        // ---- AC 30004 Sub-AC 4: recording HUD ------------------------
        // Live-update the bottom-left line so the player knows the
        // match is being recorded and how long it's been going. The
        // status snapshot is read from the controller (single source
        // of truth) — no scattered "isRecording" booleans.
        const recStatus = this.recordingController.getStatus();
        const recSeconds = recStatus.frameCount / 60;
        const recMin = Math.floor(recSeconds / 60);
        const recSec = Math.floor(recSeconds % 60);
        const recTime = `${recMin}:${String(recSec).padStart(2, '0')}`;
        if (recStatus.phase === 'recording') {
          this.recordingHud.setText(
            `● REC  ${recTime}  (${recStatus.frameCount}f)  — press S to save`,
          );
        } else if (recStatus.phase === 'stopped') {
          this.recordingHud.setText(
            `■ STOPPED  ${recTime}  (${recStatus.frameCount}f)  — press S to save replay`,
          );
        } else {
          this.recordingHud.setText('');
        }

        // Match-over banner — driven by `MatchEndDetector` so the freeze
        // window matches the state machine's transition timer exactly.
        // Reads the latched payload (frozen on entry to ENDING) instead
        // of the live tracker so a stray late event can't change the
        // banner text mid-freeze.
        if (this.matchEndDetector.isMatchOver()) {
          const payload = this.matchEndDetector.getResultPayload();
          const winnerIndex = payload?.winnerIndex ?? null;
          const winnerName = payload?.winnerName ?? null;
          const text =
            winnerIndex === null
              ? 'DRAW'
              : `${(winnerName ?? `Player ${winnerIndex + 1}`).toUpperCase()} WINS!`;
          this.matchOverText.setText(text).setVisible(true);
        } else {
          this.matchOverText.setVisible(false);
        }
      },
    );
    // Sub-AC 3 of AC 3: feed the rolling-window tick-rate meter with the
    // number of simulation steps that just ran. Sampling here (after
    // `advance` returns) means the meter sees the same step count the
    // engine actually executed, including any catch-up steps after a
    // tab-background pause. The render hook above pulls the latest Hz
    // figure on the very next call.
    this.fpsCounter.recordSimSteps(stepsThisTick);
  }

  /**
   * Build the upper-right music toggle button. Painted on the UI camera
   * so it sits above the gameplay world. Click toggles mute on/off;
   * the muted state persists across scenes via the registry.
   *
   * Click handling goes through a DOM-level `mousedown` listener on
   * the canvas, NOT Phaser's per-object `setInteractive` +
   * `pointerdown`. The Phaser path silently fails to dispatch
   * pointerdown after a `scene.start` from another scene — observed
   * and worked around in `RebindingScene` and `CharacterSelectScene`.
   * The DOM router converts client coords to canvas-space coords
   * (accounting for CSS scaling) and hit-tests against a stored
   * rect, which is reliable across every scene-transition path.
   */
  /**
   * Previous-frame feet Y per fighter, used by the pass-through driver
   * to distinguish "feet crossed the platform top this step" (a real
   * landing — keep solid) from "feet were already below last step"
   * (lateral approach or mid-fall after a drop-through — phase).
   *
   * `WeakMap` so destroyed fighters get garbage-collected without an
   * explicit cleanup pass.
   */
  private prevFighterFeetY: WeakMap<Character, number> = new WeakMap();

  /**
   * Landing-grace registry for the pass-through driver, keyed
   * fighter → set of platform body ids currently in a "resolving a
   * landing" state.
   *
   * Why it exists: the driver's original crossing rule granted exactly
   * ONE solid frame ("prevFeet above, feet below") and then phased on
   * "below for 2 consecutive steps". That held at legacy fall speeds
   * (≤ ~12 px/step penetrates a 22-24 px float shallowly enough for
   * Matter to resolve within the frame), but the Smash-feel pack's
   * fast-fall (17.5-20 px/step) buries the feet ~16 px into the float
   * on the crossing step — deeper than Matter's position correction
   * can unwind in one frame — so the 2-consecutive-steps rule read the
   * still-resolving landing as "lateral approach" and dropped the
   * collision mid-landing: fighters fell straight through every float
   * they fast-fell onto.
   *
   * The grace entry keeps the pair solid from the crossing frame until
   * the landing actually resolves (feet back above the top epsilon),
   * the fighter tunnels clear past the platform's BOTTOM (give up —
   * phase so they fall cleanly), or a deliberate drop-through window
   * opens. Lateral approaches never enter the grace (their prevFeet
   * were already below on the crossing frame), so the case the
   * 2-consecutive-steps rule was built for still phases instantly.
   *
   * Determinism: driven purely by simulation state (feet positions,
   * platform bounds, drop-through window) — replay-safe.
   */
  private passThroughLandingGrace: WeakMap<Character, Set<number>> = new WeakMap();

  /**
   * Platform-driver diagnostic ring buffer (last ~6000 decisions).
   * Every per-fighter / per-platform branch the pass-through driver
   * takes while the fighter overlaps the platform's column is recorded
   * here; pressing F9 in-match downloads the buffer as
   * `platform-diag.json` for offline analysis. Pure observation — the
   * log never feeds back into the simulation.
   */
  private platformDiagLog: Array<{
    f: number; b: number; s: number; br: string;
    feet: number; prev: number; top: number; vy: number; m: number;
  }> = [];

  /**
   * Soft fighter-to-fighter body separation, run once per physics step
   * AFTER Matter resolves collisions. Mirrors Smash Bros "soft collision":
   * when two fighters' bodies overlap (horizontally or vertically), apply a
   * small corrective velocity to push them apart, at a rate proportional to
   * the overlap depth. This prevents stacking without the bounciness of a
   * rigid-body collision pair.
   *
   * Exemptions:
   *   – Any fighter in hitstun (the launched body phases through the attacker
   *     for one step; enforcing separation would fight the knockback vector).
   *   – Any fighter currently held in a grab (the grabber pins their position
   *     each step — applying a push would jitter the pin).
   */
  private updateFighterSeparation(): void {
    const fighters: Character[] = [this.p1, this.p2, ...this.extraFighters].filter(
      (f): f is Character => f !== null && f !== undefined,
    );
    if (fighters.length < 2) return;

    // Speed (px/step) applied per px of overlap, capped so shallow grazes
    // get a gentle nudge while deep interpenetrations resolve quickly.
    const PUSH_PER_PX = 0.22;
    const MAX_PUSH = 3.5;

    for (let i = 0; i < fighters.length; i++) {
      for (let j = i + 1; j < fighters.length; j++) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const a = fighters[i]!;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const b = fighters[j]!;

        const snap = a.getAnimationSnapshot();
        const snapB = b.getAnimationSnapshot();
        if (
          snap.hitstunRemaining > 0 || snapB.hitstunRemaining > 0 ||
          snap.hitlagRemaining > 0 || snapB.hitlagRemaining > 0 ||
          snap.destroyed || snapB.destroyed ||
          a.isGrabbed() || b.isGrabbed()
        ) continue;

        const ba = a.body.bounds;
        const bb = b.body.bounds;

        // AABB overlap on both axes is required for a real intersection.
        const xOverlap = Math.min(ba.max.x, bb.max.x) - Math.max(ba.min.x, bb.min.x);
        if (xOverlap <= 0) continue;
        const yOverlap = Math.min(ba.max.y, bb.max.y) - Math.max(ba.min.y, bb.min.y);
        if (yOverlap <= 0) continue;

        const posA = a.getPosition();
        const posB = b.getPosition();

        // Resolve along the axis of least penetration.
        if (xOverlap <= yOverlap) {
          const push = Math.min(xOverlap * PUSH_PER_PX, MAX_PUSH);
          const dir = posA.x < posB.x ? -1 : 1; // a is left → push a left
          const va = a.getVelocity();
          const vb = b.getVelocity();
          this.matter.body.setVelocity(a.body, { x: va.x + dir * push, y: va.y });
          this.matter.body.setVelocity(b.body, { x: vb.x - dir * push, y: vb.y });
        } else {
          const push = Math.min(yOverlap * PUSH_PER_PX, MAX_PUSH);
          const dir = posA.y < posB.y ? -1 : 1; // a is above → push a up
          const va = a.getVelocity();
          const vb = b.getVelocity();
          this.matter.body.setVelocity(a.body, { x: va.x, y: va.y + dir * push });
          this.matter.body.setVelocity(b.body, { x: vb.x, y: vb.y - dir * push });
        }
      }
    }
  }

  private recordPlatDiag(
    b: number, s: number, br: string,
    feet: number, prev: number, top: number, vy: number, m: number,
  ): void {
    this.platformDiagLog.push({
      f: this.physicsEngine.getFrame(), b, s, br,
      feet: Math.round(feet * 10) / 10,
      prev: Math.round(prev * 10) / 10,
      top: Math.round(top * 10) / 10,
      vy: Math.round(vy * 100) / 100,
      m,
    });
    if (this.platformDiagLog.length > 6000) {
      this.platformDiagLog.splice(0, this.platformDiagLog.length - 6000);
    }
  }

  /**
   * Per-step pass-through-platform mask driver. Iterates every
   * pass-through platform in the stage and decides whether it should
   * currently be character-collidable based on each fighter's vertical
   * position history.
   *
   * Phase rule (== drop the CHARACTER bit on the platform's mask):
   *
   *   • A fighter is in the rapid double-tap-down drop-through window
   *     → phase. (Lets them deliberately fall off a platform they're
   *     standing on. The window covers the first few frames before
   *     gravity moves the feet past the top epsilon.)
   *
   *   • A fighter's feet are below the platform top AND were already
   *     below on the previous step → phase. Covers two cases the
   *     original "isRising" gate was breaking:
   *       - lateral approach at a lower height while falling (vy ≥ 0,
   *         feet always below — should pass through);
   *       - the tail of a drop-through after the input window has
   *         expired but the body hasn't yet cleared the platform's
   *         vertical extent.
   *     Requiring the previous frame's feet to also be below preserves
   *     the standard landing case: a fighter falling onto the platform
   *     from above has prevFeet above the top, so the platform stays
   *     solid on the crossing frame and Matter resolves the landing.
   *
   *   • Otherwise → solid for this fighter.
   *
   * Skips platforms whose mask is currently `0` — that's the
   * "inactive" state set by the crumble adapter (lifecycle phase
   * `falling`/`gone`); reanimating a fallen platform here would
   * resurrect it. When crumble respawns, mask becomes non-zero again
   * and the driver resumes ownership on the next step.
   *
   * Cheap: 4 fighters × ~3 pass-through platforms = 12 iterations per
   * step. Writes the body's `collisionFilter` directly because we need
   * a per-slot mask shape, which the legacy `togglePlatformCollision`
   * helper (single global "phase everyone" toggle) can't express.
   */
  private updatePassThroughPlatformMasks(): void {
    const platforms = this.baseStage?.rendered?.platformBodies;
    if (!platforms) return;
    const fighters: Character[] = [this.p1, this.p2, ...this.extraFighters].filter(
      (f): f is Character => f !== undefined && f !== null,
    );

    // Snapshot current feet positions once so every platform iterates
    // against the same baseline; commit to prevFeet *after* the loop
    // so prevFeet always reflects the previous step.
    const currentFeet = new Map<Character, number>();
    for (const fighter of fighters) {
      currentFeet.set(fighter, fighter.getBodyBottomY());
    }
    // 4 px epsilon for the feet-vs-top compare (rejects a fighter
    // standing on the platform from the "below" branch); 2 px for
    // the horizontal-overlap padding so a body grazing the edge
    // isn't borderline-counted.
    const FEET_EPS = 4;
    const X_EPS = 2;
    // Vertical band around a platform's top within which, while we hold the
    // fighter SOLID and it is descending, we tell the fighter to suppress its
    // per-fighter fall-accel for the next step (`markPlatformFallSupported`).
    // Covers the ~15 px the body can be ejected above a thin float during a
    // landing wobble so the fall speed can't re-spike and tunnel back through.
    // Kept tight so a fighter merely passing high above a platform is
    // unaffected — free-fall feel only changes within this landing band.
    const SUPPORT_BAND = 20;

    for (const body of platforms) {
      const isPassThrough = body.label === PLATFORM_LABELS.passThrough;
      const isPlatform =
        isPassThrough || body.label === PLATFORM_LABELS.solid;
      if (!isPlatform) continue;
      const filter = body.collisionFilter;
      // Crumble adapter writes mask=0 for the lifecycle 'falling' /
      // 'gone' states. Skip — we must not resurrect a fallen platform
      // (and must not landing-assist onto one).
      if (filter.mask === 0) continue;
      const platBounds = body.bounds;
      const platTop = platBounds?.min?.y ?? body.position.y;
      const platBottom = platBounds?.max?.y ?? body.position.y;
      const platLeft = platBounds?.min?.x ?? body.position.x;
      const platRight = platBounds?.max?.x ?? body.position.x;

      let mask = 0;
      for (const fighter of fighters) {
        const slotBit = CHARACTER_SLOT_BITS[fighter.slotIndex];
        if (slotBit === undefined) continue;
        let grace = this.passThroughLandingGrace.get(fighter);

        const fLeft = fighter.getBodyLeftX();
        const fRight = fighter.getBodyRightX();
        const overlapsX = fRight >= platLeft - X_EPS && fLeft <= platRight + X_EPS;
        // No horizontal overlap — keep this slot solid by default so
        // any future approach starts from the correct state. The next
        // step will recompute once they overlap. Any landing grace is
        // stale once the fighter has left the platform's column.
        if (!overlapsX) {
          grace?.delete(body.id);
          mask |= slotBit;
          continue;
        }

        if (isPassThrough && fighter.isInDropThroughWindow()) {
          // Phase — drop this slot bit. A deliberate drop-through
          // cancels any in-flight landing grace for this platform.
          grace?.delete(body.id);
          this.recordPlatDiag(
            body.id, fighter.slotIndex, 'dropWindow',
            currentFeet.get(fighter)!,
            this.prevFighterFeetY.get(fighter) ?? currentFeet.get(fighter)!,
            platTop, fighter.getVelocity().y, mask,
          );
          continue;
        }

        const feet = currentFeet.get(fighter)!;
        // First-step fallback: missing prev sample collapses to the
        // current sample. A freshly-spawned fighter standing on the
        // platform reads "was at top, is at top" = solid; one spawned
        // below reads "was below, is below" = phased.
        const prevFeet = this.prevFighterFeetY.get(fighter) ?? feet;
        const feetBelowTop = feet > platTop + FEET_EPS;
        const prevFeetBelowTop = prevFeet > platTop + FEET_EPS;

        // ---- Landing assist (CCD for thin platforms) ----------------
        // A genuine falling crossing — feet above the top last step,
        // below it now, still moving downward. At Smash-feel fall
        // speeds (11-20 px/step) the crossing step can bury the feet
        // PAST the mid-plane of a 22-24 px float, and Matter resolves
        // overlap along the SHORTEST exit — ejecting the fighter
        // downward THROUGH the platform instead of up onto it,
        // sub-pixel-dependent (the "sometimes lands, sometimes falls
        // through" coin flip). Don't gamble on the solver: snap the
        // body up so the feet rest 1 px into the surface and kill the
        // fall velocity — the standard platform-fighter landing
        // resolution. Applies to BOTH pass-through floats and thin
        // solid carriers; purely simulation-state-driven, replay-safe.
        // Solid bodies only qualify when THIN (≤ 48 px — the moving
        // carriers): thick grounds resolve fine on their own (the
        // penetration can never reach their mid-plane), and custom-
        // stage SLOPES are solid rotated bodies whose bounding-box top
        // is not their walking surface — snapping to it would teleport
        // the fighter uphill.
        const assistEligible =
          isPassThrough || platBottom - platTop <= 48;
        if (
          assistEligible &&
          feetBelowTop &&
          !prevFeetBelowTop &&
          fighter.getVelocity().y >= 0
        ) {
          const lift = feet - (platTop + 1);
          const pos = fighter.getPosition();
          this.matter.body.setPosition(fighter.body, {
            x: pos.x,
            y: pos.y - lift,
          });
          this.matter.body.setVelocity(fighter.body, {
            x: fighter.getVelocity().x,
            y: 0,
          });
          grace?.delete(body.id);
          mask |= slotBit;
          // We just resolved this fighter's landing onto the float — hold its
          // fall-accel off next step so it settles instead of re-spiking and
          // tunnelling back through (the pass-through platform jitter).
          fighter.markPlatformFallSupported();
          this.recordPlatDiag(
            body.id, fighter.slotIndex, 'assistSnap',
            feet, prevFeet, platTop, 0, mask,
          );
          continue;
        }

        if (!isPassThrough) {
          // Solid platforms never phase — the landing assist above is
          // the only per-fighter work they need.
          continue;
        }

        if (!feetBelowTop) {
          // At or above the top — standing / falling toward it. Solid;
          // any prior landing grace has resolved.
          grace?.delete(body.id);
          mask |= slotBit;
          // Descending onto / resting just above the surface within the
          // landing band: suppress fall-accel next step so a contact flicker
          // can't ramp the fall speed back up and tunnel the body through.
          if (
            fighter.getVelocity().y >= 0 &&
            Math.abs(feet - platTop) <= SUPPORT_BAND
          ) {
            fighter.markPlatformFallSupported();
          }
          if (Math.abs(feet - platTop) < 60) {
            this.recordPlatDiag(
              body.id, fighter.slotIndex, 'solidAbove',
              feet, prevFeet, platTop, fighter.getVelocity().y, mask,
            );
          }
          continue;
        }

        if (!prevFeetBelowTop) {
          // CROSSING FRAME while moving upward (the landing assist
          // above handles the downward case) — e.g. clipped while
          // rising. Open the landing grace so the pair stays solid
          // while Matter unwinds the overlap.
          if (!grace) {
            grace = new Set<number>();
            this.passThroughLandingGrace.set(fighter, grace);
          }
          grace.add(body.id);
          mask |= slotBit;
          this.recordPlatDiag(
            body.id, fighter.slotIndex, 'graceOpenRising',
            feet, prevFeet, platTop, fighter.getVelocity().y, mask,
          );
          continue;
        }

        if (grace?.has(body.id)) {
          if (feet > platBottom + FEET_EPS) {
            // The body tunnelled clear past the platform's bottom —
            // the landing failed; phase so the fall completes cleanly
            // instead of warping the fighter back up.
            grace.delete(body.id);
            this.recordPlatDiag(
              body.id, fighter.slotIndex, 'graceBottomOut',
              feet, prevFeet, platTop, fighter.getVelocity().y, mask,
            );
            continue;
          }
          // Still resolving the landing — keep solid.
          mask |= slotBit;
          this.recordPlatDiag(
            body.id, fighter.slotIndex, 'graceHold',
            feet, prevFeet, platTop, fighter.getVelocity().y, mask,
          );
          continue;
        }

        // Below for ≥ 1 step with no landing in flight — lateral /
        // from-under approach (or post-drop-through tail): phase.
        this.recordPlatDiag(
          body.id, fighter.slotIndex, 'phase',
          feet, prevFeet, platTop, fighter.getVelocity().y, mask,
        );
      }

      if (isPassThrough) {
        filter.category = COLLISION_CATEGORIES.PLATFORM_PASS_THROUGH;
        // KEEPALIVE keeps a fully-phased platform's mask non-zero so
        // the crumble sentinel check above can never mistake the
        // driver's own write for a crumbled platform (the bit matches
        // no body, so it creates no collisions).
        filter.mask = mask | COLLISION_CATEGORIES.PASS_THROUGH_DRIVER_KEEPALIVE;
      }
    }

    for (const fighter of fighters) {
      this.prevFighterFeetY.set(fighter, currentFeet.get(fighter)!);
    }
  }

  // -------------------------------------------------------------------------
  // Pause menu (START / ESC) — overlay handoff
  // -------------------------------------------------------------------------

  /** True iff any connected gamepad holds START (standard-mapping index 9). */
  private isStartButtonHeld(): boolean {
    const pads = this.input.gamepad?.gamepads ?? [];
    for (const pad of pads) {
      if (pad && pad.buttons[9]?.pressed) return true;
    }
    return false;
  }

  /**
   * Freeze the simulation and launch the {@link PauseMenuScene} overlay
   * on top of the still-rendered match. `scene.launch` runs the overlay
   * in PARALLEL (this scene stays active so its frozen frame keeps
   * rendering); the freeze itself is the {@link pausedForMenu} guard in
   * {@link update}, NOT a Phaser `scene.pause` (which would also stop
   * our render). Idempotent — a double-trigger while already paused is
   * a no-op.
   */
  private openPauseMenu(): void {
    if (this.pausedForMenu) return;
    this.pausedForMenu = true;
    this.prevStartHeld = true; // swallow the opening press's edge
    this.scene.launch('PauseMenuScene');
  }

  /**
   * Callback the {@link PauseMenuScene} overlay dispatches into (it has
   * already stopped itself before calling). MatchScene owns the
   * freeze-lift and every scene transition so the flow contract lives in
   * one place.
   *
   *   • `resume`          — lift the freeze; the loop continues exactly
   *                         where it left off.
   *   • `restart`         — relaunch this match from the stashed config
   *                         (same `lastMatchConfig` rematch path the
   *                         results screen uses), preserving characters /
   *                         palettes / stage.
   *   • `characterSelect` — back to the fighter picker.
   *   • `mainMenu`        — back to the title.
   *   • `controls`        — open the rebinding screen (returns to the
   *                         main menu afterwards; the live match is not
   *                         resumable across a full scene swap).
   */
  handlePauseAction(action: PauseAction): void {
    switch (action) {
      case 'resume':
        this.pausedForMenu = false;
        // Re-arm the START latch so the resume press doesn't instantly
        // re-open the menu on the next frame.
        this.prevStartHeld = true;
        return;
      case 'restart': {
        const cfg = this.registry.get(BOOT_REGISTRY_KEYS.lastMatchConfig) as
          | MatchConfig
          | undefined;
        this.scene.start('MatchScene', cfg ? { matchConfig: cfg } : undefined);
        return;
      }
      case 'characterSelect':
        this.scene.start('CharacterSelectScene');
        return;
      case 'mainMenu':
        this.scene.start('MainMenuScene');
        return;
      case 'controls':
        this.scene.start('RebindingScene', { returnTo: 'MainMenuScene' });
        return;
    }
  }

  private buildMusicToggleButton(initiallyMuted: boolean): void {
    const { width } = this.scale.gameSize;
    const ICON_ON = '🔊';
    const ICON_OFF = '🔇';
    const button = this.add
      .text(width - 16, 16, initiallyMuted ? ICON_OFF : ICON_ON, {
        fontFamily: 'monospace',
        fontSize: '28px',
        color: '#ffffff',
        backgroundColor: '#00000088',
        padding: { left: 6, right: 6, top: 4, bottom: 4 },
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(10000);
    this.musicToggleButton = button;

    const toggle = (): void => {
      const isMuted = this.registry.get(BOOT_REGISTRY_KEYS.musicMuted) === true;
      const nextMuted = !isMuted;
      this.registry.set(BOOT_REGISTRY_KEYS.musicMuted, nextMuted);
      if (nextMuted) {
        this.stageMusicController?.stop();
      } else {
        this.stageMusicController?.start();
      }
      // AC 10304 — the single HUD speaker toggle controls SFX too: a
      // player who silences the speaker expects the whole match to go
      // quiet, not just the soundtrack. Mirror the flag onto the SFX
      // bus + persist it so the preference survives the next match (the
      // SFX AudioManager reads `sfxMuted` at boot). The SFX mute is a
      // live `setMuted` so any in-flight cue (e.g. a charge loop) drops
      // immediately rather than only on the next play.
      this.registry.set(BOOT_REGISTRY_KEYS.sfxMuted, nextMuted);
      this.sfxAudioManager?.setMuted(nextMuted);
      button.setText(nextMuted ? ICON_OFF : ICON_ON);
    };

    const canvas = this.game.canvas;
    if (!canvas) return;
    // Make sure the canvas can receive DOM keyboard / mouse events.
    if (canvas.tabIndex < 0) canvas.tabIndex = 0;
    canvas.style.outline = 'none';
    const domHandler = (e: MouseEvent): void => {
      if (e.button !== 0) return;
      // Bail if the button has been torn down (e.g. mid-shutdown).
      if (!this.musicToggleButton || !this.musicToggleButton.scene) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const cx = (e.clientX - rect.left) * scaleX;
      const cy = (e.clientY - rect.top) * scaleY;
      // Hit-test against the button's live world bounds (Phaser
      // updates these whenever the text content changes; reading
      // them per-click means a future re-layout / resize doesn't
      // require a manual refresh of a cached rect).
      const b = button.getBounds();
      if (cx < b.x || cx > b.x + b.width) return;
      if (cy < b.y || cy > b.y + b.height) return;
      toggle();
    };
    canvas.addEventListener('mousedown', domHandler);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      canvas.removeEventListener('mousedown', domHandler);
    });
  }
}

/**
 * Render N stocks as small glyphs for the top-centre HUD strip. Three
 * filled "●" for full stocks, three hollow "○" for none — easy to read
 * from across the screen.
 */
function stockGlyphs(count: number): string {
  if (count <= 0) return 'OUT';
  return '●'.repeat(count);
}

/**
 * Sub-AC 2 of AC 10402 — pure projection from a live `Character`'s
 * runtime state to the {@link SpriteAnimationSnapshot} contract the
 * sprite-animation state machine consumes.
 *
 * Kept as a module-level helper (rather than a `Character` method) so
 * the snapshot shape stays a renderer-side concern: the Character class
 * already exposes everything we need (`getActiveAttack`, `getVelocity`,
 * `isGrounded`, `getHitstunRemaining`, `id`) and adding another adapter
 * here keeps the Character API surface stable.
 */
function buildSpriteAnimationSnapshot(character: Character): SpriteAnimationSnapshot {
  const velocity = character.getVelocity();
  // A move with `suppressFighterPose: true` (e.g. the ray gun shot)
  // applies damage / spawns projectiles normally but the holder's
  // visible animation should NOT switch into the swing pose. We
  // report `isAttacking: false` to the sprite classifier so the
  // fighter falls through to its motion-driven pose (idle / run /
  // jump / fall). The `Character.isAttacking()` predicate stays true
  // for cooldown / damage gating elsewhere — this is a render-only
  // override.
  const active = character.getActiveAttack();
  const visiblyAttacking =
    character.isAttacking() && active?.move.suppressFighterPose !== true;
  return {
    characterId: character.id,
    isAttacking: visiblyAttacking,
    hitstunRemaining: character.getHitstunRemaining(),
    grounded: character.isGrounded(),
    velocityX: velocity.x,
    velocityY: velocity.y,
    destroyed: false,
  };
}
