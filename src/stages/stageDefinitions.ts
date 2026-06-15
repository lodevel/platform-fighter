/**
 * Built-in stage layout definitions.
 *
 * Each entry is a pure data record conforming to the `StageLayout`
 * shape from `src/types/index.ts`. Keeping the catalog here (away from
 * the renderer) means stage data can be unit-tested under plain Node
 * and reused by the stage builder, replay tooling, and AI navigation
 * mesh generation without pulling Phaser into the import graph.
 *
 * Coordinate system note: x grows right, y grows down (Phaser/Matter
 * convention). All stages are authored against the design resolution
 * from `GAME_CONFIG` (1920×1080) — `StageRenderer` scales bodies and
 * graphics to the live `scale.gameSize` of the active scene.
 */

import type {
  ItemSpawnAnchor,
  MovingPlatformMotion,
  StageHazard,
  StageLayout,
  StagePlatform,
} from '../types';
import { GAME_CONFIG } from '../engine/constants';
import { LAVA_DEFAULTS } from '../entities/LavaHazard';
import { WIND_DEFAULTS } from '../entities/WindZoneHazard';
import { validateStagePlatform } from './platformBehavior';

// ---------------------------------------------------------------------------
// Authoring constants — easy to tweak without hunting through layouts.
// ---------------------------------------------------------------------------

/** Design resolution we author stage coordinates against. */
export const STAGE_DESIGN_WIDTH = GAME_CONFIG.width;
export const STAGE_DESIGN_HEIGHT = GAME_CONFIG.height;

/** How much of the design viewport the blast zone extends past on each side.
 * Smash-Bros-style — fighters can be launched well beyond the visible
 * stage edges before getting KO'd, and the camera dezooms to follow them. */
const BLAST_ZONE_OUTSET = {
  horizontal: 700, // px past left/right edges of the design viewport
  top: 600, // ceiling KO zone above the top edge
  bottom: 500, // pit KO zone below the bottom edge
} as const;

// ---------------------------------------------------------------------------
// Flat (Battlefield-style) stage
// ---------------------------------------------------------------------------

/**
 * Default flat-stage authoring constants. Each one maps to a knob on
 * `createFlatStage` so a stage builder, test, or replay tool can vary
 * the ground dimensions without redefining every other piece of the
 * layout. The defaults reproduce the canonical "flat" stage exactly.
 */
export const FLAT_STAGE_DEFAULTS = {
  /** Stage id for the default flat stage. */
  id: 'flat',
  /** Width of the solid ground platform (design pixels). */
  groundWidth: 1600,
  /** Thickness of the ground platform (design pixels). */
  groundHeight: 80,
  /**
   * How far up from the bottom edge the ground's *centre* sits, in
   * design pixels. Authored as an inset so the ground hugs the bottom
   * of the design viewport regardless of the chosen height.
   */
  groundBottomInset: 110,
  /**
   * Vertical position (design Y) of the side floating platforms'
   * centres. Authored as an inset from the bottom so the side platforms
   * stay a fixed distance above the ground when the viewport scales.
   */
  sidePlatformBottomInset: 360,
  /** Vertical inset for the centre top platform's centre. */
  topPlatformBottomInset: 560,
  /** Width of every pass-through floating platform. */
  floatingPlatformWidth: 380,
  /** Height of every pass-through floating platform. */
  floatingPlatformHeight: 24,
  /** Horizontal offset (design X) of the side platforms from the screen edge. */
  sidePlatformXOffset: 540,
  /** Vertical inset for spawn points (the height fighters drop in from). */
  spawnBottomInset: 320,
  /**
   * How far above a platform's top edge an item-spawn anchor sits, in
   * design pixels. Items spawn a few frames above the surface so they
   * "drop in" naturally (Smash-style item rain) rather than popping
   * into existence flush with the floor. Tuned so a 60-frame fall lands
   * the item on the platform top before a fighter can intercept it
   * mid-air on the spawn frame.
   */
  itemAnchorHoverOffset: 60,
} as const;

export interface FlatStageOptions {
  /** Override the stage id (e.g. 'flat-narrow' for a custom variant). */
  readonly id?: string;
  /** Width of the solid ground platform. */
  readonly groundWidth?: number;
  /** Height/thickness of the solid ground platform. */
  readonly groundHeight?: number;
  /** Distance from the bottom of the design viewport to the ground's centre. */
  readonly groundBottomInset?: number;
  /**
   * If `true`, omit all pass-through floating platforms. Useful for
   * the M3 stage builder's "minimal flat ground" preview and for
   * tests that only care about ground geometry.
   */
  readonly omitFloatingPlatforms?: boolean;
}

/**
 * Build a flat (Battlefield-style) stage layout with configurable
 * ground dimensions. The returned record conforms to `StageLayout` —
 * the same shape `StageRenderer.renderStage` consumes — so the
 * caller can hand it directly to the renderer for static platform
 * sprite/graphics rendering inside a Phaser scene.
 *
 * Defaults reproduce the canonical flat stage exactly; override only
 * the knobs you care about. The blast zone is recomputed from the
 * effective design viewport so it always fully encloses the chosen
 * geometry. Spawn points are spread across the ground and sit
 * `spawnBottomInset` design pixels above the ground top.
 */
export function createFlatStage(options: FlatStageOptions = {}): StageLayout {
  const {
    id = FLAT_STAGE_DEFAULTS.id,
    groundWidth = FLAT_STAGE_DEFAULTS.groundWidth,
    groundHeight = FLAT_STAGE_DEFAULTS.groundHeight,
    groundBottomInset = FLAT_STAGE_DEFAULTS.groundBottomInset,
    omitFloatingPlatforms = false,
  } = options;

  if (groundWidth <= 0 || groundHeight <= 0) {
    throw new Error(
      `createFlatStage: groundWidth/groundHeight must be > 0, ` +
        `got ${groundWidth}×${groundHeight}.`,
    );
  }

  const groundY = STAGE_DESIGN_HEIGHT - groundBottomInset;

  const platforms: StageLayout['platforms'] = [
    // Ground — solid, configurable dimensions, centred horizontally.
    {
      x: STAGE_DESIGN_WIDTH / 2,
      y: groundY,
      width: groundWidth,
      height: groundHeight,
      passThrough: false,
    },
    ...(omitFloatingPlatforms
      ? []
      : [
          // Left floating platform (pass-through).
          {
            x: FLAT_STAGE_DEFAULTS.sidePlatformXOffset,
            y:
              STAGE_DESIGN_HEIGHT -
              FLAT_STAGE_DEFAULTS.sidePlatformBottomInset,
            width: FLAT_STAGE_DEFAULTS.floatingPlatformWidth,
            height: FLAT_STAGE_DEFAULTS.floatingPlatformHeight,
            passThrough: true,
          },
          // Right floating platform (pass-through).
          {
            x: STAGE_DESIGN_WIDTH - FLAT_STAGE_DEFAULTS.sidePlatformXOffset,
            y:
              STAGE_DESIGN_HEIGHT -
              FLAT_STAGE_DEFAULTS.sidePlatformBottomInset,
            width: FLAT_STAGE_DEFAULTS.floatingPlatformWidth,
            height: FLAT_STAGE_DEFAULTS.floatingPlatformHeight,
            passThrough: true,
          },
          // Top centre floating platform (pass-through).
          {
            x: STAGE_DESIGN_WIDTH / 2,
            y:
              STAGE_DESIGN_HEIGHT -
              FLAT_STAGE_DEFAULTS.topPlatformBottomInset,
            width: FLAT_STAGE_DEFAULTS.floatingPlatformWidth,
            height: FLAT_STAGE_DEFAULTS.floatingPlatformHeight,
            passThrough: true,
          },
        ]),
  ];

  const groundTop = groundY - groundHeight / 2;
  // Spawn at a safe height above the ground top — the configured inset
  // is measured from the bottom of the viewport (matching how the
  // ground itself is authored) so the relative drop distance scales
  // intuitively with `groundBottomInset`.
  const spawnY = Math.min(
    STAGE_DESIGN_HEIGHT - FLAT_STAGE_DEFAULTS.spawnBottomInset,
    groundTop - 40,
  );

  // ---- Item spawn anchors --------------------------------------------------
  // T3 / AC 10 Sub-AC 1: declare fixed positions where items may
  // appear during a match. Pure data — the spawn manager (a later
  // sub-AC) reads this list at match start. Anchors hover above each
  // platform's top edge by `itemAnchorHoverOffset` design pixels so the
  // spawned item drops naturally onto the surface ("items rain from
  // above"). The flat stage gets one anchor over the centre of the
  // ground plus one over each floating platform when present, giving
  // 4 candidate positions in the canonical layout — enough variety
  // for a 4-player match where every fighter has a roughly-equal
  // travel distance to the nearest anchor.
  const hover = FLAT_STAGE_DEFAULTS.itemAnchorHoverOffset;
  const itemSpawnAnchors: ItemSpawnAnchor[] = [
    // Centre of the ground platform — the "default" anchor every match
    // sees. Stable id so the replay log can reference it across edits.
    { id: 'flat-ground-centre', x: STAGE_DESIGN_WIDTH / 2, y: groundTop - hover },
  ];
  if (!omitFloatingPlatforms) {
    const sideY =
      STAGE_DESIGN_HEIGHT - FLAT_STAGE_DEFAULTS.sidePlatformBottomInset;
    const sideTop = sideY - FLAT_STAGE_DEFAULTS.floatingPlatformHeight / 2;
    const topY =
      STAGE_DESIGN_HEIGHT - FLAT_STAGE_DEFAULTS.topPlatformBottomInset;
    const topTop = topY - FLAT_STAGE_DEFAULTS.floatingPlatformHeight / 2;
    itemSpawnAnchors.push(
      {
        id: 'flat-platform-left',
        x: FLAT_STAGE_DEFAULTS.sidePlatformXOffset,
        y: sideTop - hover,
      },
      {
        id: 'flat-platform-right',
        x: STAGE_DESIGN_WIDTH - FLAT_STAGE_DEFAULTS.sidePlatformXOffset,
        y: sideTop - hover,
      },
      {
        id: 'flat-platform-top',
        x: STAGE_DESIGN_WIDTH / 2,
        y: topTop - hover,
      },
    );
  }

  return {
    id,
    platforms,
    hazards: [], // Flat stage is the safe default — hazards land on later stages.
    // Neutral dark parallax backdrop — visually closest to the M1-era
    // flat clear colour. See `backgroundThemes.ts` for the registry.
    backgroundTheme: 'midnight',
    blastZone: {
      left: -BLAST_ZONE_OUTSET.horizontal,
      right: STAGE_DESIGN_WIDTH + BLAST_ZONE_OUTSET.horizontal,
      top: -BLAST_ZONE_OUTSET.top,
      bottom: STAGE_DESIGN_HEIGHT + BLAST_ZONE_OUTSET.bottom,
    },
    spawnPoints: [
      { x: STAGE_DESIGN_WIDTH * 0.25, y: spawnY },
      { x: STAGE_DESIGN_WIDTH * 0.4, y: spawnY },
      { x: STAGE_DESIGN_WIDTH * 0.6, y: spawnY },
      { x: STAGE_DESIGN_WIDTH * 0.75, y: spawnY },
    ],
    itemSpawnAnchors,
  };
}

/**
 * Canonical "flat" stage — one wide ground platform plus three smaller
 * pass-through floating platforms. Roughly mirrors Smash Bros'
 * Battlefield layout: two side platforms at mid-height and one centre
 * platform a bit higher.
 *
 * The four spawn points are arranged across the ground so up to four
 * players can drop in without overlapping. Built via `createFlatStage`
 * with default dimensions so a caller can opt into a custom variant
 * (different ground width/height, no floating platforms, etc.) without
 * having to redefine the entire layout.
 */
export const FLAT_STAGE: StageLayout = createFlatStage();

// ---------------------------------------------------------------------------
// Lava (hazard) stage
// ---------------------------------------------------------------------------

/**
 * Default authoring constants for the canonical lava hazard stage —
 * Sub-AC 3 of AC 9.
 *
 * Stage shape: a narrower-than-flat ground platform centred over a pit,
 * two side floating platforms, and a top centre platform. Two lava
 * pools sit in the side pits (one on each side of the ground). The
 * pools are configured to oscillate **out of phase by half a cycle**
 * so the stage always offers a safe escape route — a fighter knocked
 * off one side can recover via the platforms while that side's lava
 * is rising, then drop back down once it's receded.
 *
 * Every constant on this object is a knob `createLavaStage` exposes,
 * so the stage builder UI / balance docs / a future modder can tune
 * lava timing without forking the layout.
 */
export const LAVA_STAGE_DEFAULTS = {
  /** Stage id for the default lava hazard stage. */
  id: 'lava',
  // ---- Ground geometry --------------------------------------------------
  /** Width of the central solid ground platform. Narrower than flat so the pit is visible on both sides. */
  groundWidth: 1180,
  /** Height/thickness of the ground. */
  groundHeight: 80,
  /** Distance from the bottom of the design viewport to the ground's centre. */
  groundBottomInset: 240,
  // ---- Floating platforms ---------------------------------------------
  /** Width of every pass-through floating platform. */
  floatingPlatformWidth: 320,
  /** Height of every pass-through floating platform. */
  floatingPlatformHeight: 22,
  /** X offset of each side platform from its respective screen edge. */
  sidePlatformXOffset: 480,
  /** Vertical inset of side platforms' centres from the bottom. */
  sidePlatformBottomInset: 480,
  /** Vertical inset of the top centre platform. */
  topPlatformBottomInset: 660,
  // ---- Lava pool tuning ------------------------------------------------
  /** Width of each lava pool (in design pixels). */
  lavaPoolWidth: 360,
  /**
   * Maximum apex height of the lava in design pixels. Tuned so the
   * pool's apex surface sits just above the ground top — enough to
   * threaten a fighter who has been knocked off the side platforms.
   */
  lavaMaxHeight: 240,
  /** Minimum (resting) height — lava fully recedes by default. */
  lavaMinHeight: 0,
  /** Total cycle length in fixed frames (one full rise + fall). Default 480 ≈ 8 s @ 60 Hz. */
  lavaCycleFrames: 480,
  /**
   * Phase offset between the left and right pools in *fractions of
   * the cycle*. `0.5` means the right pool is exactly half a cycle
   * behind the left — when one is at apex, the other is at trough.
   */
  lavaPhaseOffsetFraction: 0.5,
  /** Damage % per active-tick while overlapping the lava body. */
  lavaDamagePerTick: LAVA_DEFAULTS.damagePerTick,
  /** Cycle-fraction above which the lava is active (lethal). */
  lavaActiveThreshold: LAVA_DEFAULTS.activeThreshold,
  /** Vertical inset for spawn points (the height fighters drop in from). */
  spawnBottomInset: 460,
  /**
   * Hover offset above a platform's top edge for item-spawn anchors,
   * in design pixels. See `FLAT_STAGE_DEFAULTS.itemAnchorHoverOffset`
   * for the full rationale — kept per-stage so a future hazard stage
   * with different geometry can dial it independently.
   */
  itemAnchorHoverOffset: 60,
} as const;

/**
 * Construction options for {@link createLavaStage}. Every field maps to
 * a single knob in {@link LAVA_STAGE_DEFAULTS}; pass only what you
 * want to override. The defaults reproduce the canonical lava stage
 * exactly, so the registered `LAVA_STAGE` constant is just
 * `createLavaStage()`.
 */
export interface LavaStageOptions {
  /** Override the stage id. */
  readonly id?: string;
  /** Width of the solid ground platform. */
  readonly groundWidth?: number;
  /** Height of the solid ground platform. */
  readonly groundHeight?: number;
  /** Distance from the bottom of the viewport to the ground's centre. */
  readonly groundBottomInset?: number;
  /** Override the width of each lava pool. */
  readonly lavaPoolWidth?: number;
  /** Override the maximum (apex) lava height in design pixels. */
  readonly lavaMaxHeight?: number;
  /** Override the resting (minimum) lava height. */
  readonly lavaMinHeight?: number;
  /** Override the cycle length in frames. */
  readonly lavaCycleFrames?: number;
  /**
   * Phase offset between the two pools in cycle fractions (0..1).
   * `0.5` (default) = one pool is at trough when the other is at
   * apex, giving the stage one always-safe side.
   */
  readonly lavaPhaseOffsetFraction?: number;
  /** Override damage % per active overlap tick. */
  readonly lavaDamagePerTick?: number;
  /** Override the active-threshold cycle fraction (0..1). */
  readonly lavaActiveThreshold?: number;
  /** Skip floating platforms (useful for tests / preview). */
  readonly omitFloatingPlatforms?: boolean;
  /**
   * Skip the lava hazards entirely — leaves you with the bare
   * platform geometry. Useful for the stage builder's "lava off"
   * preview and for unit tests that exercise the layout shape
   * without instantiating the hazard.
   */
  readonly omitLavaHazards?: boolean;
}

/**
 * Build a lava hazard stage layout — Sub-AC 3 of AC 9. Returns a
 * `StageLayout` conforming to the same shape `StageRenderer.renderStage`
 * consumes, so the caller can hand it directly to the renderer for
 * platform geometry + blast-zone walls. The lava-specific Matter sensor
 * bodies + animated visuals are produced by the dedicated
 * `LavaHazardRenderer.renderLavaHazards()` helper, which reads from
 * `layout.hazards`.
 *
 * Defaults reproduce the canonical lava stage exactly; override only
 * the knobs you care about. Every timing parameter (cycle length,
 * phase offset, threshold, damage) is wired through to the resulting
 * `StageHazard` records so a stage-builder export round-trips without
 * loss.
 */
export function createLavaStage(options: LavaStageOptions = {}): StageLayout {
  const {
    id = LAVA_STAGE_DEFAULTS.id,
    groundWidth = LAVA_STAGE_DEFAULTS.groundWidth,
    groundHeight = LAVA_STAGE_DEFAULTS.groundHeight,
    groundBottomInset = LAVA_STAGE_DEFAULTS.groundBottomInset,
    lavaPoolWidth = LAVA_STAGE_DEFAULTS.lavaPoolWidth,
    lavaMaxHeight = LAVA_STAGE_DEFAULTS.lavaMaxHeight,
    lavaMinHeight = LAVA_STAGE_DEFAULTS.lavaMinHeight,
    lavaCycleFrames = LAVA_STAGE_DEFAULTS.lavaCycleFrames,
    lavaPhaseOffsetFraction = LAVA_STAGE_DEFAULTS.lavaPhaseOffsetFraction,
    lavaDamagePerTick = LAVA_STAGE_DEFAULTS.lavaDamagePerTick,
    lavaActiveThreshold = LAVA_STAGE_DEFAULTS.lavaActiveThreshold,
    omitFloatingPlatforms = false,
    omitLavaHazards = false,
  } = options;

  if (groundWidth <= 0 || groundHeight <= 0) {
    throw new Error(
      `createLavaStage: groundWidth/groundHeight must be > 0, ` +
        `got ${groundWidth}×${groundHeight}.`,
    );
  }
  if (lavaPoolWidth <= 0 || lavaMaxHeight <= 0) {
    throw new Error(
      `createLavaStage: lavaPoolWidth/lavaMaxHeight must be > 0, ` +
        `got ${lavaPoolWidth}×${lavaMaxHeight}.`,
    );
  }
  if (!Number.isInteger(lavaCycleFrames) || lavaCycleFrames < 2) {
    throw new Error(
      `createLavaStage: lavaCycleFrames must be an integer >= 2, got ${lavaCycleFrames}.`,
    );
  }
  if (lavaPhaseOffsetFraction < 0 || lavaPhaseOffsetFraction >= 1) {
    throw new Error(
      `createLavaStage: lavaPhaseOffsetFraction must be in [0, 1), got ${lavaPhaseOffsetFraction}.`,
    );
  }
  if (lavaActiveThreshold < 0 || lavaActiveThreshold > 1) {
    throw new Error(
      `createLavaStage: lavaActiveThreshold must be in [0, 1], got ${lavaActiveThreshold}.`,
    );
  }
  if (lavaDamagePerTick < 0 || !Number.isFinite(lavaDamagePerTick)) {
    throw new Error(
      `createLavaStage: lavaDamagePerTick must be finite and non-negative, got ${lavaDamagePerTick}.`,
    );
  }
  if (lavaMinHeight < 0 || lavaMinHeight >= lavaMaxHeight) {
    throw new Error(
      `createLavaStage: lavaMinHeight (${lavaMinHeight}) must be in [0, lavaMaxHeight) (${lavaMaxHeight}).`,
    );
  }

  const groundY = STAGE_DESIGN_HEIGHT - groundBottomInset;

  // Sub-AC 2 of AC 90302: every platform declares its `behavior`
  // explicitly so the new schema (introduced in Sub-AC 1 of AC 90301)
  // is the single source of truth here. The legacy `passThrough` flag
  // stays in lock-step with the new `behavior` so the renderer / replay
  // / AI navigation code paths that still read `passThrough` keep
  // working unchanged.
  const platforms: StageLayout['platforms'] = [
    // Central solid ground platform.
    {
      x: STAGE_DESIGN_WIDTH / 2,
      y: groundY,
      width: groundWidth,
      height: groundHeight,
      passThrough: false,
      behavior: 'solid',
      id: 'lava-ground',
    },
    ...(omitFloatingPlatforms
      ? []
      : [
          // Left side floating platform (pass-through).
          {
            x: LAVA_STAGE_DEFAULTS.sidePlatformXOffset,
            y:
              STAGE_DESIGN_HEIGHT -
              LAVA_STAGE_DEFAULTS.sidePlatformBottomInset,
            width: LAVA_STAGE_DEFAULTS.floatingPlatformWidth,
            height: LAVA_STAGE_DEFAULTS.floatingPlatformHeight,
            passThrough: true,
            behavior: 'pass-through' as const,
            id: 'lava-platform-left',
          },
          // Right side floating platform (pass-through).
          {
            x:
              STAGE_DESIGN_WIDTH -
              LAVA_STAGE_DEFAULTS.sidePlatformXOffset,
            y:
              STAGE_DESIGN_HEIGHT -
              LAVA_STAGE_DEFAULTS.sidePlatformBottomInset,
            width: LAVA_STAGE_DEFAULTS.floatingPlatformWidth,
            height: LAVA_STAGE_DEFAULTS.floatingPlatformHeight,
            passThrough: true,
            behavior: 'pass-through' as const,
            id: 'lava-platform-right',
          },
          // Top centre floating platform (pass-through).
          {
            x: STAGE_DESIGN_WIDTH / 2,
            y:
              STAGE_DESIGN_HEIGHT -
              LAVA_STAGE_DEFAULTS.topPlatformBottomInset,
            width: LAVA_STAGE_DEFAULTS.floatingPlatformWidth,
            height: LAVA_STAGE_DEFAULTS.floatingPlatformHeight,
            passThrough: true,
            behavior: 'pass-through' as const,
            id: 'lava-platform-top',
          },
        ]),
  ];

  // ---- Lava pool placement ---------------------------------------------
  // Two pools live in the *side pits* — i.e. the space between the
  // stage's edge and the ground platform's edge. Each pool's centre X
  // sits halfway between the side blast zone and the ground edge so
  // the pool fully fills the pit. The pools' baseY hugs the bottom of
  // the design viewport so the lava rises *up* from the floor.
  //
  // Phase offset: the second (right) pool is offset by
  // `lavaPhaseOffsetFraction * cycleFrames`. With the default `0.5`
  // the right pool is at trough while the left pool is at apex, and
  // vice versa — so a fighter knocked off either side has a
  // predictable safe window.
  const groundLeft = STAGE_DESIGN_WIDTH / 2 - groundWidth / 2;
  const groundRight = STAGE_DESIGN_WIDTH / 2 + groundWidth / 2;
  const leftPitCenterX = groundLeft / 2;
  const rightPitCenterX = (groundRight + STAGE_DESIGN_WIDTH) / 2;
  const lavaBaseY = STAGE_DESIGN_HEIGHT;
  const phaseFramesRight = Math.round(
    lavaPhaseOffsetFraction * lavaCycleFrames,
  );

  const hazards: StageHazard[] = omitLavaHazards
    ? []
    : [
        {
          type: 'lava',
          id: 'lava-left',
          x: leftPitCenterX,
          y: lavaBaseY,
          width: lavaPoolWidth,
          height: lavaMaxHeight,
          minHeight: lavaMinHeight,
          cycleFrames: lavaCycleFrames,
          phaseFrames: 0,
          damagePerTick: lavaDamagePerTick,
          activeThreshold: lavaActiveThreshold,
        },
        {
          type: 'lava',
          id: 'lava-right',
          x: rightPitCenterX,
          y: lavaBaseY,
          width: lavaPoolWidth,
          height: lavaMaxHeight,
          minHeight: lavaMinHeight,
          cycleFrames: lavaCycleFrames,
          phaseFrames: phaseFramesRight,
          damagePerTick: lavaDamagePerTick,
          activeThreshold: lavaActiveThreshold,
        },
      ];

  const groundTop = groundY - groundHeight / 2;
  const spawnY = Math.min(
    STAGE_DESIGN_HEIGHT - LAVA_STAGE_DEFAULTS.spawnBottomInset,
    groundTop - 40,
  );

  // ---- Item spawn anchors --------------------------------------------------
  // T3 / AC 10 Sub-AC 1: declare item spawn anchors. We deliberately
  // place every anchor over a *platform* rather than over a side pit —
  // an item spawned over the lava would be lost the instant the pool
  // rose, defeating the "items rain in, fighters scramble for them"
  // pacing the seed wants. The four positions (centre ground + two
  // side floats + top centre float) match the platform layout 1-to-1
  // and hover above each surface so the item drops onto it.
  const lavaHover = LAVA_STAGE_DEFAULTS.itemAnchorHoverOffset;
  const lavaItemAnchors: ItemSpawnAnchor[] = [
    { id: 'lava-ground-centre', x: STAGE_DESIGN_WIDTH / 2, y: groundTop - lavaHover },
  ];
  if (!omitFloatingPlatforms) {
    const sideY =
      STAGE_DESIGN_HEIGHT - LAVA_STAGE_DEFAULTS.sidePlatformBottomInset;
    const sideTop = sideY - LAVA_STAGE_DEFAULTS.floatingPlatformHeight / 2;
    const topY =
      STAGE_DESIGN_HEIGHT - LAVA_STAGE_DEFAULTS.topPlatformBottomInset;
    const topTop = topY - LAVA_STAGE_DEFAULTS.floatingPlatformHeight / 2;
    lavaItemAnchors.push(
      {
        id: 'lava-platform-left',
        x: LAVA_STAGE_DEFAULTS.sidePlatformXOffset,
        y: sideTop - lavaHover,
      },
      {
        id: 'lava-platform-right',
        x: STAGE_DESIGN_WIDTH - LAVA_STAGE_DEFAULTS.sidePlatformXOffset,
        y: sideTop - lavaHover,
      },
      {
        id: 'lava-platform-top',
        x: STAGE_DESIGN_WIDTH / 2,
        y: topTop - lavaHover,
      },
    );
  }

  return {
    id,
    platforms,
    hazards,
    // Warm red/orange cavern backdrop with a pulsing molten glow —
    // matches the lava pools' palette. See `backgroundThemes.ts`.
    backgroundTheme: 'lava-cavern',
    blastZone: {
      left: -BLAST_ZONE_OUTSET.horizontal,
      right: STAGE_DESIGN_WIDTH + BLAST_ZONE_OUTSET.horizontal,
      top: -BLAST_ZONE_OUTSET.top,
      bottom: STAGE_DESIGN_HEIGHT + BLAST_ZONE_OUTSET.bottom,
    },
    spawnPoints: [
      // Spawn points across the central ground platform — fighters
      // start safely above the lava with a window before the first
      // pool reaches apex (~half a cycle = ~4 s).
      { x: STAGE_DESIGN_WIDTH * 0.32, y: spawnY },
      { x: STAGE_DESIGN_WIDTH * 0.42, y: spawnY },
      { x: STAGE_DESIGN_WIDTH * 0.58, y: spawnY },
      { x: STAGE_DESIGN_WIDTH * 0.68, y: spawnY },
    ],
    itemSpawnAnchors: lavaItemAnchors,
  };
}

/**
 * Canonical lava hazard stage — Sub-AC 3 of AC 9. Built via
 * `createLavaStage()` with all defaults so a caller can opt into a
 * custom variant (slower lava, no phase offset, single pool, etc.)
 * without redefining the entire layout.
 */
export const LAVA_STAGE: StageLayout = createLavaStage();

// ---------------------------------------------------------------------------
// Wind (hazard) stage — Sub-AC 2 of AC 90302
// ---------------------------------------------------------------------------

/**
 * Default authoring constants for the canonical wind hazard stage.
 *
 * Stage shape: a wide central solid ground platform (Battlefield-ish)
 * with two side pass-through platforms and one top centre platform.
 * A single horizontal wind zone hazard sweeps across the upper half
 * of the stage, pushing airborne fighters towards one blast zone —
 * recovery requires reading the wind cycle and either jumping with
 * the gust or sheltering behind the central ground platform when the
 * gust reverses. Two opposite-direction wind cycles run out of phase
 * so the stage always offers a tactically meaningful airborne window.
 *
 * Every constant is a knob exposed by {@link createWindStage} so the
 * stage builder UI / balance docs / replay tooling can tune wind
 * timing without forking the layout. Sub-AC 2 of AC 90302: every
 * platform on this stage carries an explicit `behavior` field so the
 * new schema is the single source of truth for static-vs-pass-through
 * collision dispatch.
 */
export const WIND_STAGE_DEFAULTS = {
  /** Stage id for the default wind hazard stage. */
  id: 'wind',
  // ---- Ground geometry --------------------------------------------------
  /** Width of the central solid ground platform. */
  groundWidth: 1500,
  /** Height/thickness of the ground platform. */
  groundHeight: 80,
  /** Distance from the bottom of the design viewport to the ground's centre. */
  groundBottomInset: 180,
  // ---- Floating platforms ---------------------------------------------
  /** Width of every pass-through floating platform. */
  floatingPlatformWidth: 360,
  /** Height of every pass-through floating platform. */
  floatingPlatformHeight: 24,
  /** X offset of each side platform from its respective screen edge. */
  sidePlatformXOffset: 540,
  /** Vertical inset of side platforms' centres from the bottom. */
  sidePlatformBottomInset: 420,
  /** Vertical inset of the top centre platform. */
  topPlatformBottomInset: 620,
  // ---- Wind zone tuning -----------------------------------------------
  /** Width of each wind zone (design pixels). Roughly the airborne corridor. */
  windZoneWidth: 1600,
  /** Height of each wind zone (design pixels). */
  windZoneHeight: 320,
  /** Vertical inset of the wind zone's centre from the bottom. */
  windZoneBottomInset: 540,
  /** Total cycle length in fixed frames (one full gust). Default 360 ≈ 6 s @ 60 Hz. */
  windCycleFrames: 360,
  /** Phase offset between the left- and right-blowing gusts. */
  windPhaseOffsetFraction: 0.5,
  /**
   * Peak horizontal force magnitude (px/frame²) applied at gust apex
   * to fighters overlapping the zone. Sign carries direction — the
   * `wind-leftward` zone uses `-windPeakForceX` (blows toward -X), the
   * `wind-rightward` zone uses `+windPeakForceX` (blows toward +X).
   * Pulled from {@link WIND_DEFAULTS.peakForceX} so the canonical
   * stage and any custom-stage variants share one tuning surface.
   */
  windPeakForceX: WIND_DEFAULTS.peakForceX,
  /**
   * Cycle-fraction (0..1) above which the gust is "active" and the
   * controller applies force. Pulled from
   * {@link WIND_DEFAULTS.activeThreshold}.
   */
  windActiveThreshold: WIND_DEFAULTS.activeThreshold,
  /** Vertical inset for spawn points. */
  spawnBottomInset: 320,
  /**
   * Hover offset for item-spawn anchors above each platform's top
   * edge. See `FLAT_STAGE_DEFAULTS.itemAnchorHoverOffset`.
   */
  itemAnchorHoverOffset: 60,
} as const;

export interface WindStageOptions {
  readonly id?: string;
  readonly groundWidth?: number;
  readonly groundHeight?: number;
  readonly groundBottomInset?: number;
  readonly windCycleFrames?: number;
  readonly windPhaseOffsetFraction?: number;
  /**
   * Override the peak horizontal force magnitude (px/frame²). Sign is
   * always derived per-zone — `wind-leftward` uses `-peak`,
   * `wind-rightward` uses `+peak`.
   */
  readonly windPeakForceX?: number;
  /**
   * Override the active-threshold cycle fraction (0..1).
   */
  readonly windActiveThreshold?: number;
  readonly omitFloatingPlatforms?: boolean;
  readonly omitWindHazards?: boolean;
}

/**
 * Build a wind hazard stage layout. Returned record conforms to
 * `StageLayout`. Sub-AC 2 of AC 90302: every platform declares an
 * explicit `behavior` ('solid' | 'pass-through') so the renderer and
 * replay tooling read the canonical schema rather than just the
 * legacy `passThrough` boolean.
 */
export function createWindStage(options: WindStageOptions = {}): StageLayout {
  const {
    id = WIND_STAGE_DEFAULTS.id,
    groundWidth = WIND_STAGE_DEFAULTS.groundWidth,
    groundHeight = WIND_STAGE_DEFAULTS.groundHeight,
    groundBottomInset = WIND_STAGE_DEFAULTS.groundBottomInset,
    windCycleFrames = WIND_STAGE_DEFAULTS.windCycleFrames,
    windPhaseOffsetFraction = WIND_STAGE_DEFAULTS.windPhaseOffsetFraction,
    windPeakForceX = WIND_STAGE_DEFAULTS.windPeakForceX,
    windActiveThreshold = WIND_STAGE_DEFAULTS.windActiveThreshold,
    omitFloatingPlatforms = false,
    omitWindHazards = false,
  } = options;

  if (groundWidth <= 0 || groundHeight <= 0) {
    throw new Error(
      `createWindStage: groundWidth/groundHeight must be > 0, ` +
        `got ${groundWidth}×${groundHeight}.`,
    );
  }
  if (!Number.isInteger(windCycleFrames) || windCycleFrames < 2) {
    throw new Error(
      `createWindStage: windCycleFrames must be an integer >= 2, got ${windCycleFrames}.`,
    );
  }
  if (windPhaseOffsetFraction < 0 || windPhaseOffsetFraction >= 1) {
    throw new Error(
      `createWindStage: windPhaseOffsetFraction must be in [0, 1), got ${windPhaseOffsetFraction}.`,
    );
  }
  if (!Number.isFinite(windPeakForceX) || windPeakForceX < 0) {
    throw new Error(
      `createWindStage: windPeakForceX must be a finite, non-negative number (got ${windPeakForceX}).`,
    );
  }
  if (
    !Number.isFinite(windActiveThreshold) ||
    windActiveThreshold < 0 ||
    windActiveThreshold > 1
  ) {
    throw new Error(
      `createWindStage: windActiveThreshold must be in [0, 1], got ${windActiveThreshold}.`,
    );
  }

  const groundY = STAGE_DESIGN_HEIGHT - groundBottomInset;

  const platforms: StagePlatform[] = [
    // Central solid ground platform — explicit 'solid' behavior.
    {
      x: STAGE_DESIGN_WIDTH / 2,
      y: groundY,
      width: groundWidth,
      height: groundHeight,
      passThrough: false,
      behavior: 'solid',
      id: 'wind-ground',
    },
    ...(omitFloatingPlatforms
      ? []
      : [
          // Left side floating platform — explicit 'pass-through' behavior.
          {
            x: WIND_STAGE_DEFAULTS.sidePlatformXOffset,
            y:
              STAGE_DESIGN_HEIGHT -
              WIND_STAGE_DEFAULTS.sidePlatformBottomInset,
            width: WIND_STAGE_DEFAULTS.floatingPlatformWidth,
            height: WIND_STAGE_DEFAULTS.floatingPlatformHeight,
            passThrough: true,
            behavior: 'pass-through' as const,
            id: 'wind-platform-left',
          },
          // Right side floating platform — explicit 'pass-through' behavior.
          {
            x:
              STAGE_DESIGN_WIDTH -
              WIND_STAGE_DEFAULTS.sidePlatformXOffset,
            y:
              STAGE_DESIGN_HEIGHT -
              WIND_STAGE_DEFAULTS.sidePlatformBottomInset,
            width: WIND_STAGE_DEFAULTS.floatingPlatformWidth,
            height: WIND_STAGE_DEFAULTS.floatingPlatformHeight,
            passThrough: true,
            behavior: 'pass-through' as const,
            id: 'wind-platform-right',
          },
          // Top centre floating platform — explicit 'pass-through' behavior.
          {
            x: STAGE_DESIGN_WIDTH / 2,
            y:
              STAGE_DESIGN_HEIGHT -
              WIND_STAGE_DEFAULTS.topPlatformBottomInset,
            width: WIND_STAGE_DEFAULTS.floatingPlatformWidth,
            height: WIND_STAGE_DEFAULTS.floatingPlatformHeight,
            passThrough: true,
            behavior: 'pass-through' as const,
            id: 'wind-platform-top',
          },
        ]),
  ];

  // Two opposed wind zones, half a cycle out of phase — when one is
  // pushing right at apex, the other is at trough, so airborne
  // fighters always have one survivable direction.
  const windY =
    STAGE_DESIGN_HEIGHT - WIND_STAGE_DEFAULTS.windZoneBottomInset;
  const phaseFramesRight = Math.round(
    windPhaseOffsetFraction * windCycleFrames,
  );
  // The two zones share the same `forceX` sign; the half-cycle phase
  // offset is what makes them push in **opposite directions** at the
  // same moment. A worked example (peakForceX = -P, cycle = 360):
  //
  //   wind-leftward  (phase = 0):
  //     frame   0: cos = +1 → force = -P   (LEFT)
  //     frame 180: cos = -1 → force = +P   (RIGHT)
  //
  //   wind-rightward (phase = 180):
  //     frame   0: cos = -1 → force = +P   (RIGHT)
  //     frame 180: cos = +1 → force = -P   (LEFT)
  //
  // At every frame either both zones are quiet (cosine ~ 0 around
  // ¼- and ¾-cycle) or they're pushing in *opposite* directions —
  // the always-safe-side property the seed leans on for recoverability.
  // The id encodes which zone is leftward at frame-0 apex.
  const hazards: StageHazard[] = omitWindHazards
    ? []
    : [
        {
          type: 'wind',
          id: 'wind-leftward',
          x: STAGE_DESIGN_WIDTH / 2,
          y: windY,
          width: WIND_STAGE_DEFAULTS.windZoneWidth,
          height: WIND_STAGE_DEFAULTS.windZoneHeight,
          cycleFrames: windCycleFrames,
          phaseFrames: 0,
          forceX: -windPeakForceX,
          forceY: 0,
          activeThreshold: windActiveThreshold,
        },
        {
          type: 'wind',
          id: 'wind-rightward',
          x: STAGE_DESIGN_WIDTH / 2,
          y: windY,
          width: WIND_STAGE_DEFAULTS.windZoneWidth,
          height: WIND_STAGE_DEFAULTS.windZoneHeight,
          cycleFrames: windCycleFrames,
          phaseFrames: phaseFramesRight,
          // Same sign as the leftward zone. The half-cycle phase shift
          // does the work of giving the two zones opposite directions
          // at every active frame.
          forceX: -windPeakForceX,
          forceY: 0,
          activeThreshold: windActiveThreshold,
        },
      ];

  const groundTop = groundY - groundHeight / 2;
  const spawnY = Math.min(
    STAGE_DESIGN_HEIGHT - WIND_STAGE_DEFAULTS.spawnBottomInset,
    groundTop - 40,
  );

  // ---- Item spawn anchors --------------------------------------------------
  // T3 / AC 10 Sub-AC 1. Wind stage anchors hug the platform tops so
  // the items don't get blown across the stage on the spawn frame —
  // the wind's force is applied to overlapping bodies, not to items
  // sitting on a static platform. Same four-position layout as the
  // lava stage (centre ground + two side floats + top centre float).
  const windHover = WIND_STAGE_DEFAULTS.itemAnchorHoverOffset;
  const windItemAnchors: ItemSpawnAnchor[] = [
    { id: 'wind-ground-centre', x: STAGE_DESIGN_WIDTH / 2, y: groundTop - windHover },
  ];
  if (!omitFloatingPlatforms) {
    const sideY =
      STAGE_DESIGN_HEIGHT - WIND_STAGE_DEFAULTS.sidePlatformBottomInset;
    const sideTop = sideY - WIND_STAGE_DEFAULTS.floatingPlatformHeight / 2;
    const topYWind =
      STAGE_DESIGN_HEIGHT - WIND_STAGE_DEFAULTS.topPlatformBottomInset;
    const topTopWind = topYWind - WIND_STAGE_DEFAULTS.floatingPlatformHeight / 2;
    windItemAnchors.push(
      {
        id: 'wind-platform-left',
        x: WIND_STAGE_DEFAULTS.sidePlatformXOffset,
        y: sideTop - windHover,
      },
      {
        id: 'wind-platform-right',
        x: STAGE_DESIGN_WIDTH - WIND_STAGE_DEFAULTS.sidePlatformXOffset,
        y: sideTop - windHover,
      },
      {
        id: 'wind-platform-top',
        x: STAGE_DESIGN_WIDTH / 2,
        y: topTopWind - windHover,
      },
    );
  }

  return {
    id,
    platforms,
    hazards,
    // Cool blue/teal canyon backdrop with drifting haze — matches the
    // wind gust visuals. See `backgroundThemes.ts`.
    backgroundTheme: 'wind-canyon',
    blastZone: {
      left: -BLAST_ZONE_OUTSET.horizontal,
      right: STAGE_DESIGN_WIDTH + BLAST_ZONE_OUTSET.horizontal,
      top: -BLAST_ZONE_OUTSET.top,
      bottom: STAGE_DESIGN_HEIGHT + BLAST_ZONE_OUTSET.bottom,
    },
    spawnPoints: [
      { x: STAGE_DESIGN_WIDTH * 0.25, y: spawnY },
      { x: STAGE_DESIGN_WIDTH * 0.4, y: spawnY },
      { x: STAGE_DESIGN_WIDTH * 0.6, y: spawnY },
      { x: STAGE_DESIGN_WIDTH * 0.75, y: spawnY },
    ],
    itemSpawnAnchors: windItemAnchors,
  };
}

/**
 * Canonical wind hazard stage — Sub-AC 2 of AC 90302. Platforms use
 * the new explicit `behavior` schema.
 */
export const WIND_STAGE: StageLayout = createWindStage();

// ---------------------------------------------------------------------------
// Crumbling-platform (hazard) stage — Sub-AC 2 of AC 90302
// ---------------------------------------------------------------------------

/**
 * Default authoring constants for the canonical crumbling-platform
 * stage.
 *
 * Stage shape: a slim solid central ground platform plus four
 * pass-through floating platforms positioned to encourage hopping
 * across them — except the floats are *crumbling*: they drop out
 * after a fighter steps on them (timer-based, via
 * {@link CrumblingPlatform} runtime entity at match start). The
 * stage definition itself just declares them as `behavior: 'solid'`
 * platforms with stable IDs; the runtime layer attaches a
 * `CrumblingPlatform` entity per ID and toggles their collision
 * bodies as the lifecycle ticks.
 *
 * Sub-AC 2 of AC 90302: every platform on this stage declares an
 * explicit `behavior` field so the new schema is the single source
 * of truth for collision dispatch.
 */
export const CRUMBLING_STAGE_DEFAULTS = {
  /** Stage id for the default crumbling stage. */
  id: 'crumbling',
  // ---- Central anchor ---------------------------------------------------
  /** Width of the central solid ground platform. Narrow — the floats are the point. */
  groundWidth: 700,
  /** Height/thickness of the ground platform. */
  groundHeight: 60,
  /** Distance from the bottom of the design viewport to the ground's centre. */
  groundBottomInset: 200,
  // ---- Crumbling floats ------------------------------------------------
  /** Width of every crumbling float. */
  floatWidth: 280,
  /** Height of every crumbling float. */
  floatHeight: 22,
  /** Vertical inset of the lower row of crumbling floats. */
  lowerRowBottomInset: 420,
  /** Vertical inset of the upper row of crumbling floats. */
  upperRowBottomInset: 620,
  /** Horizontal offset of each float from the screen centre. */
  floatXOffsetSmall: 360,
  /** Horizontal offset of the outer floats. */
  floatXOffsetLarge: 720,
  /** Vertical inset for spawn points. */
  spawnBottomInset: 320,
  /**
   * Hover offset for item-spawn anchors above each platform's top
   * edge. See `FLAT_STAGE_DEFAULTS.itemAnchorHoverOffset`.
   */
  itemAnchorHoverOffset: 60,
} as const;

export interface CrumblingStageOptions {
  readonly id?: string;
  readonly groundWidth?: number;
  readonly groundHeight?: number;
  readonly groundBottomInset?: number;
  readonly omitCrumblingFloats?: boolean;
}

/**
 * Build a crumbling-platform stage layout. Sub-AC 2 of AC 90302:
 * every platform declares an explicit `behavior`. The crumbling
 * floats keep `behavior: 'pass-through'` (they are drop-through
 * floating platforms first, and *crumbling* second — the runtime
 * lifecycle attaches a {@link CrumblingPlatform} entity per platform
 * ID and toggles collision when the platform falls).
 */
export function createCrumblingStage(
  options: CrumblingStageOptions = {},
): StageLayout {
  const {
    id = CRUMBLING_STAGE_DEFAULTS.id,
    groundWidth = CRUMBLING_STAGE_DEFAULTS.groundWidth,
    groundHeight = CRUMBLING_STAGE_DEFAULTS.groundHeight,
    groundBottomInset = CRUMBLING_STAGE_DEFAULTS.groundBottomInset,
    omitCrumblingFloats = false,
  } = options;

  if (groundWidth <= 0 || groundHeight <= 0) {
    throw new Error(
      `createCrumblingStage: groundWidth/groundHeight must be > 0, ` +
        `got ${groundWidth}×${groundHeight}.`,
    );
  }

  const groundY = STAGE_DESIGN_HEIGHT - groundBottomInset;
  const lowerY =
    STAGE_DESIGN_HEIGHT - CRUMBLING_STAGE_DEFAULTS.lowerRowBottomInset;
  const upperY =
    STAGE_DESIGN_HEIGHT - CRUMBLING_STAGE_DEFAULTS.upperRowBottomInset;
  const cx = STAGE_DESIGN_WIDTH / 2;

  const platforms: StagePlatform[] = [
    // Central solid anchor. Behavior = 'solid'.
    {
      x: cx,
      y: groundY,
      width: groundWidth,
      height: groundHeight,
      passThrough: false,
      behavior: 'solid',
      id: 'crumble-ground',
    },
    ...(omitCrumblingFloats
      ? []
      : [
          // Lower row — two floats flanking the ground.
          {
            x: cx - CRUMBLING_STAGE_DEFAULTS.floatXOffsetSmall,
            y: lowerY,
            width: CRUMBLING_STAGE_DEFAULTS.floatWidth,
            height: CRUMBLING_STAGE_DEFAULTS.floatHeight,
            passThrough: true,
            behavior: 'pass-through' as const,
            id: 'crumble-lower-left',
          },
          {
            x: cx + CRUMBLING_STAGE_DEFAULTS.floatXOffsetSmall,
            y: lowerY,
            width: CRUMBLING_STAGE_DEFAULTS.floatWidth,
            height: CRUMBLING_STAGE_DEFAULTS.floatHeight,
            passThrough: true,
            behavior: 'pass-through' as const,
            id: 'crumble-lower-right',
          },
          // Upper row — two outer floats further out (recovery routes).
          {
            x: cx - CRUMBLING_STAGE_DEFAULTS.floatXOffsetLarge,
            y: upperY,
            width: CRUMBLING_STAGE_DEFAULTS.floatWidth,
            height: CRUMBLING_STAGE_DEFAULTS.floatHeight,
            passThrough: true,
            behavior: 'pass-through' as const,
            id: 'crumble-upper-left',
          },
          {
            x: cx + CRUMBLING_STAGE_DEFAULTS.floatXOffsetLarge,
            y: upperY,
            width: CRUMBLING_STAGE_DEFAULTS.floatWidth,
            height: CRUMBLING_STAGE_DEFAULTS.floatHeight,
            passThrough: true,
            behavior: 'pass-through' as const,
            id: 'crumble-upper-right',
          },
        ]),
  ];

  const groundTop = groundY - groundHeight / 2;
  const spawnY = Math.min(
    STAGE_DESIGN_HEIGHT - CRUMBLING_STAGE_DEFAULTS.spawnBottomInset,
    groundTop - 40,
  );

  // ---- Item spawn anchors --------------------------------------------------
  // T3 / AC 10 Sub-AC 1. Crumbling stage anchors live over the central
  // *solid* anchor (always present) plus the four crumbling floats
  // when present. Items spawned over a crumbling float will fall
  // through the void if the float has already broken — we treat that
  // as authored gameplay (the items framework handles offscreen TTL),
  // not a bug. Stable anchor ids match the platform ids so a future
  // "spawn anchor at platform.id" lookup is trivially derivable.
  const crumbleHover = CRUMBLING_STAGE_DEFAULTS.itemAnchorHoverOffset;
  const crumbleItemAnchors: ItemSpawnAnchor[] = [
    { id: 'crumble-ground-centre', x: cx, y: groundTop - crumbleHover },
  ];
  if (!omitCrumblingFloats) {
    const lowerTop = lowerY - CRUMBLING_STAGE_DEFAULTS.floatHeight / 2;
    const upperTop = upperY - CRUMBLING_STAGE_DEFAULTS.floatHeight / 2;
    crumbleItemAnchors.push(
      {
        id: 'crumble-lower-left',
        x: cx - CRUMBLING_STAGE_DEFAULTS.floatXOffsetSmall,
        y: lowerTop - crumbleHover,
      },
      {
        id: 'crumble-lower-right',
        x: cx + CRUMBLING_STAGE_DEFAULTS.floatXOffsetSmall,
        y: lowerTop - crumbleHover,
      },
      {
        id: 'crumble-upper-left',
        x: cx - CRUMBLING_STAGE_DEFAULTS.floatXOffsetLarge,
        y: upperTop - crumbleHover,
      },
      {
        id: 'crumble-upper-right',
        x: cx + CRUMBLING_STAGE_DEFAULTS.floatXOffsetLarge,
        y: upperTop - crumbleHover,
      },
    );
  }

  return {
    id,
    // No `hazards` entries — crumbling lifecycle is driven at runtime
    // by attaching a `CrumblingPlatform` entity per platform.id with
    // a `crumble-` prefix. Keeping it out of the `hazards` array
    // means the stage layout stays a pure-data snapshot the M3
    // builder serializes round-trip.
    hazards: [],
    platforms,
    // Sandy/stone temple-ruin backdrop — eroded colonnades echo the
    // crumbling floats. See `backgroundThemes.ts`.
    backgroundTheme: 'crumbling-temple',
    blastZone: {
      left: -BLAST_ZONE_OUTSET.horizontal,
      right: STAGE_DESIGN_WIDTH + BLAST_ZONE_OUTSET.horizontal,
      top: -BLAST_ZONE_OUTSET.top,
      bottom: STAGE_DESIGN_HEIGHT + BLAST_ZONE_OUTSET.bottom,
    },
    spawnPoints: [
      { x: STAGE_DESIGN_WIDTH * 0.35, y: spawnY },
      { x: STAGE_DESIGN_WIDTH * 0.45, y: spawnY },
      { x: STAGE_DESIGN_WIDTH * 0.55, y: spawnY },
      { x: STAGE_DESIGN_WIDTH * 0.65, y: spawnY },
    ],
    itemSpawnAnchors: crumbleItemAnchors,
  };
}

/**
 * Canonical crumbling-platform stage — Sub-AC 2 of AC 90302.
 */
export const CRUMBLING_STAGE: StageLayout = createCrumblingStage();

// ---------------------------------------------------------------------------
// Moving-platform (hazard) stage — Sub-AC 2 of AC 90302
// ---------------------------------------------------------------------------

/**
 * Default authoring constants for the canonical moving-platform stage.
 *
 * Stage shape: two solid edge platforms separated by a wide pit.
 * Two moving platforms ferry fighters back and forth across the gap
 * (one going horizontally, one going vertically) plus one pass-through
 * static safety platform high overhead. Recovery hinges on timing the
 * moving platforms' cycles. Sub-AC 2 of AC 90302: at least one
 * platform here declares `behavior: 'moving'` — the new schema's
 * third behavior type — so the stage exercises the full schema.
 */
export const MOVING_PLATFORM_STAGE_DEFAULTS = {
  /** Stage id for the default moving-platform stage. */
  id: 'moving-platform',
  // ---- Edge solid platforms -------------------------------------------
  /** Width of each edge solid platform. */
  edgeWidth: 480,
  /** Height/thickness of each edge platform. */
  edgeHeight: 80,
  /** Distance from the bottom of the design viewport to the edges' centres. */
  edgeBottomInset: 240,
  /** Horizontal offset of each edge from the screen edge. */
  edgeXOffset: 320,
  // ---- Static top safety platform -------------------------------------
  /** Width of the top centre static safety platform. */
  topPlatformWidth: 360,
  /** Height of the top centre static safety platform. */
  topPlatformHeight: 22,
  /** Vertical inset of the top centre platform. */
  topPlatformBottomInset: 700,
  // ---- Moving platforms ------------------------------------------------
  /** Width of every moving platform. */
  movingWidth: 280,
  /** Height of every moving platform. */
  movingHeight: 24,
  /** Cycle length (frames) for the horizontal mover. ~6 s @ 60 Hz. */
  horizontalCycleFrames: 360,
  /** Cycle length (frames) for the vertical mover. ~5 s @ 60 Hz. */
  verticalCycleFrames: 300,
  /** Vertical inset for spawn points. */
  spawnBottomInset: 320,
  /**
   * Hover offset for item-spawn anchors above each platform's top
   * edge. See `FLAT_STAGE_DEFAULTS.itemAnchorHoverOffset`.
   */
  itemAnchorHoverOffset: 60,
} as const;

export interface MovingPlatformStageOptions {
  readonly id?: string;
  readonly horizontalCycleFrames?: number;
  readonly verticalCycleFrames?: number;
  readonly omitTopPlatform?: boolean;
}

/**
 * Build a moving-platform hazard stage layout. Sub-AC 2 of AC 90302:
 * the moving platforms here declare `behavior: 'moving'` with an
 * accompanying {@link MovingPlatformMotion} record, exercising the
 * third behavior type added by the new schema.
 */
export function createMovingPlatformStage(
  options: MovingPlatformStageOptions = {},
): StageLayout {
  const {
    id = MOVING_PLATFORM_STAGE_DEFAULTS.id,
    horizontalCycleFrames = MOVING_PLATFORM_STAGE_DEFAULTS.horizontalCycleFrames,
    verticalCycleFrames = MOVING_PLATFORM_STAGE_DEFAULTS.verticalCycleFrames,
    omitTopPlatform = false,
  } = options;

  if (
    !Number.isInteger(horizontalCycleFrames) ||
    horizontalCycleFrames < 2
  ) {
    throw new Error(
      `createMovingPlatformStage: horizontalCycleFrames must be an integer >= 2, got ${horizontalCycleFrames}.`,
    );
  }
  if (!Number.isInteger(verticalCycleFrames) || verticalCycleFrames < 2) {
    throw new Error(
      `createMovingPlatformStage: verticalCycleFrames must be an integer >= 2, got ${verticalCycleFrames}.`,
    );
  }

  const D = MOVING_PLATFORM_STAGE_DEFAULTS;

  const edgeY = STAGE_DESIGN_HEIGHT - D.edgeBottomInset;
  const leftEdgeX = D.edgeXOffset + D.edgeWidth / 2;
  const rightEdgeX = STAGE_DESIGN_WIDTH - (D.edgeXOffset + D.edgeWidth / 2);
  const horizontalY = edgeY - 60; // a touch above the edges so it ferries fighters across the gap.
  const verticalBaseY = edgeY - 40;

  // Horizontal mover: ping-pongs between the two edges. Waypoints are
  // expressed relative to the platform's authored base (x, y) — first
  // waypoint is `(0, 0)` so the platform starts at its base, the
  // second waypoint shifts it across the pit.
  const horizontalMotion: MovingPlatformMotion = {
    waypoints: [
      { x: 0, y: 0 },
      { x: rightEdgeX - leftEdgeX, y: 0 },
    ],
    cycleFrames: horizontalCycleFrames,
    phaseFrames: 0,
    mode: 'ping-pong',
    easing: 'sine',
  };
  // Vertical mover: rises and falls in front of the right edge. Half a
  // cycle out of phase with the horizontal mover so the two carriages
  // stagger.
  const verticalMotion: MovingPlatformMotion = {
    waypoints: [
      { x: 0, y: 0 },
      { x: 0, y: -260 },
    ],
    cycleFrames: verticalCycleFrames,
    phaseFrames: Math.round(verticalCycleFrames / 2),
    mode: 'ping-pong',
    easing: 'sine',
  };

  const platforms: StagePlatform[] = [
    // Left edge — solid. Explicit 'solid' behavior.
    {
      x: leftEdgeX,
      y: edgeY,
      width: D.edgeWidth,
      height: D.edgeHeight,
      passThrough: false,
      behavior: 'solid',
      id: 'moving-edge-left',
    },
    // Right edge — solid.
    {
      x: rightEdgeX,
      y: edgeY,
      width: D.edgeWidth,
      height: D.edgeHeight,
      passThrough: false,
      behavior: 'solid',
      id: 'moving-edge-right',
    },
    // Horizontal moving platform — `behavior: 'moving'`. NOT
    // pass-through (kinematic carrier — fighters ride it across).
    {
      x: leftEdgeX,
      y: horizontalY,
      width: D.movingWidth,
      height: D.movingHeight,
      passThrough: false,
      behavior: 'moving',
      motion: horizontalMotion,
      id: 'moving-horizontal',
    },
    // Vertical moving platform — `behavior: 'moving'`.
    {
      x: rightEdgeX - 80,
      y: verticalBaseY,
      width: D.movingWidth,
      height: D.movingHeight,
      passThrough: false,
      behavior: 'moving',
      motion: verticalMotion,
      id: 'moving-vertical',
    },
    ...(omitTopPlatform
      ? []
      : [
          // Top centre safety platform — pass-through.
          {
            x: STAGE_DESIGN_WIDTH / 2,
            y: STAGE_DESIGN_HEIGHT - D.topPlatformBottomInset,
            width: D.topPlatformWidth,
            height: D.topPlatformHeight,
            passThrough: true,
            behavior: 'pass-through' as const,
            id: 'moving-top-platform',
          },
        ]),
  ];

  // Validate every platform up front — catches authoring mistakes
  // (e.g. a 'moving' platform with no motion) at module load rather
  // than crashing the renderer mid-match.
  for (const p of platforms) {
    validateStagePlatform(p, `MOVING_PLATFORM_STAGE platform '${p.id ?? '?'}'`);
  }

  const edgeTop = edgeY - D.edgeHeight / 2;
  const spawnY = Math.min(
    STAGE_DESIGN_HEIGHT - D.spawnBottomInset,
    edgeTop - 40,
  );

  // ---- Item spawn anchors --------------------------------------------------
  // T3 / AC 10 Sub-AC 1. Moving-platform stage anchors sit on the
  // *static* edge platforms and the (optional) top safety platform —
  // never on a moving carrier. An anchor that travelled with a
  // kinematic body would make the spawn position frame-dependent on
  // the carrier's cycle phase and require either coupling the spawn
  // manager to the motion module or the items framework to track a
  // moving spawn point. Both options trip the seed's "open-closed
  // framework" invariant. Putting anchors only on static platforms
  // keeps the data layer pure and the runtime simple.
  const movHover = MOVING_PLATFORM_STAGE_DEFAULTS.itemAnchorHoverOffset;
  // `edgeTop` is already in scope from the spawn-Y computation above —
  // reuse it so the anchor Y stays in lock-step with the spawn-Y math.
  const movingItemAnchors: ItemSpawnAnchor[] = [
    {
      id: 'moving-edge-left',
      x: leftEdgeX,
      y: edgeTop - movHover,
    },
    {
      id: 'moving-edge-right',
      x: rightEdgeX,
      y: edgeTop - movHover,
    },
  ];
  if (!omitTopPlatform) {
    const topPlatformY =
      STAGE_DESIGN_HEIGHT - D.topPlatformBottomInset;
    const topPlatformTop = topPlatformY - D.topPlatformHeight / 2;
    movingItemAnchors.push({
      id: 'moving-top-platform',
      x: STAGE_DESIGN_WIDTH / 2,
      y: topPlatformTop - movHover,
    });
  }

  return {
    id,
    platforms,
    // No declared `StageHazard` entries — the moving carriers ARE the
    // hazard, and they live in `platforms` under the new schema. This
    // is intentional: it lets the M3 stage builder serialize moving
    // platforms through the platform array (where they belong) rather
    // than splitting them into a separate hazards bucket.
    hazards: [],
    // Open-sky cloud backdrop — the moving carriers read as ferries
    // drifting between cloud banks. See `backgroundThemes.ts`.
    backgroundTheme: 'sky-ferry',
    blastZone: {
      left: -BLAST_ZONE_OUTSET.horizontal,
      right: STAGE_DESIGN_WIDTH + BLAST_ZONE_OUTSET.horizontal,
      top: -BLAST_ZONE_OUTSET.top,
      bottom: STAGE_DESIGN_HEIGHT + BLAST_ZONE_OUTSET.bottom,
    },
    spawnPoints: [
      { x: leftEdgeX - 80, y: spawnY },
      { x: leftEdgeX + 80, y: spawnY },
      { x: rightEdgeX - 80, y: spawnY },
      { x: rightEdgeX + 80, y: spawnY },
    ],
    itemSpawnAnchors: movingItemAnchors,
  };
}

/**
 * Canonical moving-platform hazard stage — Sub-AC 2 of AC 90302.
 * At least one platform declares `behavior: 'moving'`, exercising
 * the third behavior type on the new schema.
 */
export const MOVING_PLATFORM_STAGE: StageLayout = createMovingPlatformStage();

// ---------------------------------------------------------------------------
// Stage registry
// ---------------------------------------------------------------------------

/**
 * Registry of all built-in stages keyed by their `id`. The flat stage
 * was the M1 baseline; the four hazard stages (lava, wind, crumbling,
 * moving-platform) are Sub-AC 2 of AC 90302 and exercise every
 * platform behavior on the new schema:
 *
 *   - LAVA_STAGE             — `'solid'` ground + `'pass-through'` floats.
 *   - WIND_STAGE             — `'solid'` ground + `'pass-through'` floats.
 *   - CRUMBLING_STAGE        — `'solid'` ground + `'pass-through'` crumblers.
 *   - MOVING_PLATFORM_STAGE  — `'solid'` edges + `'moving'` carriers + a
 *                              `'pass-through'` safety platform.
 */
export const STAGES: Readonly<Record<string, StageLayout>> = Object.freeze({
  [FLAT_STAGE.id]: FLAT_STAGE,
  [LAVA_STAGE.id]: LAVA_STAGE,
  [WIND_STAGE.id]: WIND_STAGE,
  [CRUMBLING_STAGE.id]: CRUMBLING_STAGE,
  [MOVING_PLATFORM_STAGE.id]: MOVING_PLATFORM_STAGE,
});

/** Look up a stage by id, throwing a clear error if it isn't registered. */
export function getStage(id: string): StageLayout {
  const stage = STAGES[id];
  if (!stage) {
    throw new Error(
      `Unknown stage id "${id}". Known stages: ${Object.keys(STAGES).join(', ') || '<none>'}`,
    );
  }
  return stage;
}
