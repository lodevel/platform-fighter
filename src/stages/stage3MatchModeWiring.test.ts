/**
 * AC 10103 Sub-AC 3 — "Build Stage 3 with its collision geometry,
 * spawn points, and stage-specific hazard behavior wired into match
 * mode."
 *
 * Stage 3 in this codebase is the `CRUMBLING_STAGE` — the third hazard
 * stage in the canonical 4-stage roster (lava → wind → crumbling →
 * moving-platform). Sub-ACs 1 and 2 covered Stage 1 (lava) and Stage 2
 * (wind); this Sub-AC extends the same end-to-end wiring contract to
 * the crumbling stage.
 *
 * What the AC text demands, mapped to test groups below:
 *
 *   • Collision geometry — `CRUMBLING_STAGE.platforms` carries a solid
 *     ground anchor (`crumble-ground`) and four pass-through *crumbling*
 *     floats with stable IDs (`crumble-lower-left/right`,
 *     `crumble-upper-left/right`). Every platform declares an explicit
 *     `behavior` so the new schema is the single source of truth for
 *     collision dispatch. The geometry must fit inside the design
 *     viewport and the blast zone must enclose the viewport so KOs can
 *     fire on all four sides.
 *
 *   • Spawn points — four spawn points (one per match slot), all
 *     strictly above the central solid ground so fighters drop in
 *     safely, all inside the design width, and all distinct so two
 *     fighters never overlap on spawn.
 *
 *   • Stage-specific hazard behavior — the four crumbling floats are
 *     the *hazard* on this stage. Unlike lava/wind, the crumbling
 *     lifecycle isn't declared in `layout.hazards` (intentional: the
 *     M3 stage builder serializes crumblers through the platform array
 *     where they belong). Instead, the runtime layer attaches a
 *     {@link CrumblingPlatform} entity per platform `id` with the
 *     `crumble-` prefix. The lifecycle (`intact → triggered → falling
 *     → gone → intact`) drives the collision toggle so the platform
 *     becomes non-collidable the moment it enters `falling`.
 *
 *   • Wired into match mode — the canonical MatchScene resolution path
 *     (`MatchConfig.stageId === 'crumbling'` → `getStage('crumbling')`)
 *     returns the registered `CRUMBLING_STAGE`, the renderer-free wiring
 *     composes into the {@link computePlatformColliderState} pipeline so
 *     each crumble's lifecycle phase flips the platform body's collision
 *     filter at the exact frame the entity transitions, and the menu
 *     surfaces the entry so a player can actually pick it.
 *
 * Why a Phaser-free integration test (mirrors stage1/stage2 wiring):
 *
 *   • Determinism. The lifecycle / collision-toggle chain is pure data —
 *     identical step-on event streams produce identical lifecycle and
 *     collision-mode sequences across runs. Pulling Phaser into the
 *     loop would cost determinism for no incremental coverage (the
 *     Phaser side is exercised by `StageRenderer.test.ts` and
 *     `PlatformVisualBinder.test.ts` against mock scenes).
 *
 *   • Speed. The full chain runs in milliseconds under plain Node, so
 *     a regression in any sub-system (registry, lifecycle entity,
 *     collision toggle) trips this test before the slower MatchScene
 *     boot test catches it.
 */

import { describe, it, expect } from 'vitest';
import {
  CRUMBLING_STAGE,
  CRUMBLING_STAGE_DEFAULTS,
  STAGES,
  STAGE_DESIGN_HEIGHT,
  STAGE_DESIGN_WIDTH,
  getStage,
} from './stageDefinitions';
import { getPlatformBehavior } from './platformBehavior';
import {
  computePlatformColliderState,
  applyPlatformColliderState,
  togglePlatformCollision,
  type ToggleablePlatformBody,
} from './platformCollisionToggle';
import {
  CrumblingPlatform,
  CRUMBLE_DEFAULTS,
  type CrumblingPlatformOptions,
} from '../entities/CrumblingPlatform';
import { BUILT_IN_STAGE_ENTRIES } from '../scenes/stageSelect';
import {
  COLLISION_CATEGORIES,
  COLLISION_MASKS,
} from '../engine/collisionCategories';
import type { StagePlatform } from '../types';

// ---------------------------------------------------------------------------
// Helpers — mirror the production runtime layer that wraps each
// crumble-tagged platform record in a `CrumblingPlatform` entity, then
// drives the platform body's collision filter through
// `togglePlatformCollision` each fixed step.
// ---------------------------------------------------------------------------

/**
 * Build a runtime `CrumblingPlatform` from a stage-platform record. The
 * production runtime does this for every platform whose `id` starts
 * with the `crumble-` prefix (excluding the `crumble-ground` anchor).
 */
function crumbleEntityFromPlatform(p: StagePlatform): CrumblingPlatform {
  const opts: CrumblingPlatformOptions = {
    id: p.id,
    x: p.x,
    y: p.y,
    width: p.width,
    height: p.height,
    // Use defaults — the canonical CRUMBLING_STAGE doesn't override the
    // crumble timing knobs in `layout.hazards` (intentional: the
    // lifecycle is attached at runtime, not authored on the layout).
  };
  return new CrumblingPlatform(opts);
}

/**
 * Create a minimal toggleable body that mirrors what
 * `StageRenderer.renderStage` would have constructed for a pass-through
 * crumbling platform. Only the fields `applyPlatformColliderState`
 * touches are required.
 */
function makePassThroughPlatformBody(): ToggleablePlatformBody {
  return {
    collisionFilter: {
      category: COLLISION_CATEGORIES.PLATFORM_PASS_THROUGH,
      mask: COLLISION_MASKS.PLATFORM_PASS_THROUGH,
      group: 0,
    },
  };
}

/**
 * Walk one fixed step through the runtime adapter:
 *   1. tick the entity,
 *   2. recompute the collision state from `(behavior, isSolid)`,
 *   3. write it back to the body's `collisionFilter`.
 *
 * This is the pure-data analogue of MatchScene's per-step "advance
 * crumbles, then re-toggle their bodies" loop.
 */
function tickCrumbleAndToggle(
  entity: CrumblingPlatform,
  body: ToggleablePlatformBody,
  platform: StagePlatform,
): void {
  entity.tick();
  togglePlatformCollision(body, {
    behavior: getPlatformBehavior(platform),
    passThrough: platform.passThrough,
    isSolid: entity.isSolid(),
  });
}

// ---------------------------------------------------------------------------
// Test groups
// ---------------------------------------------------------------------------

describe('AC 10103 Sub-AC 3 — Stage 3 (crumbling) collision geometry', () => {
  it("registers Stage 3 in the canonical STAGES registry under id 'crumbling'", () => {
    // Match-mode resolution path 1 of 3: MatchScene's `getStage(id)`
    // call has to find Stage 3 in the registry by its canonical id.
    expect(CRUMBLING_STAGE.id).toBe('crumbling');
    expect(STAGES['crumbling']).toBe(CRUMBLING_STAGE);
    expect(getStage('crumbling')).toBe(CRUMBLING_STAGE);
  });

  it('carries a solid ground anchor and at least one pass-through crumbling float', () => {
    const platforms = CRUMBLING_STAGE.platforms;
    const solid = platforms.filter(
      (p) => getPlatformBehavior(p) === 'solid',
    );
    const floats = platforms.filter(
      (p) => getPlatformBehavior(p) === 'pass-through',
    );
    expect(solid.length).toBeGreaterThanOrEqual(1);
    expect(floats.length).toBeGreaterThanOrEqual(1);
  });

  it('declares an explicit behavior on every platform (new schema)', () => {
    // Sub-AC 2 of AC 90302 contract — every platform on a hazard stage
    // carries the canonical `behavior` field so the renderer + replay
    // tooling read one source of truth instead of falling back to the
    // legacy `passThrough` boolean.
    for (const p of CRUMBLING_STAGE.platforms) {
      expect(p.behavior).toBeDefined();
      expect(['solid', 'pass-through', 'moving']).toContain(p.behavior);
      // Stable IDs are required for the runtime layer to address each
      // crumble entity across snapshot boundaries.
      expect(typeof p.id).toBe('string');
      expect((p.id ?? '').length).toBeGreaterThan(0);
    }
    const ids = CRUMBLING_STAGE.platforms.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('exposes the canonical crumble-* platform IDs (ground + 4 floats)', () => {
    // The runtime crumble adapter looks up entities by these stable
    // IDs. If they ever drift (typo, rename, missing entry) the
    // adapter silently leaves a platform without lifecycle behaviour
    // and the player gets a non-falling "crumbler". Pin the IDs here.
    const ids = CRUMBLING_STAGE.platforms.map((p) => p.id ?? '');
    expect(ids).toContain('crumble-ground');
    expect(ids).toContain('crumble-lower-left');
    expect(ids).toContain('crumble-lower-right');
    expect(ids).toContain('crumble-upper-left');
    expect(ids).toContain('crumble-upper-right');
  });

  it('declares the central anchor as solid and every other crumble-* platform as pass-through', () => {
    const ground = CRUMBLING_STAGE.platforms.find(
      (p) => p.id === 'crumble-ground',
    )!;
    expect(getPlatformBehavior(ground)).toBe('solid');
    const crumblers = CRUMBLING_STAGE.platforms.filter(
      (p) =>
        (p.id ?? '').startsWith('crumble-') && p.id !== 'crumble-ground',
    );
    expect(crumblers.length).toBeGreaterThanOrEqual(4);
    for (const c of crumblers) {
      expect(getPlatformBehavior(c)).toBe('pass-through');
    }
  });

  it('fits every platform inside the design viewport', () => {
    for (const p of CRUMBLING_STAGE.platforms) {
      expect(p.x - p.width / 2).toBeGreaterThanOrEqual(0);
      expect(p.x + p.width / 2).toBeLessThanOrEqual(STAGE_DESIGN_WIDTH);
      expect(p.y - p.height / 2).toBeGreaterThanOrEqual(0);
      expect(p.y + p.height / 2).toBeLessThanOrEqual(STAGE_DESIGN_HEIGHT);
    }
  });

  it('encloses the entire design viewport inside the blast zone (4-side KO contract)', () => {
    const z = CRUMBLING_STAGE.blastZone;
    expect(z.left).toBeLessThan(0);
    expect(z.right).toBeGreaterThan(STAGE_DESIGN_WIDTH);
    expect(z.top).toBeLessThan(0);
    expect(z.bottom).toBeGreaterThan(STAGE_DESIGN_HEIGHT);
  });

  it('keeps the canonical default ground dimensions', () => {
    const ground = CRUMBLING_STAGE.platforms.find(
      (p) => p.id === 'crumble-ground',
    )!;
    expect(ground.width).toBe(CRUMBLING_STAGE_DEFAULTS.groundWidth);
    expect(ground.height).toBe(CRUMBLING_STAGE_DEFAULTS.groundHeight);
  });

  it('places the upper crumble row strictly above the lower crumble row', () => {
    // The lower row is the "easy hop" path; the upper row is the
    // "recovery route" further out. If their vertical ordering ever
    // flipped the recovery topology would invert and the level
    // playtests would all break.
    const lowerLeft = CRUMBLING_STAGE.platforms.find(
      (p) => p.id === 'crumble-lower-left',
    )!;
    const upperLeft = CRUMBLING_STAGE.platforms.find(
      (p) => p.id === 'crumble-upper-left',
    )!;
    // Smaller y == higher on screen.
    expect(upperLeft.y).toBeLessThan(lowerLeft.y);
  });
});

describe('AC 10103 Sub-AC 3 — Stage 3 spawn points', () => {
  it('exposes exactly four spawn points (one per match slot)', () => {
    expect(CRUMBLING_STAGE.spawnPoints.length).toBe(4);
  });

  it('places every spawn strictly above the central solid ground', () => {
    const ground = CRUMBLING_STAGE.platforms.find(
      (p) => getPlatformBehavior(p) === 'solid',
    )!;
    const groundTop = ground.y - ground.height / 2;
    for (const sp of CRUMBLING_STAGE.spawnPoints) {
      // Smaller y == higher on screen → strictly above the platform top.
      expect(sp.y).toBeLessThan(groundTop);
    }
  });

  it('keeps every spawn inside the design width so fighters do not spawn off-stage', () => {
    for (const sp of CRUMBLING_STAGE.spawnPoints) {
      expect(sp.x).toBeGreaterThanOrEqual(0);
      expect(sp.x).toBeLessThanOrEqual(STAGE_DESIGN_WIDTH);
    }
  });

  it('produces unique spawn coordinates so fighters do not stack on top of each other', () => {
    const keys = CRUMBLING_STAGE.spawnPoints.map((sp) => `${sp.x},${sp.y}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps every spawn inside the design viewport vertically (above the bottom edge)', () => {
    for (const sp of CRUMBLING_STAGE.spawnPoints) {
      expect(sp.y).toBeGreaterThanOrEqual(0);
      expect(sp.y).toBeLessThanOrEqual(STAGE_DESIGN_HEIGHT);
    }
  });
});

describe('AC 10103 Sub-AC 3 — Stage 3 stage-specific hazard behavior', () => {
  it("does not declare the crumble lifecycle in `layout.hazards` (it lives on the platforms themselves)", () => {
    // Intentional design choice: lava + wind own a `StageHazard` record
    // because they're geometry-distinct from any platform; crumblers
    // ARE platforms, so the M3 stage builder serializes them through
    // the `platforms` array. The runtime layer attaches a
    // `CrumblingPlatform` entity per platform `id` at match start.
    expect(CRUMBLING_STAGE.hazards).toEqual([]);
  });

  it("allows constructing a runtime CrumblingPlatform per crumble-tagged float (the canonical match-mode bridge)", () => {
    // Match-mode resolution path 3 of 3: every crumble float yields a
    // valid runtime entity whose immutable geometry mirrors the
    // authored record. This is the pure-data analogue of the
    // MatchScene boot path.
    const crumblers = CRUMBLING_STAGE.platforms.filter(
      (p) =>
        (p.id ?? '').startsWith('crumble-') && p.id !== 'crumble-ground',
    );
    expect(crumblers.length).toBeGreaterThanOrEqual(4);
    for (const p of crumblers) {
      const entity = crumbleEntityFromPlatform(p);
      expect(entity.getId()).toBe(p.id);
      expect(entity.getX()).toBe(p.x);
      expect(entity.getY()).toBe(p.y);
      expect(entity.getWidth()).toBe(p.width);
      expect(entity.getHeight()).toBe(p.height);
      // Default-driven lifecycle delays — the canonical stage does not
      // override these, so every crumble inherits the canonical timing.
      expect(entity.getTriggerDelay()).toBe(CRUMBLE_DEFAULTS.triggerDelay);
      expect(entity.getFallDuration()).toBe(CRUMBLE_DEFAULTS.fallDuration);
      expect(entity.getRespawnDelay()).toBe(CRUMBLE_DEFAULTS.respawnDelay);
      // Initial state — every crumble starts intact and solid.
      expect(entity.getPhase()).toBe('intact');
      expect(entity.isSolid()).toBe(true);
    }
  });

  it('drives the crumble lifecycle deterministically: intact → triggered → falling → gone → intact', () => {
    // The Seed mandates a deterministic engine. Walk the full
    // lifecycle and pin the transition frames against the canonical
    // delays from `CRUMBLE_DEFAULTS`.
    const float = CRUMBLING_STAGE.platforms.find(
      (p) => p.id === 'crumble-lower-left',
    )!;
    const entity = crumbleEntityFromPlatform(float);

    // intact → triggered (instant on step-on).
    expect(entity.getPhase()).toBe('intact');
    expect(entity.onSteppedOn()).toBe(true);
    expect(entity.getPhase()).toBe('triggered');

    // triggered → falling after `triggerDelay` ticks. Solidity stays
    // true throughout the warning window, then flips off the moment
    // the platform enters `falling`.
    for (let i = 0; i < CRUMBLE_DEFAULTS.triggerDelay - 1; i += 1) {
      entity.tick();
      expect(entity.getPhase()).toBe('triggered');
      expect(entity.isSolid()).toBe(true);
    }
    entity.tick();
    expect(entity.getPhase()).toBe('falling');
    expect(entity.isSolid()).toBe(false);

    // falling → gone after `fallDuration` ticks.
    for (let i = 0; i < CRUMBLE_DEFAULTS.fallDuration - 1; i += 1) {
      entity.tick();
      expect(entity.getPhase()).toBe('falling');
    }
    entity.tick();
    expect(entity.getPhase()).toBe('gone');
    expect(entity.isSolid()).toBe(false);

    // gone → intact after `respawnDelay` ticks.
    for (let i = 0; i < CRUMBLE_DEFAULTS.respawnDelay - 1; i += 1) {
      entity.tick();
      expect(entity.getPhase()).toBe('gone');
    }
    entity.tick();
    expect(entity.getPhase()).toBe('intact');
    expect(entity.isSolid()).toBe(true);
  });

  it("makes onSteppedOn() idempotent during the warning window (deterministic regardless of fighter count)", () => {
    // The lifecycle invariant in CrumblingPlatform: once `triggered`,
    // additional `onSteppedOn()` calls are no-ops. This is what makes
    // the timer deterministic across multi-fighter matches — if four
    // fighters all bounce on the same warning-window crumble, the
    // countdown stays anchored to the *first* step-on, not the last.
    const float = CRUMBLING_STAGE.platforms.find(
      (p) => p.id === 'crumble-upper-right',
    )!;
    const entity = crumbleEntityFromPlatform(float);
    expect(entity.onSteppedOn()).toBe(true);
    const phaseStart = entity.getPhaseStartFrame();
    // 10 more stomps over the next 10 frames — none of them should
    // restart the countdown or extend the warning window.
    for (let i = 0; i < 10; i += 1) {
      entity.tick();
      expect(entity.onSteppedOn()).toBe(false);
    }
    expect(entity.getPhaseStartFrame()).toBe(phaseStart);
    // The platform still falls at the original deadline, not later.
    const remaining = CRUMBLE_DEFAULTS.triggerDelay - 10;
    for (let i = 0; i < remaining - 1; i += 1) {
      entity.tick();
      expect(entity.getPhase()).toBe('triggered');
    }
    entity.tick();
    expect(entity.getPhase()).toBe('falling');
  });
});

describe('AC 10103 Sub-AC 3 — Stage 3 wired into match mode end-to-end', () => {
  it('is selectable from the StageSelectScene roster (player-facing entry point)', () => {
    // Match-mode resolution path 2 of 3: the menu has to surface
    // Stage 3 to the player as a choice. `BUILT_IN_STAGE_ENTRIES` is
    // the data-driven list `StageSelectScene` walks; if Stage 3 isn't
    // here, the menu can't fire `MatchConfig.stageId = 'crumbling'`.
    const entry = BUILT_IN_STAGE_ENTRIES.find(
      (e) => e.id === CRUMBLING_STAGE.id,
    );
    expect(entry).toBeDefined();
    expect(entry?.kind).toBe('built-in');
    expect(entry?.displayName).toBe('CRUMBLING');
    // Subtitle calls out the step-on trigger so a player glancing at
    // the menu knows what kind of hazard to expect.
    expect(entry?.subtitle.toLowerCase()).toMatch(/floor|crumb|step|fall/);
  });

  it('flips a crumbling platform body collision filter to inactive when the lifecycle enters `falling` (the canonical match-mode wiring)', () => {
    // This is the headline "wired into match mode" assertion. We wire
    // up the same chain `MatchScene` does — minus Phaser — and step a
    // fighter onto a crumbling float. Across the warning window the
    // body must keep its pass-through filter; at the falling-frame
    // boundary the toggle must drop the mask to 0 so no future
    // collision pair fires against the body.
    const float = CRUMBLING_STAGE.platforms.find(
      (p) => p.id === 'crumble-lower-right',
    )!;
    const entity = crumbleEntityFromPlatform(float);
    const body = makePassThroughPlatformBody();

    // ---- Pre-conditions: body has the canonical pass-through filter.
    expect(body.collisionFilter.category).toBe(
      COLLISION_CATEGORIES.PLATFORM_PASS_THROUGH,
    );
    expect(body.collisionFilter.mask).toBe(
      COLLISION_MASKS.PLATFORM_PASS_THROUGH,
    );
    // Before any step-on, the toggle resolves the body to plain pass-through.
    const initialState = togglePlatformCollision(body, {
      behavior: getPlatformBehavior(float),
      passThrough: float.passThrough,
      isSolid: entity.isSolid(),
    });
    expect(initialState.mode).toBe('pass-through');
    expect(body.collisionFilter.mask).toBe(
      COLLISION_MASKS.PLATFORM_PASS_THROUGH,
    );

    // ---- Player steps on the float — start the warning countdown.
    entity.onSteppedOn();
    // Across the entire warning window the body must remain
    // collidable — the fighter is supposed to be able to keep using
    // the platform until it actually drops.
    for (let i = 0; i < CRUMBLE_DEFAULTS.triggerDelay - 1; i += 1) {
      tickCrumbleAndToggle(entity, body, float);
      expect(entity.getPhase()).toBe('triggered');
      expect(body.collisionFilter.mask).toBe(
        COLLISION_MASKS.PLATFORM_PASS_THROUGH,
      );
    }
    // ---- The transition frame: triggered → falling. The body must
    // immediately become non-collidable (mask 0) so no future
    // collision pair fires against it.
    tickCrumbleAndToggle(entity, body, float);
    expect(entity.getPhase()).toBe('falling');
    expect(entity.isSolid()).toBe(false);
    expect(body.collisionFilter.mask).toBe(0);
    // Category is preserved so debug overlays still report "this body
    // would have been a pass-through platform" — the match-mode
    // contract requires only the mask to drop.
    expect(body.collisionFilter.category).toBe(
      COLLISION_CATEGORIES.PLATFORM_PASS_THROUGH,
    );

    // ---- Across `falling` and `gone` the body stays inactive.
    for (
      let i = 0;
      i < CRUMBLE_DEFAULTS.fallDuration + CRUMBLE_DEFAULTS.respawnDelay - 1;
      i += 1
    ) {
      tickCrumbleAndToggle(entity, body, float);
      expect(body.collisionFilter.mask).toBe(0);
    }
    // ---- Respawn frame: gone → intact, body re-arms to pass-through.
    tickCrumbleAndToggle(entity, body, float);
    expect(entity.getPhase()).toBe('intact');
    expect(entity.isSolid()).toBe(true);
    expect(body.collisionFilter.mask).toBe(
      COLLISION_MASKS.PLATFORM_PASS_THROUGH,
    );
  });

  it('honours drop-through input separately from the crumble lifecycle (countable refcount)', () => {
    // A `pass-through` crumbling platform that's still solid must also
    // honour a fighter's drop-through input — the two systems compose.
    // While at least one fighter is mid-drop the mask drops the
    // CHARACTER bit (mode 'pass-through-drop') without touching the
    // crumble lifecycle.
    const float = CRUMBLING_STAGE.platforms.find(
      (p) => p.id === 'crumble-lower-left',
    )!;
    const entity = crumbleEntityFromPlatform(float);
    const body = makePassThroughPlatformBody();

    // One fighter mid-drop on an intact float.
    const droppingState = togglePlatformCollision(body, {
      behavior: getPlatformBehavior(float),
      passThrough: float.passThrough,
      isSolid: entity.isSolid(),
      dropThroughCount: 1,
    });
    expect(droppingState.mode).toBe('pass-through-drop');
    // Mask drops the CHARACTER bit so the dropping fighter's body
    // physically passes through the platform.
    expect(body.collisionFilter.mask & COLLISION_CATEGORIES.CHARACTER).toBe(0);
    // Other categories the pass-through default opts into are
    // preserved (the toggle strips ONLY the CHARACTER bit).
    const preservedBits =
      COLLISION_MASKS.PLATFORM_PASS_THROUGH & ~COLLISION_CATEGORIES.CHARACTER;
    expect(body.collisionFilter.mask).toBe(preservedBits);

    // Refcount drops to 0 → mode flips back to plain 'pass-through'.
    togglePlatformCollision(body, {
      behavior: getPlatformBehavior(float),
      passThrough: float.passThrough,
      isSolid: entity.isSolid(),
      dropThroughCount: 0,
    });
    expect(body.collisionFilter.mask).toBe(
      COLLISION_MASKS.PLATFORM_PASS_THROUGH,
    );

    // Now trigger the crumble. Even with a fighter mid-drop, once the
    // platform enters `falling` the inactive short-circuit wins: the
    // mask is 0 regardless of the drop-through refcount.
    entity.onSteppedOn();
    for (let i = 0; i < CRUMBLE_DEFAULTS.triggerDelay; i += 1) {
      entity.tick();
    }
    expect(entity.getPhase()).toBe('falling');
    const fallingDropping = togglePlatformCollision(body, {
      behavior: getPlatformBehavior(float),
      passThrough: float.passThrough,
      isSolid: entity.isSolid(),
      dropThroughCount: 1,
    });
    expect(fallingDropping.mode).toBe('inactive');
    expect(body.collisionFilter.mask).toBe(0);
  });

  it('keeps four crumblers independent: triggering one does not advance the others', () => {
    // Match-mode contract: each crumble's lifecycle is independent.
    // Two adjacent floats can be in completely different phases on the
    // same frame — that's what makes the recovery puzzle interesting.
    const lowerLeft = CRUMBLING_STAGE.platforms.find(
      (p) => p.id === 'crumble-lower-left',
    )!;
    const lowerRight = CRUMBLING_STAGE.platforms.find(
      (p) => p.id === 'crumble-lower-right',
    )!;
    const eL = crumbleEntityFromPlatform(lowerLeft);
    const eR = crumbleEntityFromPlatform(lowerRight);

    // Step on the left only — the right stays intact.
    eL.onSteppedOn();
    expect(eL.getPhase()).toBe('triggered');
    expect(eR.getPhase()).toBe('intact');

    // Tick both — left progresses through the warning window, right
    // remains intact (no implicit timer in `intact`).
    for (let i = 0; i < CRUMBLE_DEFAULTS.triggerDelay; i += 1) {
      eL.tick();
      eR.tick();
    }
    expect(eL.getPhase()).toBe('falling');
    expect(eL.isSolid()).toBe(false);
    expect(eR.getPhase()).toBe('intact');
    expect(eR.isSolid()).toBe(true);
  });

  it('keeps Stage 3 hazard behavior deterministic across runs (replay safety)', () => {
    // The Seed mandates a deterministic engine where a recorded match
    // replays byte-for-byte. Replay determinism for crumblers reduces
    // to: "given identical step-on events at identical frames, every
    // public observable produces the same output across runs." Build
    // two independent entities and drive them through identical
    // event streams — every observable must match every frame.
    const float = CRUMBLING_STAGE.platforms.find(
      (p) => p.id === 'crumble-upper-left',
    )!;

    const buildPair = () => crumbleEntityFromPlatform(float);
    const a = buildPair();
    const b = buildPair();

    // Both step on at frame 17.
    for (let i = 0; i < 17; i += 1) {
      a.tick();
      b.tick();
    }
    expect(a.onSteppedOn()).toBe(true);
    expect(b.onSteppedOn()).toBe(true);

    // Walk a full lifecycle (~3.5 s @ 60 fps) and assert every
    // observable matches frame-by-frame.
    const totalFrames =
      CRUMBLE_DEFAULTS.triggerDelay +
      CRUMBLE_DEFAULTS.fallDuration +
      CRUMBLE_DEFAULTS.respawnDelay +
      30; // a touch past the respawn so we cover a re-intact frame
    for (let f = 0; f < totalFrames; f += 1) {
      expect(b.getPhase()).toBe(a.getPhase());
      expect(b.getFrame()).toBe(a.getFrame());
      expect(b.getPhaseStartFrame()).toBe(a.getPhaseStartFrame());
      expect(b.isSolid()).toBe(a.isSolid());
      expect(b.getRenderState()).toEqual(a.getRenderState());
      a.tick();
      b.tick();
    }
  });

  it('snapshots and restores byte-perfectly through the replay state-snapshot system', () => {
    // M4 hybrid replay: every entity that holds mutable state must
    // serialise/restore via `toState()`/`fromState()` so the VCR
    // scrub can rewind to any frame and resync the platform exactly.
    const float = CRUMBLING_STAGE.platforms.find(
      (p) => p.id === 'crumble-upper-right',
    )!;
    const original = crumbleEntityFromPlatform(float);

    // Walk into the middle of the warning window.
    original.onSteppedOn();
    for (let i = 0; i < 23; i += 1) original.tick();
    const snapshot = original.toState();

    const restored = crumbleEntityFromPlatform(float);
    restored.fromState(snapshot);

    // Future observables are identical for the next full lifecycle.
    const totalFrames =
      CRUMBLE_DEFAULTS.triggerDelay +
      CRUMBLE_DEFAULTS.fallDuration +
      CRUMBLE_DEFAULTS.respawnDelay;
    for (let i = 0; i < totalFrames; i += 1) {
      expect(restored.getPhase()).toBe(original.getPhase());
      expect(restored.getFrame()).toBe(original.getFrame());
      expect(restored.isSolid()).toBe(original.isSolid());
      expect(restored.getRenderState()).toEqual(original.getRenderState());
      original.tick();
      restored.tick();
    }
  });
});

describe('AC 10103 Sub-AC 3 — defaults match across the platform ↔ entity bridge', () => {
  it('crumbleEntityFromPlatform falls back to CRUMBLE_DEFAULTS when no overrides are supplied', () => {
    // Defensive: a stage authored without overriding the crumble
    // timing knobs (i.e. the canonical CRUMBLING_STAGE) still
    // produces functional entities via the canonical defaults. The
    // M3 builder relies on this so a crumble piece with default
    // tuning round-trips cleanly.
    const float = CRUMBLING_STAGE.platforms.find(
      (p) => p.id === 'crumble-lower-left',
    )!;
    const e = crumbleEntityFromPlatform(float);
    expect(e.getTriggerDelay()).toBe(CRUMBLE_DEFAULTS.triggerDelay);
    expect(e.getFallDuration()).toBe(CRUMBLE_DEFAULTS.fallDuration);
    expect(e.getRespawnDelay()).toBe(CRUMBLE_DEFAULTS.respawnDelay);
  });

  it('computePlatformColliderState resolves an inactive (mask=0) state for a fallen crumbler', () => {
    // The collision toggle is the central decision point — assert
    // its inactive short-circuit fires for the (pass-through,
    // isSolid=false) combination a fallen crumbler presents.
    const state = computePlatformColliderState({
      behavior: 'pass-through',
      passThrough: true,
      isSolid: false,
    });
    expect(state.mode).toBe('inactive');
    expect(state.mask).toBe(0);
    // Category preserved for debug overlays.
    expect(state.category).toBe(COLLISION_CATEGORIES.PLATFORM_PASS_THROUGH);
  });

  it('applyPlatformColliderState reports `false` when the body is already in the target state (no-op short-circuit)', () => {
    // Performance contract: the per-step toggle is called every frame
    // for every platform. When nothing has flipped, the applier must
    // report `false` so callers can skip downstream invalidation work.
    const body = makePassThroughPlatformBody();
    // Apply the canonical pass-through state — body already matches.
    const state = computePlatformColliderState({
      behavior: 'pass-through',
      passThrough: true,
      isSolid: true,
    });
    expect(applyPlatformColliderState(body, state)).toBe(false);
    // Apply a different state — applier reports a change.
    const inactive = computePlatformColliderState({
      behavior: 'pass-through',
      passThrough: true,
      isSolid: false,
    });
    expect(applyPlatformColliderState(body, inactive)).toBe(true);
    expect(body.collisionFilter.mask).toBe(0);
  });
});
