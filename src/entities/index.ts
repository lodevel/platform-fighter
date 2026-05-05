/**
 * Entities barrel — top-level runtime actors that combine engine
 * primitives (Matter bodies, combat math) with player-slot identity.
 *
 * The first entity is `Fighter` — the per-player runtime actor that
 * wraps a `Character` (physics + combat) with slot identity (player
 * index, palette, stocks). See `./Fighter.ts` for the long-form
 * design rationale.
 *
 * Future entities (hazard actors, item pickups, projectile launchers)
 * land alongside Fighter in this directory so the rest of the engine
 * has one consistent place to import "things that exist in the world
 * and have per-frame state" from.
 */

export {
  Fighter,
  DEFAULT_FIGHTER_STOCK_COUNT,
  MAX_PALETTE_INDEX,
  defaultCharacterFactory,
} from './Fighter';
export type {
  FighterOptions,
  FighterSlotIndex,
  FighterStateSnapshot,
  CharacterFactory,
} from './Fighter';

// Stage hazards — Sub-AC 1 of AC 9 (M2 hazard stages). The lava
// hazard owns no Phaser objects; the renderer / collision adapter
// reads from it each fixed step.
export { LavaHazard, LAVA_DEFAULTS, lavaHeightNorm } from './LavaHazard';
export type {
  LavaHazardOptions,
  LavaHazardState,
  LavaBounds,
  LavaPhase,
} from './LavaHazard';

// Stage hazards — Sub-AC 1 of AC 10 (M2 hazard stages). The crumbling
// platform is a timer-based drop-and-respawn hazard. Like LavaHazard
// it owns no Phaser objects — the renderer / collision adapter reads
// from it each fixed step.
export { CrumblingPlatform, CRUMBLE_DEFAULTS } from './CrumblingPlatform';
export type {
  CrumblingPlatformOptions,
  CrumblingPlatformState,
  CrumblingPhase,
  CrumblingBounds,
  CrumblingRenderState,
} from './CrumblingPlatform';

// Stage hazards — Sub-AC 2 of AC 10. The multi-stage variant subdivides
// the warning window into shake → crack → break sub-stages, each with
// distinct visual hints AND a measurably degraded collision footprint
// (shrinking effective bounds + a `fragile` flag the AI / physics
// adapter can read). Same Phaser-free, deterministic, snapshot-friendly
// design as the baseline crumbler.
export {
  MultiStageCrumblingPlatform,
  MULTI_STAGE_CRUMBLE_DEFAULTS,
} from './MultiStageCrumblingPlatform';
export type {
  MultiStageCrumblingPlatformOptions,
  MultiStageCrumblingState,
  MultiStagePhase,
  MultiStageBounds,
  MultiStageCrumblingRenderState,
} from './MultiStageCrumblingPlatform';

// Stage hazards — AC 10102 Sub-AC 2 (M2 wind hazard stage). Directional
// force-field hazard. Like the lava hazard, owns no Phaser objects: a
// deterministic frame-counter driver that produces a per-fixed-step
// force vector for the WindForceController to apply to overlapping
// fighters.
export {
  WindZoneHazard,
  WIND_DEFAULTS,
  windCycleCosine,
  createWindHazardFromStageHazard,
} from './WindZoneHazard';
export type {
  WindZoneHazardOptions,
  WindZoneHazardState,
  WindZoneBounds,
  WindForceVector,
  WindPhase,
  WindStageHazardLike,
} from './WindZoneHazard';

// Stage hazards — Sub-AC 3 of AC 10. The periodic / phasing platform
// runs on a *purely time-driven* cycle (no `onSteppedOn()` trigger) and
// telegraphs both transitions: a `warnDisappear` blink while still
// solid, and a `warnAppear` ghost while still NON-solid (so fighters
// can't be teleported into a body that is still materialising). Same
// Phaser-free, deterministic, snapshot-friendly design as the other
// hazards.
export {
  PeriodicPlatform,
  PERIODIC_PLATFORM_DEFAULTS,
} from './PeriodicPlatform';
export type {
  PeriodicPlatformOptions,
  PeriodicPlatformState,
  PeriodicPhase,
  PeriodicBounds,
  PeriodicRenderState,
} from './PeriodicPlatform';
