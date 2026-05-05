/**
 * Sub-AC 2 of AC 9 — lava → fighter collision detection that triggers
 * an instant KO.
 *
 * `LavaCollisionWatcher` is the third member of the collision-adapter
 * family that already includes {@link BlastZoneWatcher} and
 * {@link HitboxDamageHandler}: a thin, Phaser-free, fully-deterministic
 * shim that sits between Matter.js' collision-pair stream and a single
 * domain callback. Where `BlastZoneWatcher` says "this fighter just
 * crossed a KO sensor," `LavaCollisionWatcher` says "this fighter just
 * touched **active** lava — KO them on the spot."
 *
 * Why a *separate* watcher (not a feature flag on `BlastZoneWatcher`):
 *
 *   • **Active-state gating.** Blast zones are always lethal — every
 *     `collisionstart` is a KO event. Lava is lethal *only when active*
 *     (`heightNorm ≥ activeThreshold`). The watcher therefore needs a
 *     reference to the {@link LavaHazard} entity for each registered
 *     hazard body so it can ask `hazard.isActive()` at the moment the
 *     pair fires. Folding that into BlastZoneWatcher would bloat the
 *     blast-zone path with state it doesn't need and force every other
 *     test fixture to thread a hazard reference through.
 *
 *   • **Persistent-overlap correctness.** A fighter can be standing
 *     over a lava pool while the lava is *inactive* (height below
 *     threshold) — perfectly safe. Once the lava rises past the
 *     activation threshold the *same* overlap suddenly becomes lethal.
 *     Matter's `collisionstart` only fires on first contact, not on
 *     "still in contact," so a pure `collisionstart`-driven approach
 *     would miss this case. We therefore split the contract into:
 *
 *       1. `handleCollisionStart` / `handleCollisionEnd` — track the
 *          *set* of currently-overlapping `(player, hazard)` pairs.
 *       2. `tick()` — once per fixed step, scan the overlap set and
 *          fire the KO callback for any pair where the lava is currently
 *          active. A pair only fires once per overlap session: leaving
 *          and re-entering the lava body is required to re-arm.
 *
 *   • **Determinism.** `tick()` consumes only the registry, the overlap
 *     set, and `LavaHazard.isActive()` — all deterministic (hazard
 *     state is a pure function of its frame counter). Replays driving
 *     identical pair streams produce identical KO callbacks in identical
 *     order across runs.
 *
 *   • **Testability.** Mirrors the
 *     {@link BlastZoneWatcher.test.ts}-style mock-event pattern — plain
 *     objects with `label` fields are enough. No Matter.js fixture
 *     needed, no jsdom. The Sub-AC 2 acceptance contract is exercised
 *     under pure Node.
 *
 * Wire-up in the gameplay scene:
 *
 *     const watcher = new LavaCollisionWatcher((playerIndex, hazardId) => {
 *       // Instant KO — drop the stock right now and let the existing
 *       // respawn flow handle re-entry.
 *       tracker.loseStock(playerIndex, physics.getFrame());
 *     });
 *
 *     for (const hazard of stage.hazards) {
 *       watcher.registerHazard(hazard, hazardBody);
 *     }
 *     for (let i = 0; i < fighters.length; i += 1) {
 *       watcher.registerPlayer(i, fighters[i].body);
 *     }
 *
 *     scene.matter.world.on('collisionstart', e =>
 *       watcher.handleCollisionStart(e),
 *     );
 *     scene.matter.world.on('collisionend', e =>
 *       watcher.handleCollisionEnd(e),
 *     );
 *
 *     // Once per fixed step, after physics has advanced and the
 *     // hazard has ticked:
 *     watcher.tick();
 *
 * KO semantics:
 *
 *   The Seed ontology entry for lava reads "rising/falling, **instant
 *   KO**." That is interpreted here as "touching active lava
 *   immediately costs the fighter one stock," matching the canonical
 *   Smash-style "stage hazard hit ⇒ stock loss." We deliberately do
 *   *not* burn every remaining stock — instant-KO of a 3-stock match
 *   would be cruelly punitive and inconsistent with how blast zones
 *   are treated. The callback is what decides what an "instant KO"
 *   means in the wider match: tests pin it to one stock; production
 *   wiring funnels into `tracker.loseStock` which itself decrements
 *   exactly one stock and schedules a respawn.
 */

import type { LavaHazard } from '../entities/LavaHazard';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Minimal shape of a Matter body the watcher needs to inspect. */
export interface LavaMinimalBody {
  /** Optional label — used for debug logs only; identity comes from registry. */
  readonly label?: string | null;
}

/** Shape of a Matter collision pair we care about. */
export interface LavaCollisionPair {
  readonly bodyA: LavaMinimalBody | null | undefined;
  readonly bodyB: LavaMinimalBody | null | undefined;
}

export interface LavaCollisionEvent {
  readonly pairs: ReadonlyArray<LavaCollisionPair>;
}

/**
 * Callback fired the first frame `playerIndex` overlaps with a registered
 * lava hazard while that hazard is active. The `hazardId` is the lava
 * entity's `getId()` — useful for HUD callouts ("KO'd by lava-pool-A!")
 * and post-match stats.
 */
export type LavaKoCallback = (playerIndex: number, hazardId: string) => void;

/**
 * Conventional Matter `label` prefix for lava hazard bodies. The
 * `StageRenderer` (and the post-M3 stage builder export) stamp lava
 * sensor bodies with `'hazard.lava.<id>'` — labels aren't required for
 * the watcher to fire (registry membership is the source of truth) but
 * they make Matter's debug overlay readable.
 */
export const LAVA_HAZARD_LABEL_PREFIX = 'hazard.lava.';

// ---------------------------------------------------------------------------
// Watcher
// ---------------------------------------------------------------------------

/**
 * Lava-vs-fighter collision adapter. Tracks which fighters are
 * overlapping which lava bodies and, on `tick()`, fires an instant-KO
 * callback for any overlap whose lava is currently active.
 *
 * State: two registries (player/body, hazard/body) and one overlap set.
 * A "fired" guard ensures a single overlap session produces at most one
 * KO callback even if the lava transitions inactive → active → inactive
 * → active while the fighter remains inside the body. The fighter must
 * leave the lava body (`collisionend`) and re-enter (`collisionstart`)
 * to re-arm.
 */
export class LavaCollisionWatcher {
  // ------------------------- Player registry -----------------------------
  private readonly players: Map<number, LavaMinimalBody> = new Map();
  private readonly playerBodyToIndex: Map<LavaMinimalBody, number> = new Map();

  // ------------------------- Hazard registry -----------------------------
  /**
   * `hazardId → LavaHazard` so callbacks can resolve the entity that
   * caused the KO without forcing the caller to maintain a parallel map.
   */
  private readonly hazardsById: Map<string, LavaHazard> = new Map();
  /**
   * `hazardBody → hazardId` — primary lookup during pair handling. We
   * index by body identity (not label) so the watcher tolerates two
   * hazards sharing a label suffix as long as they're distinct Matter
   * bodies.
   */
  private readonly hazardBodyToId: Map<LavaMinimalBody, string> = new Map();

  // ------------------------- Overlap state -------------------------------
  /**
   * Set of currently-overlapping `(playerIndex, hazardId)` pairs, keyed
   * by an opaque string. Population: filled by `handleCollisionStart`,
   * drained by `handleCollisionEnd` and `tick()` (after firing). Entries
   * persist across ticks until either the fighter leaves the lava body
   * or the lava becomes active and the KO fires.
   */
  private readonly overlaps: Map<string, OverlapEntry> = new Map();

  private readonly callback: LavaKoCallback;

  constructor(callback: LavaKoCallback) {
    if (typeof callback !== 'function') {
      throw new Error('LavaCollisionWatcher: callback must be a function');
    }
    this.callback = callback;
  }

  // -------------------------------------------------------------------------
  // Player registration
  // -------------------------------------------------------------------------

  /**
   * Register a fighter's body for lava overlap monitoring. Re-registering
   * the same `playerIndex` replaces the previous body and clears any
   * stale overlap state involving the old body.
   */
  registerPlayer(playerIndex: number, body: LavaMinimalBody): void {
    if (!Number.isInteger(playerIndex) || playerIndex < 0) {
      throw new Error(
        `LavaCollisionWatcher: invalid playerIndex ${playerIndex}`,
      );
    }
    if (!body) {
      throw new Error(
        `LavaCollisionWatcher: registerPlayer requires a body (got ${String(body)})`,
      );
    }
    const existing = this.players.get(playerIndex);
    if (existing) {
      this.playerBodyToIndex.delete(existing);
      // Drop overlaps that referenced the old body — they're stale.
      this.dropOverlapsForPlayer(playerIndex);
    }
    this.players.set(playerIndex, body);
    this.playerBodyToIndex.set(body, playerIndex);
  }

  /**
   * Stop watching `playerIndex`. Called when a fighter is eliminated or
   * the scene shuts down — guarantees no further KO callbacks fire for
   * that slot. Drops every overlap entry that referenced the player so
   * a re-register later doesn't observe stale state.
   */
  unregisterPlayer(playerIndex: number): void {
    const body = this.players.get(playerIndex);
    if (body) this.playerBodyToIndex.delete(body);
    this.players.delete(playerIndex);
    this.dropOverlapsForPlayer(playerIndex);
  }

  /** True iff `playerIndex` is currently registered. */
  isRegistered(playerIndex: number): boolean {
    return this.players.has(playerIndex);
  }

  // -------------------------------------------------------------------------
  // Hazard registration
  // -------------------------------------------------------------------------

  /**
   * Register a `LavaHazard` entity together with the Matter body that
   * represents its damaging volume. The body's identity (object
   * reference) is the sole index — labels are optional. Re-registering
   * a hazard with the same id replaces the old body and clears stale
   * overlaps.
   */
  registerHazard(hazard: LavaHazard, body: LavaMinimalBody): void {
    if (!hazard || typeof hazard.getId !== 'function') {
      throw new Error(
        'LavaCollisionWatcher: registerHazard requires a LavaHazard',
      );
    }
    if (!body) {
      throw new Error(
        `LavaCollisionWatcher: registerHazard requires a body (got ${String(body)})`,
      );
    }
    const id = hazard.getId();
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('LavaCollisionWatcher: hazard.getId() must be a non-empty string');
    }
    // Replace any prior body registered under the same id.
    for (const [b, hid] of this.hazardBodyToId) {
      if (hid === id) {
        this.hazardBodyToId.delete(b);
        break;
      }
    }
    this.hazardsById.set(id, hazard);
    this.hazardBodyToId.set(body, id);
    // Drop stale overlaps referencing the prior body.
    this.dropOverlapsForHazard(id);
  }

  /** Stop watching the hazard with the given id. */
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

  /** True iff a hazard with `hazardId` is currently registered. */
  isHazardRegistered(hazardId: string): boolean {
    return this.hazardsById.has(hazardId);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Drop every registered player, hazard, and overlap. Called on scene
   * shutdown / replay rewind so the next match starts from a clean
   * slate.
   */
  reset(): void {
    this.players.clear();
    this.playerBodyToIndex.clear();
    this.hazardsById.clear();
    this.hazardBodyToId.clear();
    this.overlaps.clear();
  }

  /** Number of currently-tracked overlaps. Test/debug helper. */
  getOverlapCount(): number {
    return this.overlaps.size;
  }

  // -------------------------------------------------------------------------
  // Collision-stream handlers
  // -------------------------------------------------------------------------

  /**
   * Handle a Matter `collisionstart` event. For every pair where one
   * body is a registered fighter and the other is a registered lava
   * hazard, record the overlap. Does *not* fire the KO callback —
   * `tick()` is responsible for that, gated on `LavaHazard.isActive()`.
   *
   * Filters applied, in order:
   *   1. Drop pairs with null bodies (defensive — Matter can hand
   *      us these in pathological test fixtures).
   *   2. Drop pairs that aren't (player, hazard) in either order.
   *   3. Drop pairs where either body is registered for both roles
   *      (impossible in practice; safety net for malformed fixtures).
   */
  handleCollisionStart(event: LavaCollisionEvent): void {
    if (!event || !event.pairs || event.pairs.length === 0) return;
    for (const pair of event.pairs) {
      const resolved = this.resolvePair(pair);
      if (!resolved) continue;
      const key = makeOverlapKey(resolved.playerIndex, resolved.hazardId);
      // First time we see this overlap → record it. If a duplicate
      // collisionstart somehow fires for the same pair without an
      // intervening collisionend (would be a Matter bug, but defensive
      // here matters), we leave the existing entry alone — the `fired`
      // flag is the dedup key.
      if (!this.overlaps.has(key)) {
        this.overlaps.set(key, {
          playerIndex: resolved.playerIndex,
          hazardId: resolved.hazardId,
          fired: false,
        });
      }
    }
  }

  /**
   * Handle a Matter `collisionend` event. For every pair where one
   * body is a registered fighter and the other is a registered lava
   * hazard, drop the overlap. The next `collisionstart` for the same
   * pair re-arms the KO check.
   */
  handleCollisionEnd(event: LavaCollisionEvent): void {
    if (!event || !event.pairs || event.pairs.length === 0) return;
    for (const pair of event.pairs) {
      const resolved = this.resolvePair(pair);
      if (!resolved) continue;
      const key = makeOverlapKey(resolved.playerIndex, resolved.hazardId);
      this.overlaps.delete(key);
    }
  }

  // -------------------------------------------------------------------------
  // Per-step KO emission
  // -------------------------------------------------------------------------

  /**
   * Once-per-fixed-step scan: for every active overlap, fire the KO
   * callback iff the underlying `LavaHazard.isActive()` returns true
   * **and** that overlap hasn't already fired this session. Marks the
   * overlap as `fired` so a continued overlap doesn't re-trigger every
   * frame; the fighter must leave the body (collisionend) and re-enter
   * (collisionstart) to re-arm.
   *
   * Iteration order: ascending `(playerIndex, hazardId)` so the
   * callback ordering is deterministic across runs regardless of the
   * underlying Map's insertion-order quirks. The list is snapshotted
   * up-front so a callback that mutates the registry (e.g. unregister
   * the player on KO) is safe.
   */
  tick(): void {
    if (this.overlaps.size === 0) return;
    // Snapshot to be re-entrant-safe: callbacks that unregister the
    // player will mutate `this.overlaps` (via dropOverlapsForPlayer).
    const snapshot = Array.from(this.overlaps.values()).sort(compareOverlap);
    for (const entry of snapshot) {
      if (entry.fired) continue;
      const hazard = this.hazardsById.get(entry.hazardId);
      if (!hazard) continue; // hazard unregistered between events
      if (!hazard.isActive()) continue; // safe — lava below threshold
      // The player may have been unregistered mid-iteration by an
      // earlier callback; honour the live registry.
      if (!this.players.has(entry.playerIndex)) continue;
      // Lock first, fire after — guarantees idempotency even if the
      // callback re-enters `tick` (it shouldn't, but defensively).
      entry.fired = true;
      this.callback(entry.playerIndex, entry.hazardId);
    }
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Inspect a Matter pair and decide whether it represents a
   * (registered fighter, registered lava hazard) overlap. Returns
   * `null` for everything else (fighter-vs-platform, hazard-vs-hazard,
   * unregistered bodies, etc.).
   */
  private resolvePair(
    pair: LavaCollisionPair,
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

    // Defensive: a body registered for both roles would be a fixture
    // bug — drop the pair so a malformed fixture never fires a KO.
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

interface OverlapEntry {
  readonly playerIndex: number;
  readonly hazardId: string;
  /**
   * Has the KO callback fired for this overlap session yet? Once true,
   * remains true until the overlap is removed (collisionend or
   * unregister). Re-entering the lava body resets to `false` because
   * the new entry replaces this one.
   */
  fired: boolean;
}

function makeOverlapKey(playerIndex: number, hazardId: string): string {
  // `:` is forbidden in our hazard ids by convention (id is a token);
  // even if it ever appears, the prefix integer makes the key
  // unambiguous because hazardId is consumed verbatim after.
  return `${playerIndex}:${hazardId}`;
}

function compareOverlap(a: OverlapEntry, b: OverlapEntry): number {
  if (a.playerIndex !== b.playerIndex) return a.playerIndex - b.playerIndex;
  if (a.hazardId < b.hazardId) return -1;
  if (a.hazardId > b.hazardId) return 1;
  return 0;
}
