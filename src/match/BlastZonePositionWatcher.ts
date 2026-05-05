/**
 * Sub-AC 2 of AC 60202 — position-based KO detection system.
 *
 * `BlastZonePositionWatcher` is the per-tick position-check counterpart
 * to {@link BlastZoneWatcher}. The collision-based watcher catches the
 * normal case where Matter fires a `collisionstart` event when a body
 * touches a blast-zone sensor; this position-based watcher catches the
 * edge cases the collision watcher cannot:
 *
 *   • **Tunnelling.** A character launched at terminal velocity past
 *     the blast-zone wall in a single 16.67 ms step can clip through a
 *     thin sensor body without ever firing a `collisionstart` event.
 *     Position-based detection compares the post-step centre-of-mass
 *     against the four absolute boundaries — no body shape, no risk
 *     of missing a fast-moving KO.
 *
 *   • **Resync after a replay snapshot.** The hybrid replay system
 *     (M4) snapshots state every 300 frames. If the player rewinds
 *     into a snapshot where a fighter is *already* outside the blast
 *     zone but the original collision event has already been
 *     "consumed" pre-snapshot, position-based detection still fires
 *     the KO on the first post-resync frame.
 *
 *   • **Determinism.** Position checks are pure math — given the same
 *     fighter coordinates, they fire on the same frame across every
 *     replay run. Matter collision-pair ordering depends on broadphase
 *     traversal, which can shift if a sensor body is added or removed
 *     mid-step (e.g. when a stage hazard spawns its own debris in M2).
 *
 * Frame model & call convention:
 *
 *   The scene calls {@link update} once per fixed 60 Hz physics step
 *   *after* `matter.world.step`. The watcher reads each registered
 *   fighter's `body.position`, compares it against the configured
 *   {@link BlastZone}, and fires the KO callback for every fighter
 *   whose centre-of-mass crosses any edge.
 *
 *   To stay in lockstep with `BlastZoneWatcher`, the same idempotency
 *   contract applies: a fighter that lingers past the boundary for
 *   multiple frames still only fires the callback ONCE — on the
 *   leading-edge crossing. The watcher latches an internal
 *   "out-of-bounds" flag per player and clears it via
 *   {@link clearOutOfBounds} when the fighter is teleported back to
 *   their spawn point during respawn.
 *
 * Phaser-free, deterministic, and reusable:
 *
 *   • The `PositionedBody` shape is a strict subset of `MatterJS.BodyType`
 *     (just `body.position.{x,y}`), so unit tests can construct fake
 *     bodies as plain objects — same pattern used by the rest of `match/`.
 *
 *   • The watcher does not own a clock; the caller passes
 *     `currentFrame` through to {@link update} so the same
 *     deterministic frame counter that drives `StockTracker` and the
 *     replay buffer also stamps each KO event.
 *
 *   • The KO event includes the *edge* (`top` / `bottom` / `left` /
 *     `right`) and the centre-of-mass at crossing time so HUD/camera
 *     code can pick a direction-appropriate KO sting and shake.
 */

import type { BlastZone } from '../types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** The four blast-zone edges. Mirrors the labels in `StageRenderer`. */
export type BlastZoneEdge = 'top' | 'bottom' | 'left' | 'right';

/**
 * Minimum shape of the bodies the watcher needs. Mirrors `Character.body`
 * via duck-typing so unit tests can pass plain `{ position: { x, y } }`
 * fixtures and production code can pass the live `MatterJS.BodyType`.
 */
export interface PositionedBody {
  readonly position: { readonly x: number; readonly y: number };
}

/**
 * Description of a single KO emission. Includes everything the caller
 * needs to drive a stock loss, KO sting, and direction-aware camera
 * shake without re-reading the body's position (which may have moved
 * by the time the event handler runs in a callback chain).
 */
export interface KoEvent {
  readonly playerIndex: number;
  readonly edge: BlastZoneEdge;
  readonly frame: number;
  readonly position: { readonly x: number; readonly y: number };
}

/** Callback fired exactly once per (player, KO) pair. */
export type KoCallback = (event: KoEvent) => void;

// ---------------------------------------------------------------------------
// Edge resolution order
// ---------------------------------------------------------------------------

/**
 * Deterministic priority order when a body has crossed multiple edges
 * in the same frame (a "corner KO" — e.g. flung off the top-right).
 *
 * The order matches Smash Bros' visual convention:
 *
 *   1. `top` — the upward "STAR" KO is the most spectacular, so when
 *      a fighter clears both the top and a side edge the same frame,
 *      attribute it to the top.
 *   2. `bottom` — pit KO; rare but visually distinct.
 *   3. `left`, then `right` — side blast offs.
 *
 * The order matters for replays and for the HUD's KO sting selection,
 * so it's exposed as a constant rather than baked into the function.
 */
export const BLAST_ZONE_EDGE_PRIORITY: ReadonlyArray<BlastZoneEdge> = [
  'top',
  'bottom',
  'left',
  'right',
];

// ---------------------------------------------------------------------------
// Watcher
// ---------------------------------------------------------------------------

/**
 * Per-tick position-based KO detector. One instance per match.
 *
 * Lifecycle:
 *
 *   const watcher = new BlastZonePositionWatcher(stage.blastZone, (event) =>
 *     stockTracker.loseStock(event.playerIndex, event.frame),
 *   );
 *   watcher.registerPlayer(0, p1.body);
 *   watcher.registerPlayer(1, p2.body);
 *
 *   // …in the per-step physics callback, AFTER matter.world.step:
 *   const koEvents = watcher.update(physics.getFrame());
 *
 *   // …on respawn:
 *   watcher.clearOutOfBounds(playerIndex);
 *
 *   // …on shutdown:
 *   watcher.reset();
 */
export class BlastZonePositionWatcher {
  private readonly players: Map<number, PositionedBody> = new Map();
  private readonly outOfBounds: Set<number> = new Set();
  private readonly callback: KoCallback;
  private blastZone: BlastZone;

  constructor(blastZone: BlastZone, callback: KoCallback) {
    BlastZonePositionWatcher.assertValidBlastZone(blastZone);
    this.blastZone = blastZone;
    this.callback = callback;
  }

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  /**
   * Register a player's body for per-tick KO scanning. Registering the
   * same player twice replaces the previous body and clears the
   * out-of-bounds latch — the new body has not yet been proven
   * out-of-bounds.
   */
  registerPlayer(playerIndex: number, body: PositionedBody): void {
    if (!Number.isInteger(playerIndex) || playerIndex < 0) {
      throw new Error(
        `BlastZonePositionWatcher: invalid playerIndex ${playerIndex}`,
      );
    }
    if (!body || !body.position || typeof body.position.x !== 'number' || typeof body.position.y !== 'number') {
      throw new Error(
        `BlastZonePositionWatcher: body for playerIndex ${playerIndex} must expose { position: { x: number, y: number } }`,
      );
    }
    this.players.set(playerIndex, body);
    this.outOfBounds.delete(playerIndex);
  }

  /**
   * Stop watching `playerIndex`. Used when a player is eliminated and
   * their body is despawned. Idempotent — safe to call for a slot that
   * isn't registered.
   */
  unregisterPlayer(playerIndex: number): void {
    this.players.delete(playerIndex);
    this.outOfBounds.delete(playerIndex);
  }

  /** True iff `playerIndex` is currently registered. */
  isRegistered(playerIndex: number): boolean {
    return this.players.has(playerIndex);
  }

  /**
   * True iff `playerIndex` has been latched out-of-bounds and is
   * awaiting a `clearOutOfBounds` call (typically driven by a
   * respawn). The position scan does NOT re-emit a KO for a player
   * already in this state.
   */
  isOutOfBounds(playerIndex: number): boolean {
    return this.outOfBounds.has(playerIndex);
  }

  /**
   * Clear the out-of-bounds latch for `playerIndex`. Called by the
   * respawn pipeline once the fighter has been teleported back to
   * their spawn point so subsequent boundary crossings re-arm the
   * KO event. Idempotent.
   */
  clearOutOfBounds(playerIndex: number): void {
    this.outOfBounds.delete(playerIndex);
  }

  /**
   * Replace the active blast-zone rectangle (e.g. when the scene
   * transitions to a new stage). Per-player out-of-bounds latches are
   * cleared because the new geometry may put a previously-KO'd body
   * back in-bounds.
   */
  setBlastZone(blastZone: BlastZone): void {
    BlastZonePositionWatcher.assertValidBlastZone(blastZone);
    this.blastZone = blastZone;
    this.outOfBounds.clear();
  }

  /** Read-only view of the active blast-zone rectangle. */
  getBlastZone(): BlastZone {
    return this.blastZone;
  }

  /**
   * Drop every registered player and clear all latches. Used on scene
   * shutdown / replay rewind.
   */
  reset(): void {
    this.players.clear();
    this.outOfBounds.clear();
  }

  // -------------------------------------------------------------------------
  // Tick
  // -------------------------------------------------------------------------

  /**
   * Position-check every registered fighter and fire the KO callback
   * for each that has just newly crossed a blast-zone edge. Returns the
   * KO events emitted this tick (in player-index order) so callers can
   * log them into a replay buffer in the same step.
   *
   * Re-entrancy: the iteration takes a snapshot of the registered
   * player list before dispatch so a callback that mutates the
   * registry (e.g. `unregisterPlayer` on a final-stock KO) cannot
   * destabilise the loop.
   *
   * @param currentFrame  The deterministic frame counter from
   *                      `PhysicsEngine.getFrame()`. Stamped into every
   *                      emitted `KoEvent` so the StockTracker and
   *                      replay log can correlate them.
   */
  update(currentFrame: number): KoEvent[] {
    if (this.players.size === 0) return [];

    // Re-entrant snapshot: copy the iteration order before any callback
    // can mutate `this.players` / `this.outOfBounds`.
    const snapshot: Array<[number, PositionedBody]> = [];
    for (const entry of this.players) snapshot.push(entry);
    snapshot.sort((a, b) => a[0] - b[0]); // deterministic ordering

    const events: KoEvent[] = [];
    for (const [playerIndex, body] of snapshot) {
      if (this.outOfBounds.has(playerIndex)) continue;
      // The body could have been removed mid-callback by a previous
      // emission's handler — re-check before reading.
      if (!this.players.has(playerIndex)) continue;

      const edge = this.detectCrossedEdge(body.position);
      if (!edge) continue;

      this.outOfBounds.add(playerIndex);
      const event: KoEvent = {
        playerIndex,
        edge,
        frame: currentFrame,
        position: { x: body.position.x, y: body.position.y },
      };
      events.push(event);
      this.callback(event);
    }
    return events;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Strict-crossing edge detection.
   *
   * A fighter is "out of bounds" the moment their centre-of-mass is
   * strictly past any edge. Bodies *on* the line (x === blastZone.left
   * etc.) are treated as in-bounds — they live in the same coordinate
   * space as the stage interior, and a KO that fires exactly when the
   * body grazes the line would over-trigger near narrow side stages.
   *
   * Returns `null` when the body is fully in-bounds, or the highest-
   * priority edge from {@link BLAST_ZONE_EDGE_PRIORITY} when it is
   * past more than one edge (corner KO).
   */
  private detectCrossedEdge(
    position: { readonly x: number; readonly y: number },
  ): BlastZoneEdge | null {
    const { x, y } = position;
    const z = this.blastZone;

    // Defensive — non-finite positions shouldn't crash the loop.
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    const past = {
      top: y < z.top,
      bottom: y > z.bottom,
      left: x < z.left,
      right: x > z.right,
    };

    for (const edge of BLAST_ZONE_EDGE_PRIORITY) {
      if (past[edge]) return edge;
    }
    return null;
  }

  private static assertValidBlastZone(zone: BlastZone): void {
    if (!zone) {
      throw new Error('BlastZonePositionWatcher: blastZone is required');
    }
    const fields: ReadonlyArray<keyof BlastZone> = [
      'left',
      'right',
      'top',
      'bottom',
    ];
    for (const f of fields) {
      const v = zone[f];
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        throw new Error(
          `BlastZonePositionWatcher: blastZone.${f} must be finite, got ${String(v)}`,
        );
      }
    }
    if (zone.left >= zone.right) {
      throw new Error(
        `BlastZonePositionWatcher: blastZone.left (${zone.left}) must be < blastZone.right (${zone.right})`,
      );
    }
    if (zone.top >= zone.bottom) {
      throw new Error(
        `BlastZonePositionWatcher: blastZone.top (${zone.top}) must be < blastZone.bottom (${zone.bottom})`,
      );
    }
  }
}
