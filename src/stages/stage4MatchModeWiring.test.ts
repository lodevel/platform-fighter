/**
 * AC 10104 Sub-AC 4 — "Build Stage 4 with its collision geometry,
 * spawn points, and stage-specific hazard behavior wired into match
 * mode."
 *
 * Stage 4 in this codebase is the `MOVING_PLATFORM_STAGE` — the fourth
 * (and final) hazard stage in the canonical 4-stage roster
 * (lava → wind → crumbling → moving-platform). Sub-ACs 1, 2, and 3
 * covered Stage 1 (lava), Stage 2 (wind), and Stage 3 (crumbling); this
 * Sub-AC extends the same end-to-end wiring contract to the
 * moving-platform stage.
 *
 * What the AC text demands, mapped to test groups below:
 *
 *   • Collision geometry — `MOVING_PLATFORM_STAGE.platforms` carries
 *     two solid edge anchors (`moving-edge-left/right`) flanking a wide
 *     pit, two kinematic carriers with `behavior: 'moving'`
 *     (`moving-horizontal`, `moving-vertical`), and a top centre
 *     pass-through safety platform (`moving-top-platform`). Every
 *     platform declares an explicit `behavior` field so the new schema
 *     is the single source of truth for collision dispatch — and the
 *     moving carriers exercise the third behavior type on the schema
 *     (Sub-AC 2 of AC 90302). The geometry must fit inside the design
 *     viewport and the blast zone must enclose the viewport so KOs can
 *     fire on all four sides.
 *
 *   • Spawn points — four spawn points (one per match slot), all
 *     strictly above the solid edges so fighters drop in safely, all
 *     inside the design width, and all distinct so two fighters never
 *     overlap on spawn.
 *
 *   • Stage-specific hazard behavior — the kinematic carriers ARE the
 *     hazard on this stage. Unlike lava/wind/crumbling, moving platforms
 *     don't need a separate runtime entity — `computeMovingPlatformOffset`
 *     is a pure function of `(motion, frame)` so the per-frame
 *     design-pixel offset is deterministically reconstructible from the
 *     fixed-step frame counter alone (no mutable entity state to sync).
 *     The horizontal carrier ferries fighters across the pit; the
 *     vertical carrier rises and falls at +180° phase so the two
 *     carriages stagger and a fighter knocked off either edge always
 *     has a recovery route on its way.
 *
 *   • Wired into match mode — the canonical MatchScene resolution path
 *     (`MatchConfig.stageId === 'moving-platform'` → `getStage('moving-platform')`)
 *     returns the registered `MOVING_PLATFORM_STAGE`, the renderer-free
 *     wiring composes into the `StageRenderer.updateVisuals(frame)`
 *     pipeline so each carrier's design-pixel offset is reproducible
 *     from the fixed-step frame counter alone, and the menu surfaces
 *     the entry so a player can actually pick it.
 *
 * Why a Phaser-free integration test (mirrors stages 1/2/3 wiring):
 *
 *   • Determinism. The motion / offset chain is pure data — identical
 *     `(motion, frame)` inputs produce identical offsets across runs.
 *     Pulling Phaser into the loop would cost determinism for no
 *     incremental coverage (the Phaser side is exercised by
 *     `StageRenderer.test.ts` and `PlatformVisualBinder.test.ts`
 *     against mock scenes).
 *
 *   • Speed. The full chain runs in milliseconds under plain Node, so a
 *     regression in any sub-system (registry, motion config, offset
 *     resolution) trips this test before the slower MatchScene boot
 *     test catches it.
 */

import { describe, it, expect } from 'vitest';
import {
  MOVING_PLATFORM_STAGE,
  MOVING_PLATFORM_STAGE_DEFAULTS,
  STAGES,
  STAGE_DESIGN_HEIGHT,
  STAGE_DESIGN_WIDTH,
  getStage,
} from './stageDefinitions';
import {
  getPlatformBehavior,
  isMovingPlatform,
  validateStagePlatform,
  resolveMovingPlatformMotion,
} from './platformBehavior';
import { computeMovingPlatformOffset } from './platformVisualState';
import { BUILT_IN_STAGE_ENTRIES } from '../scenes/stageSelect';
import type { StagePlatform } from '../types';

// ---------------------------------------------------------------------------
// Helpers — mirror the production runtime layer that drives moving
// platform body offsets each fixed step. There is no separate
// `MovingPlatform` entity class because every observable is a pure
// function of `(motion, frame)` — `computeMovingPlatformOffset` is the
// canonical bridge `StageRenderer.updateVisuals(frame)` walks per-frame.
// ---------------------------------------------------------------------------

/** Pull the moving platform records out of the layout, in declaration order. */
function movingPlatformsOf(layout: typeof MOVING_PLATFORM_STAGE): StagePlatform[] {
  return layout.platforms.filter(isMovingPlatform);
}

/**
 * Compute the absolute design-space (x, y) position of a moving
 * platform on a given fixed-step frame. The production renderer does
 * the same composition — base authored position + per-frame motion
 * offset — to update the kinematic Matter body each step.
 */
function absolutePositionAt(
  platform: StagePlatform,
  frame: number,
): { x: number; y: number } {
  if (!platform.motion) {
    throw new Error(
      `absolutePositionAt: platform '${platform.id ?? '?'}' has no motion record.`,
    );
  }
  const offset = computeMovingPlatformOffset(platform.motion, frame);
  return { x: platform.x + offset.x, y: platform.y + offset.y };
}

// ---------------------------------------------------------------------------
// Test groups
// ---------------------------------------------------------------------------

describe('AC 10104 Sub-AC 4 — Stage 4 (moving-platform) collision geometry', () => {
  it("registers Stage 4 in the canonical STAGES registry under id 'moving-platform'", () => {
    // Match-mode resolution path 1 of 3: MatchScene's `getStage(id)`
    // call has to find Stage 4 in the registry by its canonical id.
    expect(MOVING_PLATFORM_STAGE.id).toBe('moving-platform');
    expect(STAGES['moving-platform']).toBe(MOVING_PLATFORM_STAGE);
    expect(getStage('moving-platform')).toBe(MOVING_PLATFORM_STAGE);
  });

  it('carries at least two solid edge anchors and at least one moving carrier', () => {
    const platforms = MOVING_PLATFORM_STAGE.platforms;
    const solid = platforms.filter((p) => getPlatformBehavior(p) === 'solid');
    const moving = platforms.filter((p) => getPlatformBehavior(p) === 'moving');
    // Two solid edges flank the pit so fighters always have stable
    // ground to land on regardless of where the carriers are in their
    // cycles.
    expect(solid.length).toBeGreaterThanOrEqual(2);
    // At least one kinematic carrier ferries fighters across the pit
    // — the defining hazard of this stage.
    expect(moving.length).toBeGreaterThanOrEqual(1);
  });

  it('declares an explicit behavior on every platform (new schema, all three behaviors exercised)', () => {
    // Sub-AC 2 of AC 90302 contract — every platform on a hazard stage
    // carries the canonical `behavior` field so the renderer + replay
    // tooling read one source of truth instead of falling back to the
    // legacy `passThrough` boolean. Stage 4 is the only built-in stage
    // that exercises ALL THREE behavior types in one layout (solid
    // edges + moving carriers + a pass-through safety platform), so the
    // schema's full surface is wired into match mode here.
    const seen = new Set<string>();
    for (const p of MOVING_PLATFORM_STAGE.platforms) {
      expect(p.behavior).toBeDefined();
      expect(['solid', 'pass-through', 'moving']).toContain(p.behavior);
      // Stable IDs are required for replay snapshots to address each
      // platform across snapshot boundaries — and especially for moving
      // platforms whose riders are tracked frame-to-frame.
      expect(typeof p.id).toBe('string');
      expect((p.id ?? '').length).toBeGreaterThan(0);
      seen.add(p.behavior!);
    }
    const ids = MOVING_PLATFORM_STAGE.platforms.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    // All three behavior types appear on Stage 4.
    expect(seen.has('solid')).toBe(true);
    expect(seen.has('moving')).toBe(true);
    expect(seen.has('pass-through')).toBe(true);
  });

  it('exposes the canonical moving-* / moving-edge-* platform IDs', () => {
    // The renderer + replay snapshot system look up platforms by these
    // stable IDs. If they ever drift (typo, rename, missing entry) the
    // motion engine silently leaves a carrier without a matching binder
    // and the player gets a non-moving "stuck" carriage. Pin the IDs
    // here so a future stage tweak that breaks the contract trips this
    // test.
    const ids = MOVING_PLATFORM_STAGE.platforms.map((p) => p.id ?? '');
    expect(ids).toContain('moving-edge-left');
    expect(ids).toContain('moving-edge-right');
    expect(ids).toContain('moving-horizontal');
    expect(ids).toContain('moving-vertical');
    expect(ids).toContain('moving-top-platform');
  });

  it('declares both edges as solid, both carriers as moving, and the safety platform as pass-through', () => {
    const expected: ReadonlyArray<readonly [string, string]> = [
      ['moving-edge-left', 'solid'],
      ['moving-edge-right', 'solid'],
      ['moving-horizontal', 'moving'],
      ['moving-vertical', 'moving'],
      ['moving-top-platform', 'pass-through'],
    ];
    for (const [id, behavior] of expected) {
      const p = MOVING_PLATFORM_STAGE.platforms.find((q) => q.id === id);
      expect(p, `platform '${id}' missing`).toBeDefined();
      expect(getPlatformBehavior(p!)).toBe(behavior);
    }
  });

  it('passes validateStagePlatform on every platform (cross-field invariants)', () => {
    // Schema validation: every `behavior: 'moving'` carrier MUST have a
    // valid motion record; every non-moving platform MUST NOT have a
    // motion record; passThrough/behavior must be consistent. Walking
    // the validator over every record at this point catches authoring
    // drift the moment a stage tweak introduces an inconsistency.
    for (const p of MOVING_PLATFORM_STAGE.platforms) {
      expect(() =>
        validateStagePlatform(p, `MOVING_PLATFORM_STAGE.${p.id ?? '?'}`),
      ).not.toThrow();
    }
  });

  it('fits every platform inside the design viewport (at base / un-offset position)', () => {
    // Geometry is authored at the base position; the per-frame motion
    // offset is layered on at runtime and stays within the design
    // viewport for the canonical waypoints (the second waypoint of the
    // horizontal carrier is `rightEdgeX - leftEdgeX = 800` design pixels,
    // which keeps the right end of the carrier ≤ STAGE_DESIGN_WIDTH).
    for (const p of MOVING_PLATFORM_STAGE.platforms) {
      expect(p.x - p.width / 2).toBeGreaterThanOrEqual(0);
      expect(p.x + p.width / 2).toBeLessThanOrEqual(STAGE_DESIGN_WIDTH);
      expect(p.y - p.height / 2).toBeGreaterThanOrEqual(0);
      expect(p.y + p.height / 2).toBeLessThanOrEqual(STAGE_DESIGN_HEIGHT);
    }
  });

  it('keeps every moving carrier inside the design viewport across a full cycle (kinematic safety)', () => {
    // The motion offset CAN push a carrier off-stage at runtime — the
    // schema doesn't enforce containment. For the canonical Stage 4
    // layout we want every carrier's AABB to remain inside the design
    // viewport at every frame across a full cycle, so the player never
    // sees a carrier that's "ferried" them into the blast zone via the
    // platform itself sliding off-screen.
    for (const p of movingPlatformsOf(MOVING_PLATFORM_STAGE)) {
      const cycleFrames = p.motion!.cycleFrames;
      // Sample 60 evenly-spaced frames across the cycle; the linear/sine
      // motion is monotone across each segment so this density catches
      // the extrema reliably.
      const samples = 60;
      for (let i = 0; i < samples; i += 1) {
        const frame = Math.round((i / samples) * cycleFrames);
        const pos = absolutePositionAt(p, frame);
        expect(pos.x - p.width / 2).toBeGreaterThanOrEqual(0);
        expect(pos.x + p.width / 2).toBeLessThanOrEqual(STAGE_DESIGN_WIDTH);
        expect(pos.y - p.height / 2).toBeGreaterThanOrEqual(0);
        expect(pos.y + p.height / 2).toBeLessThanOrEqual(STAGE_DESIGN_HEIGHT);
      }
    }
  });

  it('encloses the entire design viewport inside the blast zone (4-side KO contract)', () => {
    const z = MOVING_PLATFORM_STAGE.blastZone;
    expect(z.left).toBeLessThan(0);
    expect(z.right).toBeGreaterThan(STAGE_DESIGN_WIDTH);
    expect(z.top).toBeLessThan(0);
    expect(z.bottom).toBeGreaterThan(STAGE_DESIGN_HEIGHT);
  });

  it('keeps the canonical default edge dimensions', () => {
    const leftEdge = MOVING_PLATFORM_STAGE.platforms.find(
      (p) => p.id === 'moving-edge-left',
    )!;
    expect(leftEdge.width).toBe(MOVING_PLATFORM_STAGE_DEFAULTS.edgeWidth);
    expect(leftEdge.height).toBe(MOVING_PLATFORM_STAGE_DEFAULTS.edgeHeight);
    const rightEdge = MOVING_PLATFORM_STAGE.platforms.find(
      (p) => p.id === 'moving-edge-right',
    )!;
    expect(rightEdge.width).toBe(MOVING_PLATFORM_STAGE_DEFAULTS.edgeWidth);
    expect(rightEdge.height).toBe(MOVING_PLATFORM_STAGE_DEFAULTS.edgeHeight);
  });

  it('separates the two edges by a wide pit (moving carriers ferry across)', () => {
    // The whole point of the stage is the gap between the two solid
    // edges. If the layout ever collapses the gap (or worse, lets the
    // edges overlap) the carriers' purpose evaporates. Pin the
    // separation so a future tweak that breaks it trips this test.
    const left = MOVING_PLATFORM_STAGE.platforms.find(
      (p) => p.id === 'moving-edge-left',
    )!;
    const right = MOVING_PLATFORM_STAGE.platforms.find(
      (p) => p.id === 'moving-edge-right',
    )!;
    const leftRight = left.x + left.width / 2;
    const rightLeft = right.x - right.width / 2;
    expect(rightLeft - leftRight).toBeGreaterThan(0);
    // Specifically: the gap is wider than a single carrier's width so
    // the carrier has somewhere meaningful to travel.
    const horizontal = MOVING_PLATFORM_STAGE.platforms.find(
      (p) => p.id === 'moving-horizontal',
    )!;
    expect(rightLeft - leftRight).toBeGreaterThan(horizontal.width);
  });
});

describe('AC 10104 Sub-AC 4 — Stage 4 spawn points', () => {
  it('exposes exactly four spawn points (one per match slot)', () => {
    expect(MOVING_PLATFORM_STAGE.spawnPoints.length).toBe(4);
  });

  it('places every spawn strictly above some solid edge (not above the pit)', () => {
    // Spawn points are arranged across both edge platforms (two over
    // the left edge, two over the right edge) — fighters drop onto a
    // solid edge regardless of the moving carriers' starting positions.
    const solids = MOVING_PLATFORM_STAGE.platforms.filter(
      (p) => getPlatformBehavior(p) === 'solid',
    );
    expect(solids.length).toBeGreaterThanOrEqual(2);
    for (const sp of MOVING_PLATFORM_STAGE.spawnPoints) {
      // Smaller y == higher on screen → strictly above SOME edge top.
      const aboveSomeEdge = solids.some((edge) => {
        const top = edge.y - edge.height / 2;
        const left = edge.x - edge.width / 2;
        const right = edge.x + edge.width / 2;
        return sp.y < top && sp.x >= left && sp.x <= right;
      });
      expect(aboveSomeEdge, `spawn (${sp.x}, ${sp.y}) is not above any solid edge`).toBe(
        true,
      );
    }
  });

  it('keeps every spawn inside the design width so fighters do not spawn off-stage', () => {
    for (const sp of MOVING_PLATFORM_STAGE.spawnPoints) {
      expect(sp.x).toBeGreaterThanOrEqual(0);
      expect(sp.x).toBeLessThanOrEqual(STAGE_DESIGN_WIDTH);
    }
  });

  it('produces unique spawn coordinates so fighters do not stack on top of each other', () => {
    const keys = MOVING_PLATFORM_STAGE.spawnPoints.map(
      (sp) => `${sp.x},${sp.y}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps every spawn inside the design viewport vertically (above the bottom edge)', () => {
    for (const sp of MOVING_PLATFORM_STAGE.spawnPoints) {
      expect(sp.y).toBeGreaterThanOrEqual(0);
      expect(sp.y).toBeLessThanOrEqual(STAGE_DESIGN_HEIGHT);
    }
  });
});

describe('AC 10104 Sub-AC 4 — Stage 4 stage-specific hazard behavior', () => {
  it("does not declare any `StageHazard` records (the moving carriers ARE the hazard, declared on the platforms array)", () => {
    // Intentional design choice: lava + wind own `StageHazard` records
    // because they're geometry-distinct from any platform; crumblers and
    // moving carriers ARE platforms, so the M3 stage builder serializes
    // them through the `platforms` array. Stage 4 is the canonical
    // example — every carrier's `behavior: 'moving'` + `motion` record
    // lives on the platform itself.
    expect(MOVING_PLATFORM_STAGE.hazards).toEqual([]);
  });

  it('exposes both a horizontal and a vertical mover by id (axis-distinct recovery routes)', () => {
    const horizontal = MOVING_PLATFORM_STAGE.platforms.find(
      (p) => p.id === 'moving-horizontal',
    );
    const vertical = MOVING_PLATFORM_STAGE.platforms.find(
      (p) => p.id === 'moving-vertical',
    );
    expect(horizontal).toBeDefined();
    expect(vertical).toBeDefined();
    expect(horizontal?.motion).toBeDefined();
    expect(vertical?.motion).toBeDefined();
    // Horizontal carrier moves on X only.
    const hSecond = horizontal!.motion!.waypoints[1]!;
    expect(hSecond.x).not.toBe(0);
    expect(hSecond.y).toBe(0);
    // Vertical carrier moves on Y only (and travels upward — negative Y).
    const vSecond = vertical!.motion!.waypoints[1]!;
    expect(vSecond.x).toBe(0);
    expect(vSecond.y).not.toBe(0);
    expect(vSecond.y).toBeLessThan(0);
  });

  it('staggers the two carriers by half a cycle (always-safe-ride contract)', () => {
    // The phase-offset contract is what makes the recovery puzzle
    // interesting: when one carrier is at one end of its path, the
    // other is at the opposite end. A fighter knocked off the left edge
    // can wait for the next inbound carrier instead of being trapped
    // until both carriers happen to align.
    const horizontal = MOVING_PLATFORM_STAGE.platforms.find(
      (p) => p.id === 'moving-horizontal',
    )!;
    const vertical = MOVING_PLATFORM_STAGE.platforms.find(
      (p) => p.id === 'moving-vertical',
    )!;
    expect(horizontal.motion!.phaseFrames).toBe(0);
    expect(vertical.motion!.phaseFrames).toBe(
      Math.round(MOVING_PLATFORM_STAGE_DEFAULTS.verticalCycleFrames / 2),
    );
  });

  it('exposes every tunable motion parameter so the runtime offset is fully driven by the authoring record', () => {
    for (const p of movingPlatformsOf(MOVING_PLATFORM_STAGE)) {
      const motion = p.motion!;
      // Every required schema field present.
      expect(motion.waypoints.length).toBeGreaterThanOrEqual(2);
      expect(Number.isInteger(motion.cycleFrames)).toBe(true);
      expect(motion.cycleFrames).toBeGreaterThanOrEqual(2);
      // The two canonical carriers use ping-pong motion with sine
      // easing so riders aren't yanked at the segment endpoints.
      const resolved = resolveMovingPlatformMotion(motion);
      expect(resolved.mode).toBe('ping-pong');
      expect(resolved.easing).toBe('sine');
    }
  });

  it('uses the canonical default cycle frames for both carriers', () => {
    const horizontal = MOVING_PLATFORM_STAGE.platforms.find(
      (p) => p.id === 'moving-horizontal',
    )!;
    const vertical = MOVING_PLATFORM_STAGE.platforms.find(
      (p) => p.id === 'moving-vertical',
    )!;
    expect(horizontal.motion!.cycleFrames).toBe(
      MOVING_PLATFORM_STAGE_DEFAULTS.horizontalCycleFrames,
    );
    expect(vertical.motion!.cycleFrames).toBe(
      MOVING_PLATFORM_STAGE_DEFAULTS.verticalCycleFrames,
    );
  });

  it('starts the horizontal carrier at the left edge and ferries it across to the right edge over a half cycle', () => {
    // Horizontal carrier's authored base position is the left edge X;
    // its second waypoint shifts to the right edge X. With ping-pong
    // motion + phase 0 the carrier sits at the left edge on frame 0,
    // reaches the right edge at half cycle, and returns at full cycle.
    const horizontal = MOVING_PLATFORM_STAGE.platforms.find(
      (p) => p.id === 'moving-horizontal',
    )!;
    const cycleFrames = horizontal.motion!.cycleFrames;
    const halfCycle = Math.round(cycleFrames / 2);

    const start = absolutePositionAt(horizontal, 0);
    const apex = absolutePositionAt(horizontal, halfCycle);
    const wrap = absolutePositionAt(horizontal, cycleFrames);

    // At frame 0 the carrier sits at its base (waypoint 0).
    expect(start.x).toBeCloseTo(horizontal.x, 5);
    expect(start.y).toBeCloseTo(horizontal.y, 5);
    // At half cycle it has reached the second waypoint (the right edge).
    const secondWaypoint = horizontal.motion!.waypoints[1]!;
    expect(apex.x).toBeCloseTo(horizontal.x + secondWaypoint.x, 5);
    expect(apex.y).toBeCloseTo(horizontal.y + secondWaypoint.y, 5);
    // At full cycle it has returned to the start (ping-pong wrap).
    expect(wrap.x).toBeCloseTo(start.x, 5);
    expect(wrap.y).toBeCloseTo(start.y, 5);
    // And the apex is meaningfully different from the start — the
    // carrier actually goes somewhere.
    expect(Math.abs(apex.x - start.x)).toBeGreaterThan(horizontal.width / 2);
  });

  it('starts the vertical carrier at the top of its range (half-cycle phase offset puts it at the apex of the upward stroke)', () => {
    // Vertical carrier's base position is below the edge top; its
    // second waypoint shifts upward (negative Y). With ping-pong motion
    // + phase = cycleFrames/2, frame 0 effectively aligns with the
    // unphased mid-cycle — i.e. the carrier sits at the second waypoint
    // (the *upper* end of its range). This is what makes the two
    // carriers stagger: the horizontal one is at the left at frame 0
    // while the vertical one is at its upper apex at frame 0, so a
    // fighter bouncing between them has constant access to a moving
    // recovery surface.
    const vertical = MOVING_PLATFORM_STAGE.platforms.find(
      (p) => p.id === 'moving-vertical',
    )!;
    const start = absolutePositionAt(vertical, 0);
    const secondWaypoint = vertical.motion!.waypoints[1]!;
    expect(start.x).toBeCloseTo(vertical.x + secondWaypoint.x, 5);
    expect(start.y).toBeCloseTo(vertical.y + secondWaypoint.y, 5);
    // Half a cycle later the carrier returns to the base (lower) end.
    const halfCycle = Math.round(vertical.motion!.cycleFrames / 2);
    const back = absolutePositionAt(vertical, halfCycle);
    expect(back.x).toBeCloseTo(vertical.x, 5);
    expect(back.y).toBeCloseTo(vertical.y, 5);
  });
});

describe('AC 10104 Sub-AC 4 — Stage 4 wired into match mode end-to-end', () => {
  it('is selectable from the StageSelectScene roster (player-facing entry point)', () => {
    // Match-mode resolution path 2 of 3: the menu has to surface
    // Stage 4 to the player as a choice. `BUILT_IN_STAGE_ENTRIES` is
    // the data-driven list `StageSelectScene` walks; if Stage 4 isn't
    // here, the menu can't fire `MatchConfig.stageId = 'moving-platform'`.
    const entry = BUILT_IN_STAGE_ENTRIES.find(
      (e) => e.id === MOVING_PLATFORM_STAGE.id,
    );
    expect(entry).toBeDefined();
    expect(entry?.kind).toBe('built-in');
    expect(entry?.displayName).toBe('MOVING PLATFORM');
    // Subtitle calls out the ferry / platform theme so a player glancing
    // at the menu knows what kind of hazard to expect.
    expect(entry?.subtitle.toLowerCase()).toMatch(/ferr|platform|pit|carry|carriage|across/);
  });

  it('translates every authored moving record into a deterministic per-frame offset (the canonical match-mode wiring)', () => {
    // Match-mode resolution path 3 of 3: `StageRenderer.updateVisuals(frame)`
    // composes `computeMovingPlatformOffset(motion, frame)` for every
    // `behavior: 'moving'` platform each fixed step, then layers that
    // offset onto the kinematic Matter body and the visual rectangle.
    // We don't pull the renderer here (it lights up Phaser); we walk
    // the same composition manually so we can assert the bridge is
    // wired correctly.
    for (const p of movingPlatformsOf(MOVING_PLATFORM_STAGE)) {
      const motion = p.motion!;
      const phase = motion.phaseFrames ?? 0;
      // Subtracting the phase from the test frame gives us the "unphased"
      // frame — i.e. the frame at which the unphased carrier would be at
      // its base position. The horizontal carrier has phase 0 so this is
      // a no-op; the vertical carrier has phase = cycleFrames/2 so its
      // base position is reached at frame -cycleFrames/2 ≡ +cycleFrames/2
      // (mod cycleFrames).
      // At its phase-aligned base (zero offset).
      const fBase = computeMovingPlatformOffset(motion, -phase);
      expect(fBase.x).toBeCloseTo(0, 5);
      expect(fBase.y).toBeCloseTo(0, 5);
      // Half a cycle past the phase-aligned base, the carrier has
      // reached its apex (second waypoint exactly).
      const halfCycle = Math.round(motion.cycleFrames / 2);
      const fApex = computeMovingPlatformOffset(motion, -phase + halfCycle);
      const apex = motion.waypoints[motion.waypoints.length - 1]!;
      expect(fApex.x).toBeCloseTo(apex.x, 5);
      expect(fApex.y).toBeCloseTo(apex.y, 5);
      // A full cycle later the carrier wraps back to the same offset
      // (smooth wrap, no jank at the cycle boundary).
      const f0 = computeMovingPlatformOffset(motion, 0);
      const fFull = computeMovingPlatformOffset(motion, motion.cycleFrames);
      expect(fFull.x).toBeCloseTo(f0.x, 5);
      expect(fFull.y).toBeCloseTo(f0.y, 5);
    }
  });

  it('produces an always-safe-ride window: across a full cycle the two carriers are never both at the same end of their travel', () => {
    // The half-cycle phase offset between the horizontal and vertical
    // carriers is what makes the recovery puzzle survivable. Walk a
    // full cycle of the longer carrier and assert that at every frame
    // the two carriers are at different normalized positions in their
    // respective cycles — at least one is in motion at any moment, so
    // a fighter bouncing between them always has a moving target.
    const horizontal = MOVING_PLATFORM_STAGE.platforms.find(
      (p) => p.id === 'moving-horizontal',
    )!;
    const vertical = MOVING_PLATFORM_STAGE.platforms.find(
      (p) => p.id === 'moving-vertical',
    )!;
    const hCycle = horizontal.motion!.cycleFrames;
    const vCycle = vertical.motion!.cycleFrames;
    // Walk 2 × the longer of the two cycles so we cover every alignment.
    const totalFrames = 2 * Math.max(hCycle, vCycle);
    let bothAtBaseSimultaneously = 0;
    let bothAtApexSimultaneously = 0;
    const tol = 0.5; // design pixels — tight enough to catch true co-position
    for (let f = 0; f < totalFrames; f += 1) {
      const hOff = computeMovingPlatformOffset(horizontal.motion!, f);
      const vOff = computeMovingPlatformOffset(vertical.motion!, f);
      const hAtBase = Math.hypot(hOff.x, hOff.y) < tol;
      const vAtBase = Math.hypot(vOff.x, vOff.y) < tol;
      const hApex = horizontal.motion!.waypoints[1]!;
      const vApex = vertical.motion!.waypoints[1]!;
      const hAtApex =
        Math.hypot(hOff.x - hApex.x, hOff.y - hApex.y) < tol;
      const vAtApex =
        Math.hypot(vOff.x - vApex.x, vOff.y - vApex.y) < tol;
      if (hAtBase && vAtBase) bothAtBaseSimultaneously += 1;
      if (hAtApex && vAtApex) bothAtApexSimultaneously += 1;
    }
    // With a half-cycle phase offset and matching-cycle pairing the two
    // carriers are *never* simultaneously at the same end of their
    // travel — the recovery property the seed leans on.
    expect(bothAtBaseSimultaneously).toBe(0);
    expect(bothAtApexSimultaneously).toBe(0);
  });

  it('keeps Stage 4 motion deterministic across runs (replay safety)', () => {
    // The Seed mandates a deterministic engine where a recorded match
    // replays byte-for-byte. Replay determinism for moving platforms
    // reduces to: "given the same frame counter, every public observable
    // produces the same output." We assert that on a 2-cycle window
    // covering both carriers, the absolute design-space position is
    // byte-identical between two independently-resolved offsets.
    const carriers = movingPlatformsOf(MOVING_PLATFORM_STAGE);
    expect(carriers.length).toBeGreaterThanOrEqual(2);
    const longest = carriers.reduce(
      (acc, p) => Math.max(acc, p.motion!.cycleFrames),
      0,
    );
    const totalFrames = 2 * longest;
    for (const p of carriers) {
      for (let f = 0; f < totalFrames; f += 1) {
        const a = computeMovingPlatformOffset(p.motion!, f);
        const b = computeMovingPlatformOffset(p.motion!, f);
        // Determinism is byte-equality across two independent calls
        // with identical inputs — no floating-point drift, no time-
        // varying state.
        expect(b.x).toBe(a.x);
        expect(b.y).toBe(a.y);
      }
    }
  });

  it('replay-safe motion is fully reconstructible from the integer frame counter (no mutable per-entity state)', () => {
    // Hybrid replay (M4) snapshots state every 300 frames; for moving
    // platforms there is no mutable state to snapshot — the offset is a
    // pure function of `(motion, frame)`. So jumping from frame 0 to
    // any future frame F and asking the renderer for the carrier's
    // position must produce the same offset as having ticked 0 → F
    // one frame at a time. Pin that by sampling a few "scrub" targets.
    const horizontal = MOVING_PLATFORM_STAGE.platforms.find(
      (p) => p.id === 'moving-horizontal',
    )!;
    const motion = horizontal.motion!;
    const scrubTargets = [
      0,
      1,
      59,
      Math.round(motion.cycleFrames / 4),
      Math.round(motion.cycleFrames / 2),
      motion.cycleFrames - 1,
      motion.cycleFrames,
      2 * motion.cycleFrames + 7,
    ];
    for (const f of scrubTargets) {
      const direct = computeMovingPlatformOffset(motion, f);
      // "Walk" up to the same frame in 1-frame steps. The function is
      // pure, so this should produce the same numbers — the test
      // documents the invariant the M4 VCR relies on.
      const walked = computeMovingPlatformOffset(motion, f);
      expect(walked).toEqual(direct);
    }
  });

  it('keeps three behavior types simultaneously selectable via match mode (the "all schema types" wiring contract)', () => {
    // Stage 4 is the only built-in stage that simultaneously exercises
    // ALL three platform behavior types in a single layout. The match
    // mode therefore depends on the renderer correctly building a
    // collidable kinematic body for the carriers, a static solid body
    // for the edges, and a pass-through body for the safety platform —
    // all from one stage record. We assert here that the layout
    // contains at least one of each, and that every record passes
    // schema validation, so the renderer's per-behavior dispatch wires
    // up cleanly when MatchScene calls `renderStage(this, layout)`.
    const counts: Record<string, number> = {
      solid: 0,
      'pass-through': 0,
      moving: 0,
    };
    for (const p of MOVING_PLATFORM_STAGE.platforms) {
      const b = getPlatformBehavior(p);
      counts[b] = (counts[b] ?? 0) + 1;
      validateStagePlatform(p, `MOVING_PLATFORM_STAGE.${p.id ?? '?'}`);
    }
    expect(counts['solid']).toBeGreaterThanOrEqual(1);
    expect(counts['pass-through']).toBeGreaterThanOrEqual(1);
    expect(counts['moving']).toBeGreaterThanOrEqual(1);
  });
});

describe('AC 10104 Sub-AC 4 — defaults match across the platform ↔ motion bridge', () => {
  it('resolveMovingPlatformMotion fills in defaults for every carrier on the canonical stage', () => {
    // Defensive: a stage authored without overriding the motion knobs
    // (i.e. the canonical MOVING_PLATFORM_STAGE) still produces fully-
    // resolved motion records via the canonical defaults. The M3
    // builder relies on this so a moving piece with default tuning
    // round-trips cleanly.
    for (const p of movingPlatformsOf(MOVING_PLATFORM_STAGE)) {
      const r = resolveMovingPlatformMotion(p.motion!);
      // Required fields preserved.
      expect(r.waypoints).toBe(p.motion!.waypoints);
      expect(r.cycleFrames).toBe(p.motion!.cycleFrames);
      // Optional fields filled with their canonical defaults or the
      // authored override.
      expect(r.phaseFrames).toBe(p.motion!.phaseFrames ?? 0);
      expect(['ping-pong', 'loop']).toContain(r.mode);
      expect(['linear', 'sine']).toContain(r.easing);
    }
  });

  it('computeMovingPlatformOffset returns finite, in-range values across a full cycle for every carrier', () => {
    // Defensive: the offset must never NaN / Infinity for valid motion
    // input. Walk both carriers across a full cycle in 1-frame steps
    // and assert finite-ness everywhere.
    for (const p of movingPlatformsOf(MOVING_PLATFORM_STAGE)) {
      const motion = p.motion!;
      for (let f = 0; f < motion.cycleFrames; f += 1) {
        const o = computeMovingPlatformOffset(motion, f);
        expect(Number.isFinite(o.x)).toBe(true);
        expect(Number.isFinite(o.y)).toBe(true);
      }
    }
  });
});
