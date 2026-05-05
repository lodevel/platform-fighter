/**
 * Sub-AC 4.2 of AC 302 — blast-zone collision watcher.
 *
 * `BlastZoneWatcher` is a thin Matter.js collision-event adapter that
 * sits between the world's `collisionstart` stream and the
 * `StockTracker`. Its only job is "tell me when a character body
 * crosses a blast-zone sensor, and which player it was."
 *
 * Why a separate class:
 *
 *   • Keeps the per-pair identity check (`is bodyA the player I
 *     registered? is bodyB a blast-zone sensor?`) out of the scene
 *     update loop and out of `Character`. The scene reads "stock loss"
 *     events; it doesn't have to know about Matter pair shapes.
 *
 *   • Testable under plain Node — same mock-event pattern already used
 *     by `Character.test.ts` and `StageRenderer.test.ts`. Replays /
 *     determinism gates can lock down "given this pair stream, this
 *     watcher fires exactly N stock-loss events, in this order."
 *
 *   • Reusable by the (post-M2) replay system — the recorder hooks the
 *     same callback to log stock-loss events alongside per-frame inputs;
 *     the player rebuilds match state by replaying both streams.
 *
 * Design notes:
 *
 *   • A *blast-zone sensor* is any body whose `label` starts with
 *     `blastZone.` — see `BLAST_ZONE_LABELS` in `StageRenderer`. The
 *     watcher uses prefix matching so future per-edge directions
 *     (top vs side vs bottom) flow through without touching the
 *     callback contract.
 *
 *   • A pair where both bodies are blast-zone sensors (impossible in
 *     practice — sensors are filtered out of each other's masks — but
 *     possible in test fixtures) is ignored.
 *
 *   • The watcher does NOT emit per-tick "still touching" events. A
 *     body can sit at the blast-zone edge for multiple frames; we only
 *     fire on the leading-edge `collisionstart`. The `StockTracker`
 *     already de-dupes by checking `isRespawning` / `isEliminated`, so
 *     even a rare duplicate event (e.g. a body that detaches and
 *     re-attaches in the same step) is safely absorbed there.
 *
 *   • Re-entrant safe — registering / unregistering players inside a
 *     stock-loss callback is allowed; the iterator snapshots the
 *     player list before dispatch.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Minimum shape of the bodies the watcher needs. Mirrors `Character.body`. */
export interface MinimalBody {
  readonly label?: string | null;
}

/** Shape of a Matter collision pair we care about. Same as `Character`. */
export interface BlastZonePair {
  readonly bodyA: MinimalBody | null | undefined;
  readonly bodyB: MinimalBody | null | undefined;
}

export interface BlastZoneCollisionEvent {
  readonly pairs: ReadonlyArray<BlastZonePair>;
}

/** Callback fired the first frame `playerIndex`'s body touches a blast zone. */
export type StockLossCallback = (playerIndex: number, edgeLabel: string) => void;

/** Prefix used to identify any blast-zone sensor body by its Matter label. */
export const BLAST_ZONE_LABEL_PREFIX = 'blastZone.';

// ---------------------------------------------------------------------------
// Watcher
// ---------------------------------------------------------------------------

/**
 * Stateless-ish collision adapter. Owns nothing but a registry of
 * `(playerIndex → body)` pairs and a stock-loss callback. The scene
 * subscribes the watcher's `handleCollisionStart` to Matter's
 * `collisionstart` stream and registers each player's body up-front.
 *
 * Lifecycle:
 *
 *   const watcher = new BlastZoneWatcher((playerIndex, edge) =>
 *     tracker.loseStock(playerIndex, physics.getFrame())
 *   );
 *   watcher.registerPlayer(0, p1.body);
 *   watcher.registerPlayer(1, p2.body);
 *   scene.matter.world.on('collisionstart', e => watcher.handleCollisionStart(e));
 *   // ...later:
 *   watcher.unregisterPlayer(0); // when a player is eliminated
 */
export class BlastZoneWatcher {
  private readonly players: Map<number, MinimalBody> = new Map();
  private readonly bodyToIndex: Map<MinimalBody, number> = new Map();
  private readonly callback: StockLossCallback;

  constructor(callback: StockLossCallback) {
    this.callback = callback;
  }

  /**
   * Register a player's body for blast-zone monitoring. Registering
   * the same player twice replaces the previous body (used by the
   * future "swap fighter mid-match" feature in the stage builder).
   */
  registerPlayer(playerIndex: number, body: MinimalBody): void {
    if (!Number.isInteger(playerIndex) || playerIndex < 0) {
      throw new Error(`BlastZoneWatcher: invalid playerIndex ${playerIndex}`);
    }
    const existing = this.players.get(playerIndex);
    if (existing) this.bodyToIndex.delete(existing);
    this.players.set(playerIndex, body);
    this.bodyToIndex.set(body, playerIndex);
  }

  /**
   * Stop watching `playerIndex`. Used when a player is eliminated and
   * their body is destroyed / hidden — we don't want a stray collision
   * event for a despawned body to fire a phantom stock-loss.
   */
  unregisterPlayer(playerIndex: number): void {
    const body = this.players.get(playerIndex);
    if (body) this.bodyToIndex.delete(body);
    this.players.delete(playerIndex);
  }

  /** True iff `playerIndex` is currently registered. */
  isRegistered(playerIndex: number): boolean {
    return this.players.has(playerIndex);
  }

  /**
   * Drop every registered player. Used on scene shutdown / replay
   * rewind.
   */
  reset(): void {
    this.players.clear();
    this.bodyToIndex.clear();
  }

  /**
   * Handle a Matter `collisionstart` event. For every pair where one
   * body is a registered player and the other is a blast-zone sensor,
   * fire the stock-loss callback exactly once.
   *
   * Per-event de-duplication: if a player's body somehow crosses
   * multiple blast-zone walls in a single event (e.g. corner clip),
   * we still fire only the first hit so the StockTracker doesn't
   * record two losses for one death.
   */
  handleCollisionStart(event: BlastZoneCollisionEvent): void {
    if (!event || !event.pairs || event.pairs.length === 0) return;
    const firedThisEvent = new Set<number>();
    // Snapshot to be re-entrant-safe with callbacks that mutate
    // `this.players` (e.g. unregister on eliminate).
    for (const pair of event.pairs) {
      const a = pair.bodyA ?? null;
      const b = pair.bodyB ?? null;
      if (!a || !b) continue;

      const aIsBlast = isBlastZoneLabel(a.label);
      const bIsBlast = isBlastZoneLabel(b.label);
      if (aIsBlast && bIsBlast) continue; // sensor-vs-sensor — ignore

      let playerBody: MinimalBody | null = null;
      let blastBody: MinimalBody | null = null;
      if (bIsBlast && this.bodyToIndex.has(a)) {
        playerBody = a;
        blastBody = b;
      } else if (aIsBlast && this.bodyToIndex.has(b)) {
        playerBody = b;
        blastBody = a;
      }
      if (!playerBody || !blastBody) continue;

      const playerIndex = this.bodyToIndex.get(playerBody)!;
      if (firedThisEvent.has(playerIndex)) continue;
      firedThisEvent.add(playerIndex);
      this.callback(playerIndex, blastBody.label ?? '');
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isBlastZoneLabel(label: string | undefined | null): boolean {
  return typeof label === 'string' && label.startsWith(BLAST_ZONE_LABEL_PREFIX);
}
