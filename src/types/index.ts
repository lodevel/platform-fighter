/**
 * Shared domain types for the platform fighter.
 *
 * These mirror the ontology defined in the project Seed:
 * characters, movesets, stages, matches, inputs, replays.
 *
 * Concrete implementations land in later acceptance criteria;
 * for the scaffold we only declare the shapes that other modules
 * will import as they come online.
 */

export type CharacterId =
  | 'wolf'
  | 'cat'
  | 'owl'
  | 'bear'
  | 'blaze'
  | 'puff'
  | 'aegis'
  | 'volt'
  | 'nova'
  | 'bruno';

export type MoveType =
  | 'jab'
  | 'tilt'
  | 'smash'
  | 'aerial'
  | 'special'
  | 'sideSpecial'
  | 'upSpecial'
  | 'downSpecial'
  | 'grab'
  | 'throw'
  | 'shield'
  | 'dodge'
  | 'taunt';

export interface Move {
  readonly id: string;
  readonly type: MoveType;
  readonly frames: number; // 6-8 animation frames
  readonly damage: number;
  readonly knockback: { x: number; y: number; scaling: number };
  readonly startupFrames: number;
  readonly activeFrames: number;
  readonly recoveryFrames: number;
}

export interface Moveset {
  readonly characterId: CharacterId;
  readonly moves: ReadonlyArray<Move>;
}

export type InputType = 'keyboard_p1' | 'keyboard_p2' | 'gamepad' | 'ai';

export type AiDifficulty = 'easy' | 'medium' | 'hard';

export interface PlayerSlot {
  readonly index: 1 | 2 | 3 | 4;
  readonly characterId: CharacterId;
  readonly paletteIndex: number; // 0-7
  readonly inputType: InputType;
  readonly aiDifficulty?: AiDifficulty;
}

export type HazardType = 'lava' | 'wind' | 'crusher' | 'spikes' | 'moving_platform';

/**
 * Authoring record for a single stage hazard placement. Common
 * geometry / timing fields live at the top level so the stage builder
 * UI, replay tooling, and the runtime renderer all share one shape;
 * hazard-specific tuning (lava active threshold, wind force vector,
 * etc.) is exposed as optional fields below.
 *
 * Field semantics by hazard `type`:
 *
 *   - `lava`: `(x, y)` is the centre-bottom of the lava column —
 *     `x` is the centre X, `y` is the **resting bottom edge** the
 *     lava grows upward from. `width` is the column width; `height`
 *     is the **maximum (apex) rise height** in design pixels (NOT
 *     the AABB height — the actual occupied height oscillates
 *     between `minHeight` and `height`). See {@link LavaHazard}.
 *
 *   - `wind`: `(x, y)` is the centre of the wind zone (design pixels).
 *     `width`/`height` describe the AABB of the directional force
 *     volume. `forceX`/`forceY` define the peak directional force in
 *     px/frame² applied to overlapping fighters at apex; the
 *     `WindZoneHazard` runtime entity scales this peak by the cosine
 *     of cycle position so the gust ramps up, peaks, ramps down, and
 *     reverses every cycle. See {@link WindZoneHazard}.
 *
 *   - `crusher`/`spikes`/`moving_platform`: reserved — full semantics
 *     land alongside their renderer in later sub-ACs.
 *
 * All optional tuning fields default to the canonical value exposed
 * by the corresponding renderer module (e.g. `LAVA_DEFAULTS` for
 * lava). They sit on `StageHazard` (rather than a hazard-type-
 * specific union) so JSON serialised stages from the M3 builder
 * stay round-trippable through a single, stable shape.
 */
export interface StageHazard {
  readonly type: HazardType;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /**
   * Total cycle length in fixed frames (one full rise+fall for lava;
   * one full move-and-back for moving platforms; etc.). Optional —
   * each hazard renderer falls back to its own default. Lava uses
   * `LAVA_DEFAULTS.cycleFrames` (600 ≈ 10 s @ 60 Hz).
   */
  readonly cycleFrames?: number;
  /**
   * Initial cycle phase offset in fixed frames. Lets two hazards on
   * the same stage stagger their cycles (e.g. two lava pools that
   * alternate so the stage always offers a safe spot). Default `0`;
   * the renderer normalises negative / >cycleFrames values modulo
   * the cycle.
   */
  readonly phaseFrames?: number;
  /**
   * Damage in `%` applied per overlap-tick while the hazard is
   * active. Used by lava (per active overlap frame) and spikes
   * (per touch). Default per-renderer (lava: 8%/tick).
   */
  readonly damagePerTick?: number;
  /**
   * For lava: cycle-fraction (0..1) above which the hazard's height
   * is "active" (lethal). Below the threshold the lava is inert and
   * fighters can cross safely. Default `LAVA_DEFAULTS.activeThreshold`
   * (0.55).
   */
  readonly activeThreshold?: number;
  /**
   * For lava: minimum (resting) height in design pixels. Default `0`
   * (lava fully recedes into `baseY` at trough). Set to a non-zero
   * value to author a "permanent shallow pool that occasionally
   * surges" effect.
   */
  readonly minHeight?: number;
  /**
   * For wind: peak horizontal force vector at apex of the cycle, in
   * design-pixel acceleration units (px/frame²). Sign carries
   * direction — negative blows leftward (toward -X), positive blows
   * rightward (toward +X). The `WindZoneHazard` runtime entity scales
   * this peak by the cosine of the cycle position, so the actual
   * applied force smoothly oscillates between `+forceX` (apex) and
   * `-forceX` (anti-apex / half a cycle later). Optional — defaults
   * to `WIND_DEFAULTS.peakForceX` when omitted.
   */
  readonly forceX?: number;
  /**
   * For wind: peak vertical force vector at apex of the cycle.
   * Sign convention: negative pushes upward (toward -Y in screen
   * space), positive pushes downward. Same oscillation rule as
   * `forceX`. Optional — defaults to `0` (horizontal-only gust) so
   * existing wind hazards keep their current behaviour.
   */
  readonly forceY?: number;
  /**
   * Stable identifier — used by the replay snapshot system, the HUD
   * KO callouts ("KO'd by lava-pool-A!"), and the stage-builder
   * undo log. Must be unique within a single stage. Defaults to
   * the hazard `type` for single-hazard stages; multi-hazard stages
   * (two lava pools, etc.) MUST set this.
   */
  readonly id?: string;
}

export interface BlastZone {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

// ---------------------------------------------------------------------------
// Platform schema — three behavior types (Sub-AC 1 of AC 90301)
// ---------------------------------------------------------------------------

/**
 * The three supported platform behavior types.
 *
 *   - `'solid'`        : full collider on every side. Standard ground.
 *   - `'pass-through'` : top-collider only. Characters can jump up
 *                        through it and drop through it (Smash-style
 *                        floating platforms).
 *   - `'moving'`       : a kinematic platform that travels along a
 *                        configured path each frame. Carries riders.
 *                        Solid by default; set `passThrough: true` on
 *                        the platform to make a drop-through moving
 *                        platform.
 *
 * The legacy boolean `passThrough` field stays on every platform record
 * (always required) for backward compatibility with the M1/M2 schema —
 * existing code paths that read `p.passThrough` keep working without
 * modification. New code should prefer the explicit `behavior` field
 * and `getPlatformBehavior()` helper, which return the canonical type
 * even when the optional `behavior` field is omitted.
 */
export type PlatformBehavior = 'solid' | 'pass-through' | 'moving';

/**
 * Path-mode for a moving platform.
 *
 *   - `'ping-pong'` (default): the platform travels through the
 *     waypoints in order, then reverses direction at the end. One
 *     "cycle" is a full there-and-back trip.
 *   - `'loop'`: at the last waypoint the platform teleports back to
 *     the first waypoint and continues forward. One cycle is a single
 *     forward traversal.
 */
export type MovingPlatformPathMode = 'ping-pong' | 'loop';

/**
 * Easing curve applied to the per-segment interpolation parameter.
 * `'linear'` is constant velocity (default); `'sine'` produces a
 * smooth slow-fast-slow profile so platforms don't lurch at the
 * waypoints.
 */
export type MovingPlatformEasing = 'linear' | 'sine';

/** Single waypoint along a moving platform's path, in design coordinates. */
export interface MovingPlatformWaypoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Configuration record describing how a moving platform travels.
 *
 * Position is computed from the platform's *base* `(x, y)` plus the
 * current point on the path, so a platform's authored `(x, y)` acts
 * as the path's local origin (the first waypoint sits at `(0, 0)` by
 * convention; subsequent waypoints are deltas). Two pools/platforms
 * can share a single path by reusing the same `MovingPlatformMotion`
 * record but offsetting their `phaseFrames` so they stagger.
 *
 * Determinism: every value is integer-or-finite-number; the cycle is
 * advanced by the fixed-step engine in whole frames so two simulations
 * with the same `cycleFrames`/`phaseFrames` produce identical paths.
 */
export interface MovingPlatformMotion {
  /**
   * Sequence of waypoints traversed in order. Coordinates are in
   * **design pixels relative to the platform's base position** —
   * waypoint `(0, 0)` corresponds to the platform sitting at its
   * authored `(x, y)`. Must contain at least two waypoints; a single-
   * waypoint path has no movement and should use `behavior: 'solid'`
   * instead.
   */
  readonly waypoints: ReadonlyArray<MovingPlatformWaypoint>;
  /**
   * Total cycle length in fixed frames. For `'ping-pong'` mode this
   * is one full there-and-back trip; for `'loop'` mode it is one full
   * forward traversal. Must be an integer ≥ 2 so the cycle advances
   * deterministically alongside the fixed-step engine.
   */
  readonly cycleFrames: number;
  /**
   * Initial offset into the cycle in fixed frames. Lets two moving
   * platforms on the same stage stagger their motion. Default `0`;
   * the renderer normalises negative / >cycleFrames values modulo
   * the cycle, matching how `StageHazard.phaseFrames` works.
   */
  readonly phaseFrames?: number;
  /** Path traversal mode. Default `'ping-pong'`. */
  readonly mode?: MovingPlatformPathMode;
  /**
   * Easing curve applied between waypoints. `'linear'` (default)
   * gives constant speed; `'sine'` smooths the start/end of each
   * segment so riders aren't yanked at corners.
   */
  readonly easing?: MovingPlatformEasing;
}

/**
 * Canonical authoring record for a single platform on a stage.
 *
 * Field semantics by `behavior`:
 *
 *   - `'solid'` (default when `behavior` is omitted and `passThrough`
 *     is `false`): a static rectangular collider centred at `(x, y)`
 *     with the given `width`/`height`.
 *
 *   - `'pass-through'` (default when `behavior` is omitted and
 *     `passThrough` is `true`): same geometry, but characters can
 *     ascend through it from below and drop through it on input.
 *     Renderer maps it to `COLLISION_CATEGORIES.PLATFORM_PASS_THROUGH`.
 *
 *   - `'moving'` (must be explicit): the platform follows the path
 *     described by the required `motion` record. The platform body
 *     is kinematic — Matter's `isStatic: true` plus per-frame
 *     `Body.setPosition` updates from the motion module — so it
 *     carries riders without applying gravity to itself. When
 *     `passThrough` is `true` on a moving platform, the platform
 *     becomes a drop-through moving platform (rare, but supported by
 *     the schema for stage-builder use).
 *
 * Schema invariants enforced by validators (see
 * `src/stages/platformBehavior.ts`):
 *
 *   - `behavior === 'moving'` ⇒ `motion` must be present and well-formed.
 *   - `behavior !== 'moving'` ⇒ `motion` must NOT be present (avoids
 *     ambiguous "static platform with a path" records).
 *   - `passThrough` and `behavior`, when both present, must be
 *     consistent: `passThrough === true` ⇒ `behavior !== 'solid'`.
 */
export interface StagePlatform {
  /** Centre X in design coordinates. */
  readonly x: number;
  /** Centre Y in design coordinates. */
  readonly y: number;
  /** Width in design pixels. */
  readonly width: number;
  /** Height in design pixels. */
  readonly height: number;
  /**
   * Legacy drop-through flag. Always required so existing call sites
   * (`p.passThrough`) keep working unchanged. For solid platforms this
   * is `false`; for pass-through it is `true`. Moving platforms
   * default this to `false` (rideable but not drop-through) — set it
   * to `true` only for the rare drop-through moving platform variant.
   */
  readonly passThrough: boolean;
  /**
   * Explicit behavior type. Optional only for backward compatibility
   * with M1-era stage records that only declared `passThrough`. New
   * code (stage builder, replay export, hazard stages) should always
   * set this. Use {@link getPlatformBehavior} when reading the
   * effective behavior.
   */
  readonly behavior?: PlatformBehavior;
  /**
   * Path config for `behavior === 'moving'`. Required when behavior
   * is `'moving'`; must be omitted otherwise.
   */
  readonly motion?: MovingPlatformMotion;
  /**
   * Optional stable identifier — used by the M3 stage builder, the
   * M4 replay snapshot system, and HUD callouts. Must be unique
   * within a single stage. Defaults to a renderer-generated id when
   * omitted. Required for moving platforms whose riders are tracked
   * across replay snapshots.
   */
  readonly id?: string;
}

// ---------------------------------------------------------------------------
// Item spawn anchors (T3 items framework, AC 10 Sub-AC 1)
// ---------------------------------------------------------------------------

/**
 * Authoring record for a single fixed stage-declared position where an
 * item may appear during a match. Anchors are pure geometry — they
 * declare *where* an item could spawn, not *when* or *what*. The
 * runtime spawn manager (a later sub-AC) reads this list at match
 * start, picks an anchor at random per spawn cycle (using a replay-
 * seeded RNG), and instantiates an item there.
 *
 * Coordinate convention matches every other stage authoring record in
 * this module: design pixels with `(0, 0)` at the top-left of the
 * `STAGE_DESIGN_WIDTH × STAGE_DESIGN_HEIGHT` viewport. The renderer's
 * design→viewport transform (cached on {@link BaseStage.transform})
 * converts the anchor to live screen pixels at item-spawn time so
 * stages stay resolution-independent.
 *
 * Anchors are typically authored to sit slightly above a platform's
 * top edge so the spawned item drops a few frames before settling on
 * the surface — Smash-style "items rain in from above". Authors who
 * want a mid-air anchor (e.g. above a pit so the item drops onto a
 * lower platform) just place the anchor at the desired sky height.
 *
 * Schema invariants:
 *
 *   • `(x, y)` is finite and falls inside the stage's blast zone (so
 *     the item doesn't get KO'd the moment it spawns). Validators land
 *     in a later sub-AC; the anchors authored on the built-in stages
 *     all satisfy this by construction.
 *   • `id`, when present, is unique within a single stage. The replay
 *     log writes the anchor's array index by default; a stable `id`
 *     lets a future stage-edit pass (insert / remove / reorder anchors)
 *     keep historic replays playing back against the right anchor.
 *
 * Determinism: the field is pure data — no `Math.random()`, no
 * wall-clock reads. Two simulations driven through identical
 * {@link StageLayout.itemSpawnAnchors} arrays pick the same anchor on
 * the same spawn tick under the same RNG seed.
 */
export interface ItemSpawnAnchor {
  /** Centre X of the spawn position, in design coordinates. */
  readonly x: number;
  /** Centre Y of the spawn position, in design coordinates. */
  readonly y: number;
  /**
   * Stable identifier — used by the replay log so a recorded
   * "spawn item at anchor #N" event survives a stage edit that
   * reorders the anchor list. Optional in v1 (anchor-by-index works
   * for the fixed built-in roster); required in stages that may be
   * edited after a replay was recorded against them.
   */
  readonly id?: string;
}

export interface StageLayout {
  readonly id: string;
  readonly platforms: ReadonlyArray<StagePlatform>;
  readonly hazards: ReadonlyArray<StageHazard>;
  readonly blastZone: BlastZone;
  readonly spawnPoints: ReadonlyArray<{ x: number; y: number }>;
  /**
   * Fixed positions where items may appear during a match. Pure data —
   * see {@link ItemSpawnAnchor} for the schema and authoring conventions.
   *
   * Optional only for back-compat with M1-era stage records authored
   * before the items framework landed (T3, AC 10). New stages and
   * every built-in stage in {@link STAGES} declare this field. Stages
   * with no anchors (e.g. an items-disabled custom stage variant)
   * surface as an empty array — the runtime spawn manager treats
   * empty / undefined identically: no items spawn on the stage.
   */
  readonly itemSpawnAnchors?: ReadonlyArray<ItemSpawnAnchor>;
  /**
   * Identifier of the themed parallax background this stage renders
   * with — a key into `STAGE_BACKGROUND_THEMES` in
   * `src/stages/backgroundThemes.ts` (e.g. `'lava-cavern'`,
   * `'wind-canyon'`). Kept as a plain `string` (not the literal union)
   * so the StageLayout schema stays decoupled from the theme registry
   * module and a layout JSON round-trip never drops an id authored
   * against a newer theme roster.
   *
   * Optional for back-compat with layouts authored before themed
   * backgrounds landed (M1-era records, M3 builder custom stages).
   * `StageBackgroundRenderer` resolves a missing / unknown id to the
   * neutral `'midnight'` theme, so omitting the field is always safe.
   */
  readonly backgroundTheme?: string;
}

export type MatchMode = 'stocks' | 'time';

/**
 * Items frequency knob (T3 items framework, AC 10 Sub-AC 2).
 *
 * Smash-Bros-style match-settings dial that controls how often the item
 * spawn manager drops a new item onto the stage. The four allowed
 * values map to a min/max spawn-interval window and a max-items-on-
 * field cap (see `ITEM_SPAWN_FREQUENCY_TABLE` and
 * `MAX_ITEMS_ON_FIELD_BY_FREQUENCY` in `src/items/itemSpawnSettings.ts`):
 *
 *   - `'off'`  : items disabled — spawn manager produces no items.
 *   - `'low'`  : sparse — long interval, low cap.
 *   - `'med'`  : default — moderate interval, moderate cap.
 *   - `'high'` : chaotic — short interval, high cap.
 *
 * The string-literal form keeps the value cheap to serialise into
 * `MatchConfig` / replay headers and is stable across versions; the
 * numeric tunings are owned by the items module so the headline knob
 * stays content-free.
 */
export type ItemFrequency = 'off' | 'low' | 'med' | 'high';

/**
 * Default items frequency for a fresh match config when the menu/replay
 * layer doesn't supply one. Matches Smash conventions — items default
 * to a moderate spawn rate so the framework is exercised end-to-end on
 * the first match a new player runs without forcing them through a
 * settings menu.
 *
 * Lives next to {@link ItemFrequency} (rather than in
 * `itemSpawnSettings.ts`) so consumers that only need the headline
 * default — `MatchConfig` builders, character-select scene, replay
 * back-compat — can pull it from the same `@types` barrel as the rest
 * of the match shape.
 */
export const DEFAULT_ITEM_FREQUENCY: ItemFrequency = 'med';

export interface MatchConfig {
  readonly mode: MatchMode;
  readonly stockCount: number;
  readonly timeLimitSeconds?: number;
  readonly stageId: string;
  readonly players: ReadonlyArray<PlayerSlot>;
  readonly rngSeed: number;
  /**
   * Items frequency knob — controls how often the spawn manager drops
   * an item onto the stage. See {@link ItemFrequency} for the dial
   * values and `src/items/itemSpawnSettings.ts` for the min/max
   * interval window and max-on-field cap each value resolves to.
   *
   * Optional only for back-compat with M1-era match configs authored
   * before the items framework landed (T3, AC 10). The runtime spawn
   * manager treats `undefined` as {@link DEFAULT_ITEM_FREQUENCY}
   * (`'med'`) so existing match-config call sites keep working without
   * modification; new menu paths should set it explicitly so the
   * resolved value round-trips through replay metadata.
   */
  readonly itemFrequency?: ItemFrequency;
}

// ---------------------------------------------------------------------------
// Unified input bindings (M5 rebinding system) — re-exported from
// `./inputBindings` for callers that prefer the single `@types` barrel.
// See that file for the design rationale and per-symbol JSDoc.
// ---------------------------------------------------------------------------

export {
  LOGICAL_ACTIONS,
} from './inputBindings';
export type {
  LogicalAction,
  InputDeviceKind,
  KeyboardBinding,
  GamepadBindingSource,
  GamepadBinding,
  InputBinding,
  PlayerBindingsIndex,
  ActionBindings,
  PlayerBindings,
} from './inputBindings';

// ---------------------------------------------------------------------------
// Canonical M5 binding data model (AC 40001 Sub-AC 1) — re-exported from
// `./bindings`. This is the *dedicated* binding types module the AC
// calls out. The legacy `inputBindings.ts` types above remain exported
// for back-compat with M1-era call sites that already imported them.
// ---------------------------------------------------------------------------

export {
  BINDING_ACTIONS,
  BINDINGS_SCHEMA_VERSION,
  DEFAULT_GAMEPAD_AXIS_THRESHOLD,
  DEFAULT_KEYBOARD_P1_BINDINGS,
  DEFAULT_KEYBOARD_P2_BINDINGS,
  DEFAULT_GAMEPAD_P3_BINDINGS,
  DEFAULT_GAMEPAD_P4_BINDINGS,
  DEFAULT_PLAYER_BINDINGS,
  DEFAULT_PLAYER_PROFILES,
  buildDefaultGamepadBindings,
  getDefaultPlayerBinding,
  getDefaultPlayerProfile,
  toPlayerProfile,
  fromPlayerProfile,
} from './bindings';
export type {
  BindingAction,
  BindingDeviceKind,
  KeyboardBinding as KeyBinding,
  GamepadBinding as GamepadBindingSpec,
  GamepadBindingSource as GamepadBindingSourceSpec,
  InputBinding as BindingInput,
  ActionMap,
  PlayerBinding,
  PlayerBindingIndex,
  PlayerProfile,
  BindingsSchemaVersion,
  BindingsConfig,
} from './bindings';
