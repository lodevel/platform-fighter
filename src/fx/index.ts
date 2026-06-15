/**
 * FX module — world-space combat visual effects.
 *
 * Thin Phaser presentation layers over pure, unit-tested formatter
 * modules — the same split (`Component.ts` + `componentFormat.ts` +
 * vitest) the `src/ui/` overlays follow. Every effect here is
 * render-only: it reads the live simulation snapshots the scene hands it
 * and never mutates Matter / fighter state, so a replayed match paints
 * pixel-identical effects.
 *
 *   • Hit spark    — a short burst (core flash + radial shards) spawned
 *                    at the contact point when an attack connects, scaled
 *                    + coloured by damage. The "we are hitting them" cue.
 *   • Swing trail  — a translucent streak along a held weapon's / smash
 *                    finisher's active-frame hitbox sweep. The "the blade
 *                    swept through here" cue.
 *   • Hitbox debug — the F3 toggleable diagnostic layer drawing active
 *                    attack hitboxes (red), hurtboxes (green), and grab
 *                    ranges (yellow) from the real collision geometry.
 */

// ---------------------------------------------------------------------------
// Hit spark — on-contact impact burst
// ---------------------------------------------------------------------------
export { HitSparkPool, createHitSparkPool } from './HitSpark';
export type {
  HitSparkArcLike,
  HitSparkLineLike,
  HitSparkSceneShim,
} from './HitSpark';
export {
  HIT_SPARK_LIFETIME_FRAMES,
  HIT_SPARK_SHARD_COUNT,
  HIT_SPARK_MAX_DAMAGE,
  HIT_SPARK_MIN_DAMAGE,
  HIT_SPARK_CORE_RADIUS_MIN,
  HIT_SPARK_CORE_RADIUS_MAX,
  HIT_SPARK_SHARD_LEN_MIN,
  HIT_SPARK_SHARD_LEN_MAX,
  HIT_SPARK_SHARD_WIDTH_MIN,
  HIT_SPARK_SHARD_WIDTH_MAX,
  HIT_SPARK_COLOR_RAMP,
  HIT_SPARK_CORE_COLOR,
  computeHitSparkVisual,
  hitSparkIntensity,
  hitSparkColor,
  hitSparkProgress,
  hitSparkAlpha,
  hitSparkHash01,
} from './hitSparkFormat';
export type {
  HitSparkInput,
  HitSparkVisual,
  HitSparkCoreVisual,
  HitSparkShardVisual,
} from './hitSparkFormat';

// ---------------------------------------------------------------------------
// Swing trail — held-weapon / smash sweep streak
// ---------------------------------------------------------------------------
export { SwingTrail, createSwingTrail } from './SwingTrail';
export type {
  SwingTrailRectLike,
  SwingTrailSceneShim,
  SwingTrailSnapshot,
} from './SwingTrail';
export {
  SWING_TRAIL_WEAPON_MOVE_IDS,
  SWING_TRAIL_MOVE_TYPES,
  SWING_TRAIL_PEAK_ALPHA,
  SWING_TRAIL_PEAK_STROKE_ALPHA,
  SWING_TRAIL_STROKE_WIDTH,
  SWING_TRAIL_FADE_FRAMES,
  SWING_TRAIL_MAX_DAMAGE,
  SWING_TRAIL_MIN_DAMAGE,
  SWING_TRAIL_COLOR_RAMP,
  computeSwingTrailVisual,
  swingTrailAppliesTo,
  swingTrailIntensity,
  swingTrailColor,
  swingTrailActiveAlphaMultiplier,
} from './swingTrailFormat';
export type { SwingTrailInput, SwingTrailVisual } from './swingTrailFormat';

// ---------------------------------------------------------------------------
// Hitbox debug overlay (F3)
// ---------------------------------------------------------------------------
export { HitboxDebugLayer, createHitboxDebugLayer } from './HitboxDebugLayer';
export type {
  HitboxDebugGraphicsLike,
  HitboxDebugSceneShim,
} from './HitboxDebugLayer';
export {
  HITBOX_DEBUG_ATTACK_COLOR,
  HITBOX_DEBUG_ATTACK_FILL_ALPHA,
  HITBOX_DEBUG_ATTACK_STROKE_ALPHA,
  HITBOX_DEBUG_HURTBOX_COLOR,
  HITBOX_DEBUG_HURTBOX_FILL_ALPHA,
  HITBOX_DEBUG_HURTBOX_STROKE_ALPHA,
  HITBOX_DEBUG_GRAB_COLOR,
  HITBOX_DEBUG_GRAB_FILL_ALPHA,
  HITBOX_DEBUG_GRAB_STROKE_ALPHA,
  HITBOX_DEBUG_STROKE_WIDTH,
  attackDebugBox,
  hurtboxDebugBoxes,
  grabDebugBox,
  computeFighterDebugBoxes,
} from './hitboxDebugFormat';
export type {
  HitboxDebugBox,
  HitboxDebugBoxKind,
  HitboxDebugFighterSnapshot,
} from './hitboxDebugFormat';
