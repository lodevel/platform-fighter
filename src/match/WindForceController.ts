/**
 * AC 10102 Sub-AC 2 — wind → fighter force adapter that applies the
 * directional gust to any fighter overlapping a wind zone while the
 * gust is active.
 *
 * `WindForceController` is the fourth member of the collision-adapter
 * family (alongside {@link BlastZoneWatcher}, {@link HitboxDamageHandler},
 * and {@link LavaCollisionWatcher}): a thin, Phaser-free, fully-
 * deterministic shim that sits between Matter.js' collision-pair
 * stream and a single domain callback. Where `LavaCollisionWatcher`
 * says "this fighter just touched **active** lava — KO them on the
 * spot," `WindForceController` says "this fighter is in **active**
 * wind right now — apply this frame's force vector to them."
 *
 * Why a *separate* controller (not a feature flag on
 * `LavaCollisionWatcher`):
 *
 *   • **Continuous vs. one-shot.** Lava is one-shot: cross the active
 *     threshold while overlapping → KO once, then re-arm requires an
 *     end+start cycle. Wind is continuous: every fixed step where a
 *     fighter overlaps an active wind zone, force is applied. Folding
 *     the two into one watcher would force every reader to disambiguate
 *     "did this just fire once or every frame?" via runtime flags.
 *
 *   • **Force-vector callback shape.** Lava's callback is
 *     `(playerIndex, hazardId)` — a labelled instant-KO event. Wind's
 *     callback is `(playerIndex, hazardId, force)` — the per-frame
 *     impulse to apply. Clean type separation here keeps every
 *     downstream test fixture honest.
 *
 *   • **Determinism.** `tick()` consumes only the registry, the
 *     overlap set, and `WindZoneHazard.getCurrentForce()` — all
 *     deterministic. Replays driving identical pair streams produce
 *     identical force vectors in identical order across runs.
 *
 * Wire-up in the gameplay scene:
 *
 *     const controller = new WindForceController(
 *       (playerIndex, hazardId, force) => {
 *         // Apply force to the body — Matter.Body.applyForce or
 *         // velocity nudge depending on the engine wrapper.
 *         body.velocity.x += force.x;
 *         body.velocity.y += force.y;
 *       },
 *     );
 *
 *     for (const hazard of windHazards) {
 *       controller.registerHazard(hazard.entity, hazard.body);
 *     }
 *     for (let i = 0; i < fighters.length; i += 1) {
 *       controller.registerPlayer(i, fighters[i].body);
 *     }
 *
 *     scene.matter.world.on('collisionstart', e =>
 *       controller.handleCollisionStart(e),
 *     );
 *     scene.matter.world.on('collisionend', e =>
 *       controller.handleCollisionEnd(e),
 *     );
 *
 *     // Once per fixed step, after physics has advanced and the
 *     // hazard has ticked:
 *     controller.tick();
 *
 * Active-state gating:
 *
 *   The controller asks `hazard.isActive()` each `tick()` before
 *   firing the callback — a wind zone whose cosine magnitude is below
 *   its `activeThreshold` produces no force, matching the seed's
 *   "tactically meaningful airborne windows" pacing where the gust
 *   has predictable quiet phases the player can plan around.
 */

import type { WindZoneHazard, WindForceVector } from '../entities/WindZoneHazard';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Minimal shape of a Matter body the controller needs to inspect. */
export interface WindMinimalBody {
  /** Optional label — used for debug logs only; identity comes from registry. */
  readonly label?: string | null;
}

/** Shape of a Matter collision pair we care about. */
export interface WindCollisionPair {
  readonly bodyA: WindMinimalBody | null | undefined;
  readonly bodyB: WindMinimalBody | null | undefined;
}

export interface WindCollisionEvent {
  readonly pairs: ReadonlyArray<WindCollisionPair>;
}

/**
 * Callback fired every fixed step that `playerIndex` overlaps a
 * registered wind hazard while that hazard is active. Receives the
 * per-frame force vector to apply (in design px/frame²; the caller
 * scales by viewport if needed). Unlike the lava watcher, this fires
 * *every* tick the overlap is active — wind is continuous.
 */
export type WindForceCallback = (
  playerIndex: number,
  hazardId: string,
  force: WindForceVector,
) => void;

/**
 * Conventional Matter `label` prefix for wind hazard sensor bodies.
 * The `WindHazardRenderer` (and the post-M3 stage builder export)
 * stamp wind sensor bodies with `'hazard.wind.<id>'`. Labels aren't
 * required for the controller to fire (registry membership is the
 * source of truth) but they make Matter's debug overlay readable.
 */
export const WIND_HAZARD_LABEL_PREFIX = 'hazard.wind.';

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

/**
 * Wind-vs-fighter force adapter. Tracks which fighters are overlapping
 * which wind zones and, on `tick()`, fires a force-application callback
 * for every overlap whose hazard is currently active.
 *
 * State: two registries (player/body, hazard/body) and one overlap set.
 * Unlike {@link LavaCollisionWatcher}, there is no "fired" guard —
 * wind is continuous, so every active tick yields one callback.
 */
export class WindForceController {
  // ------------------------- Player registry -----------------------------
  private readonly players: Map<number, WindMinimalBody> = new Map();
  private readonly playerBodyToIndex: Map<WindMinimalBody, number> = new Map();

  // ------------------------- Hazard registry -----------------------------
  private readonly hazardsById: Map<string, WindZoneHazard> = new Map();
  private readonly hazardBodyToId: Map<WindMinimalBody, string> = new Map();

  // ------------------------- Overlap state -------------------------------
  /**
   * Set of currently-overlapping `(playerIndex, hazardId)` pairs, keyed
   * by an opaque string. Population: filled by `handleCollisionStart`,
   * drained by `handleCollisionEnd`. Entries persist across ticks until
   * the fighter leaves the wind body — every active tick fires a force
   * callback.
   */
  private readonly overlaps: Map<
    string,
    { playerIndex: number; hazardId: string }
  > = new Map();

  private readonly callback: WindForceCallback;

  constructor(callback: WindForceCallback) {
    if (typeof callback !== 'function') {
      throw new Error('WindForceController: callback must be a function');
    }
    this.callback = callback;
  }

  // -------------------------------------------------------------------------
  // Player registration
  // -------------------------------------------------------------------------

  registerPlayer(playerIndex: number, body: WindMinimalBody): void {
    if (!Number.isInteger(playerIndex) || playerIndex < 0) {
      throw new Error(
        `WindForceController: invalid playerIndex ${playerIndex}`,
      );
    }
    if (!body) {
      throw new Error(
        `WindForceController: registerPlayer requires a body (got ${String(body)})`,
      );
    }
    const existing = this.players.get(playerIndex);
    if (existing) {
      this.playerBodyToIndex.delete(existing);
      this.dropOverlapsForPlayer(playerIndex);
    }
    this.players.set(playerIndex, body);
    this.playerBodyToIndex.set(body, playerIndex);
  }

  unregisterPlayer(playerIndex: number): void {
    const body = this.players.get(playerIndex);
    if (body) this.playerBodyToIndex.delete(body);
    this.players.delete(playerIndex);
    this.dropOverlapsForPlayer(playerIndex);
  }

  isRegistered(playerIndex: number): boolean {
    return this.players.has(playerIndex);
  }

  // -------------------------------------------------------------------------
  // Hazard registration
  // -------------------------------------------------------------------------

  registerHazard(hazard: WindZoneHazard, body: WindMinimalBody): void {
    if (!hazard || typeof hazard.getId !== 'function') {
      throw new Error(
        'WindForceController: registerHazard requires a WindZoneHazard',
      );
    }
    if (!body) {
      throw new Error(
        `WindForceController: registerHazard requires a body (got ${String(body)})`,
      );
    }
    const id = hazard.getId();
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error(
        'WindForceController: hazard.getId() must be a non-empty string',
      );
    }
    for (const [b, hid] of this.hazardBodyToId) {
      if (hid === id) {
        this.hazardBodyToId.delete(b);
        break;
      }
    }
    this.hazardsById.set(id, hazard);
    this.hazardBodyToId.set(body, id);
    this.dropOverlapsForHazard(id);
  }

  unregisterHazard(hazardId: string): void {
    if (!this.hazardsById.has(hazardId)) return;
    this.hazardsById.delete(hazardId);
    for (const [b, hid] of this.hazardBodyToId) {
      if (hid === hazardId) {
        this.hazardBodyToId.delete(b);
        break;
      }
    }
    this.dropOverlapsForHazard(hazardId);
  }

  isHazardRegistered(hazardId: string): boolean {
    return this.hazardsById.has(hazardId);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  reset(): void {
    this.players.clear();
    this.playerBodyToIndex.clear();
    this.hazardsById.clear();
    this.hazardBodyToId.clear();
    this.overlaps.clear();
  }

  getOverlapCount(): number {
    return this.overlaps.size;
  }

  // -------------------------------------------------------------------------
  // Collision-stream handlers
  // -------------------------------------------------------------------------

  handleCollisionStart(event: WindCollisionEvent): void {
    if (!event || !event.pairs || event.pairs.length === 0) return;
    for (const pair of event.pairs) {
      const resolved = this.resolvePair(pair);
      if (!resolved) continue;
      const key = makeOverlapKey(resolved.playerIndex, resolved.hazardId);
      if (!this.overlaps.has(key)) {
        this.overlaps.set(key, {
          playerIndex: resolved.playerIndex,
          hazardId: resolved.hazardId,
        });
      }
    }
  }

  handleCollisionEnd(event: WindCollisionEvent): void {
    if (!event || !event.pairs || event.pairs.length === 0) return;
    for (const pair of event.pairs) {
      const resolved = this.resolvePair(pair);
      if (!resolved) continue;
      const key = makeOverlapKey(resolved.playerIndex, resolved.hazardId);
      this.overlaps.delete(key);
    }
  }

  // -------------------------------------------------------------------------
  // Per-step force emission
  // -------------------------------------------------------------------------

  /**
   * Once-per-fixed-step scan: for every active overlap, fire the force
   * callback iff the underlying `WindZoneHazard.isActive()` returns
   * true. Continuous: a sustained overlap fires once per tick — wind
   * is supposed to push every frame.
   *
   * Iteration order: ascending `(playerIndex, hazardId)` so the
   * callback ordering is deterministic across runs regardless of the
   * underlying Map's insertion-order quirks. The list is snapshotted
   * up-front so a callback that mutates the registry is safe.
   */
  tick(): void {
    if (this.overlaps.size === 0) return;
    const snapshot = Array.from(this.overlaps.values()).sort(compareOverlap);
    for (const entry of snapshot) {
      const hazard = this.hazardsById.get(entry.hazardId);
      if (!hazard) continue;
      if (!hazard.isActive()) continue;
      if (!this.players.has(entry.playerIndex)) continue;
      const force = hazard.getCurrentForce();
      this.callback(entry.playerIndex, entry.hazardId, force);
    }
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private resolvePair(
    pair: WindCollisionPair,
  ): { readonly playerIndex: number; readonly hazardId: string } | null {
    const a = pair?.bodyA ?? null;
    const b = pair?.bodyB ?? null;
    if (!a || !b) return null;

    const aPlayer = this.playerBodyToIndex.get(a);
    const bPlayer = this.playerBodyToIndex.get(b);
    const aHazard = this.hazardBodyToId.get(a);
    const bHazard = this.hazardBodyToId.get(b);

    let playerIndex: number | undefined;
    let hazardId: string | undefined;
    if (aPlayer !== undefined && bHazard !== undefined) {
      playerIndex = aPlayer;
      hazardId = bHazard;
    } else if (bPlayer !== undefined && aHazard !== undefined) {
      playerIndex = bPlayer;
      hazardId = aHazard;
    } else {
      return null;
    }

    if (
      (aPlayer !== undefined && aHazard !== undefined) ||
      (bPlayer !== undefined && bHazard !== undefined)
    ) {
      return null;
    }

    return { playerIndex, hazardId };
  }

  private dropOverlapsForPlayer(playerIndex: number): void {
    for (const key of Array.from(this.overlaps.keys())) {
      const entry = this.overlaps.get(key)!;
      if (entry.playerIndex === playerIndex) this.overlaps.delete(key);
    }
  }

  private dropOverlapsForHazard(hazardId: string): void {
    for (const key of Array.from(this.overlaps.keys())) {
      const entry = this.overlaps.get(key)!;
      if (entry.hazardId === hazardId) this.overlaps.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers (not exported)
// ---------------------------------------------------------------------------

function makeOverlapKey(playerIndex: number, hazardId: string): string {
  return `${playerIndex}:${hazardId}`;
}

function compareOverlap(
  a: { playerIndex: number; hazardId: string },
  b: { playerIndex: number; hazardId: string },
): number {
  if (a.playerIndex !== b.playerIndex) return a.playerIndex - b.playerIndex;
  if (a.hazardId < b.hazardId) return -1;
  if (a.hazardId > b.hazardId) return 1;
  return 0;
}
