/**
 * Sub-AC 3 of AC 303 — respawn coordinator. Also satisfies the
 * "respawn or elimination" + "damage % reset" half of Sub-AC 4 of AC 6
 * ("KO handling on blast zone crossing — life decrement, respawn or
 * elimination, damage % reset"). The life-decrement half of that AC
 * lives in {@link StockTracker.loseStock}; the damage % reset is the
 * `setDamagePercent(0)` call this module drives in `applyRespawns`.
 * The headline integration test pairing both modules against a damage-
 * aware target lives in `BlastZoneKoHandling.test.ts`.
 *
 * Implements the post-KO respawn flow as a Phaser-free, deterministic
 * module so the gameplay scene, replay tooling, and tests can all share
 * a single source of truth for "when a fighter loses a stock and stocks
 * remain, what exactly happens."
 *
 * The Seed's acceptance language for this sub-AC is:
 *
 *     "Implement respawn logic with spawn platform placement,
 *      invulnerability frames, and state reset when stocks remain."
 *
 * All three responsibilities live here:
 *
 *   1. **Spawn platform placement.**
 *      Every respawn places a small ghost-platform overlay under the
 *      re-entering fighter — the canonical Smash-style "you spawned
 *      here, you have a moment of safety" visual. The overlay is a
 *      pure data record (`SpawnPlatform`) with a position, size, and
 *      a deterministic expiry frame; the renderer (Phaser) reads the
 *      live list each render hook and draws / fades a graphic for
 *      each one. Platforms expire on the same frame the fighter's
 *      invincibility window ends so the visual matches the gameplay
 *      contract — the platform is gone the moment the player can be
 *      hit again.
 *
 *   2. **Invulnerability frames.**
 *      The respawn handler reads `RespawnEvent.invincibilityFrames`
 *      from {@link StockTracker} and forwards it to the fighter via
 *      `Character.setInvincibility(frames)`. Default is 90 frames
 *      (1.5 s @ 60 Hz) — short enough that camping the spawn point
 *      isn't viable, long enough that the player can choose a
 *      direction and re-enter the fight without getting edge-guarded
 *      into a second consecutive KO.
 *
 *   3. **State reset.**
 *      Calls into `Character.setPosition` (which clears jumps, hit-
 *      stun, attack state, cooldown, ground contacts, and previous-
 *      input latches), `setDamagePercent(0)` (fresh life, fresh
 *      meter), and `setFacing` (face inward toward the centre of the
 *      stage). These three calls together make a respawned fighter
 *      indistinguishable from a fresh-spawn fighter at match start —
 *      no transient combat state survives a respawn.
 *
 * What this module deliberately does NOT do:
 *
 *   • It does not own the `StockTracker` — the scene calls
 *     `tracker.consumePendingRespawns(frame)` itself and hands the
 *     drained `RespawnEvent[]` to {@link applyRespawns}. This keeps
 *     the tracker reusable for HUD / AI consumers and lets a future
 *     replay scrub flow inject synthetic events without going through
 *     a fake tracker.
 *
 *   • It does not render anything. Phaser visuals (the spawn-platform
 *     graphic, the post-respawn flicker) live in the gameplay scene;
 *     this module only produces the data. That's what makes it
 *     testable under plain Node.
 *
 *   • It does not handle eliminated fighters — by contract,
 *     `consumePendingRespawns` never yields an event for an
 *     eliminated slot. The scene's separate "drop the corpse from the
 *     watchers" pass handles those.
 *
 * Determinism note: every state mutation produced by this module is a
 * pure function of (current state, RespawnEvent, registered slot data).
 * No `Math.random()`, no wall-clock reads, no Phaser timers. Replaying
 * the same KO log produces byte-identical respawn behaviour.
 */

import type { RespawnEvent } from './StockTracker';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Per-player layout data needed to teleport a fighter back onto the
 * stage. Mirrors the `playerSlots` table the gameplay scene already
 * keeps for HUD wiring; passed in at register time so the handler is a
 * pure deterministic engine over a fixed configuration.
 */
export interface RespawnSlot {
  /** Stock-tracker slot index (0-based, matches `RespawnEvent.playerIndex`). */
  readonly playerIndex: number;
  /** Viewport-space X to teleport the body to. */
  readonly spawnX: number;
  /** Viewport-space Y to teleport the body to. */
  readonly spawnY: number;
  /**
   * Direction to face on re-entry. Convention: positive = right,
   * negative = left. The scene picks values that face inward toward
   * the centre of the stage so the very first attack lands toward the
   * opponent.
   */
  readonly faceOnSpawn: 1 | -1;
}

/**
 * Minimum surface the handler needs from a fighter object. Mirrors the
 * relevant `Character` methods so unit tests can pass plain mock
 * objects without spinning up Phaser. Production code passes the live
 * `Character` instance — the methods line up exactly.
 */
export interface RespawnTarget {
  setPosition(x: number, y: number): void;
  setDamagePercent(percent: number): void;
  setInvincibility(frames: number): void;
  setFacing(facing: 1 | -1): void;
}

/**
 * Optional per-respawn side-effects the scene wants to fire that are
 * NOT the canonical Character mutations. The most common is the
 * "re-arm the position-based KO watcher's out-of-bounds latch" call
 * — the fighter is back inside the stage so subsequent crossings
 * count as fresh KOs.
 *
 * Any callback registered here is called once per drained respawn
 * event, AFTER the canonical state-reset has been applied. Errors
 * thrown by a callback are caught and logged so a buggy hook doesn't
 * break the rest of the respawn pipeline.
 */
export type RespawnSideEffect = (event: AppliedRespawn) => void;

/**
 * Active spawn-platform overlay. Created the frame a fighter
 * respawns; lives until `expireFrame`. The renderer reads the live
 * list each render hook and draws / fades a graphic for each one.
 *
 * Coordinates are viewport-space (the same space `RespawnSlot.spawnX/
 * Y` are authored in) so the renderer can pin a Phaser Rectangle
 * directly to the platform's centre.
 */
export interface SpawnPlatform {
  readonly playerIndex: number;
  /** Centre X in the same coordinate space as `RespawnSlot.spawnX`. */
  readonly x: number;
  /** Centre Y — sits a few pixels below the fighter's centre. */
  readonly y: number;
  /** Width in design / viewport pixels. */
  readonly width: number;
  /** Height in design / viewport pixels. */
  readonly height: number;
  /**
   * Frame the platform appeared. Useful for the renderer's fade-in
   * tween — same deterministic clock the rest of the engine uses.
   */
  readonly spawnedFrame: number;
  /**
   * Frame the platform should disappear. Inclusive: when
   * `currentFrame >= expireFrame` the platform is removed during the
   * next {@link RespawnHandler.update} call.
   *
   * Set to `spawnedFrame + invincibilityFrames` so the visual matches
   * the gameplay contract — the moment the fighter loses their grace
   * window, the platform is gone.
   */
  readonly expireFrame: number;
  /**
   * Cached invincibility window length so a renderer can compute a
   * normalised lifetime alpha (`progress = (currentFrame - spawned)
   * / invincibilityFrames`) without having to subtract two frames
   * itself.
   */
  readonly invincibilityFrames: number;
}

/**
 * The applied-respawn record emitted by {@link applyRespawns}. Useful
 * for HUD stings, replay debug overlays, and as the argument passed
 * to registered side-effect hooks. Carries everything a consumer
 * needs to react without poking at the Character or the tracker
 * directly.
 */
export interface AppliedRespawn {
  readonly playerIndex: number;
  readonly spawnX: number;
  readonly spawnY: number;
  readonly faceOnSpawn: 1 | -1;
  readonly invincibilityFrames: number;
  readonly frame: number;
}

/**
 * Tunable spawn-platform geometry. Defaults produce a wide-enough,
 * thin platform that reads as "you spawned here" without obscuring
 * the fighter sprite. Authoring overrides go through the constructor.
 */
export interface SpawnPlatformGeometry {
  /** Width in design / viewport pixels. Default 140. */
  readonly width: number;
  /** Height in design / viewport pixels. Default 16. */
  readonly height: number;
  /**
   * Vertical offset from the spawn Y to the platform's centre.
   * Positive = the platform sits *below* the fighter (the standard
   * Smash arrangement so the fighter appears to be standing on it).
   * Default 64 — roughly half the default character height.
   */
  readonly yOffsetBelowSpawn: number;
}

export const DEFAULT_SPAWN_PLATFORM_GEOMETRY: SpawnPlatformGeometry = Object.freeze({
  width: 140,
  height: 16,
  yOffsetBelowSpawn: 64,
});

export interface RespawnHandlerOptions {
  /**
   * Optional override of the spawn-platform geometry (visual size +
   * placement offset). Anything you don't pass is filled from
   * {@link DEFAULT_SPAWN_PLATFORM_GEOMETRY}.
   */
  readonly spawnPlatform?: Partial<SpawnPlatformGeometry>;
}

// ---------------------------------------------------------------------------
// RespawnHandler
// ---------------------------------------------------------------------------

/**
 * Deterministic respawn coordinator. One instance per match, owned by
 * the gameplay scene.
 *
 * Lifecycle:
 *
 *   const handler = new RespawnHandler();
 *   handler.registerSlot({ playerIndex: 0, spawnX, spawnY, faceOnSpawn: 1 }, character);
 *
 *   // …once per fixed step:
 *   const events = stockTracker.consumePendingRespawns(frame);
 *   const applied = handler.applyRespawns(events, frame);
 *   handler.update(frame); // expire spent platforms
 *
 *   // …once per render frame:
 *   for (const platform of handler.getActiveSpawnPlatforms()) {
 *     drawPlatform(platform);
 *   }
 */
export class RespawnHandler {
  private readonly slots = new Map<
    number,
    { readonly slot: RespawnSlot; readonly target: RespawnTarget }
  >();

  private readonly platforms: SpawnPlatform[] = [];

  private readonly sideEffects: RespawnSideEffect[] = [];

  private readonly geometry: SpawnPlatformGeometry;

  constructor(options: RespawnHandlerOptions = {}) {
    this.geometry = {
      ...DEFAULT_SPAWN_PLATFORM_GEOMETRY,
      ...stripUndefined(options.spawnPlatform ?? {}),
    };
  }

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  /**
   * Register a player slot. Must be called before any
   * {@link applyRespawns} call references that slot — typically
   * during scene `create()` after the fighter and stage are built.
   *
   * Re-registering an existing slot replaces the previous binding
   * silently (useful when a roster swap recreates the Character mid-
   * match in a future AC).
   */
  registerSlot(slot: RespawnSlot, target: RespawnTarget): void {
    if (!Number.isInteger(slot.playerIndex) || slot.playerIndex < 0) {
      throw new Error(
        `RespawnHandler: playerIndex must be a non-negative integer, got ${slot.playerIndex}`,
      );
    }
    this.slots.set(slot.playerIndex, { slot, target });
  }

  /** Drop a slot binding. Idempotent. */
  unregisterSlot(playerIndex: number): void {
    this.slots.delete(playerIndex);
    // Also drop any active spawn-platform overlay for this slot —
    // a slot that's been removed cannot expire its own platform via
    // applyRespawns, so we tidy up here.
    for (let i = this.platforms.length - 1; i >= 0; i -= 1) {
      if (this.platforms[i]!.playerIndex === playerIndex) {
        this.platforms.splice(i, 1);
      }
    }
  }

  /** True iff the given slot has been registered. */
  isRegistered(playerIndex: number): boolean {
    return this.slots.has(playerIndex);
  }

  /**
   * Subscribe a side-effect callback. Called once per drained respawn
   * event AFTER the canonical state reset is applied — order matches
   * the order events are passed to {@link applyRespawns}, so when the
   * tracker yields multiple respawns in a single tick the side-effect
   * runs are deterministic.
   *
   * Returns an unsubscribe function for the caller's cleanup.
   */
  onRespawn(callback: RespawnSideEffect): () => void {
    this.sideEffects.push(callback);
    return () => {
      const idx = this.sideEffects.indexOf(callback);
      if (idx >= 0) this.sideEffects.splice(idx, 1);
    };
  }

  // -------------------------------------------------------------------------
  // Per-step application
  // -------------------------------------------------------------------------

  /**
   * Apply a batch of `RespawnEvent`s drained from {@link StockTracker
   * .consumePendingRespawns}. For each event the handler:
   *
   *   1. Looks up the registered slot. Skips silently if the slot
   *      isn't registered — this keeps the call safe for partially-
   *      configured tests and pre-registration race windows.
   *   2. Teleports the fighter to its spawn point (state-reset).
   *   3. Resets damage to 0%.
   *   4. Grants the configured invincibility window.
   *   5. Faces the fighter inward toward the stage centre.
   *   6. Spawns a `SpawnPlatform` overlay sized by the configured
   *      geometry, centred under the fighter, expiring when the
   *      invincibility window ends.
   *   7. Fires every registered side-effect callback so the scene
   *      can re-arm the position-based KO watcher.
   *
   * Returns the list of `AppliedRespawn` records — same length as the
   * input list filtered to slots that were actually registered.
   * Useful for the HUD ("respawn flash" overlay) and tests.
   */
  applyRespawns(events: ReadonlyArray<RespawnEvent>, frame: number): AppliedRespawn[] {
    const applied: AppliedRespawn[] = [];
    const safeFrame = Math.max(0, Math.floor(frame));

    for (const event of events) {
      const entry = this.slots.get(event.playerIndex);
      if (!entry) continue; // Tolerate unregistered slots.

      const { slot, target } = entry;
      const invFrames = Math.max(0, Math.floor(event.invincibilityFrames));

      // 1. Teleport + transient state reset.
      target.setPosition(slot.spawnX, slot.spawnY);
      // 2. Damage percent → 0.
      target.setDamagePercent(0);
      // 3. Invincibility window.
      target.setInvincibility(invFrames);
      // 4. Face inward.
      target.setFacing(slot.faceOnSpawn);

      // 5. Spawn platform overlay. Drop any existing platform for
      //    this slot first (defensive — a back-to-back respawn for
      //    the same slot before the previous platform expires
      //    shouldn't leak two overlays).
      this.dropPlatformsFor(event.playerIndex);
      this.platforms.push({
        playerIndex: event.playerIndex,
        x: slot.spawnX,
        y: slot.spawnY + this.geometry.yOffsetBelowSpawn,
        width: this.geometry.width,
        height: this.geometry.height,
        spawnedFrame: safeFrame,
        expireFrame: safeFrame + invFrames,
        invincibilityFrames: invFrames,
      });

      const record: AppliedRespawn = {
        playerIndex: event.playerIndex,
        spawnX: slot.spawnX,
        spawnY: slot.spawnY,
        faceOnSpawn: slot.faceOnSpawn,
        invincibilityFrames: invFrames,
        frame: safeFrame,
      };
      applied.push(record);

      // 6. Side-effect hooks (e.g. re-arm the position watcher).
      for (const cb of this.sideEffects) {
        try {
          cb(record);
        } catch (err) {
          // Don't let a buggy hook break the respawn pipeline; log
          // and keep going so the rest of the batch still runs.
          // eslint-disable-next-line no-console
          console.error(
            `[respawn] side-effect threw for slot ${event.playerIndex}:`,
            err,
          );
        }
      }
    }

    return applied;
  }

  /**
   * Tick the spawn-platform expiry. Should be called once per fixed
   * step (typically right after {@link applyRespawns}) so platforms
   * disappear deterministically on their `expireFrame`.
   *
   * Returns the list of platforms that just expired this call —
   * useful for the renderer's fade-out tween or any one-shot SFX.
   */
  update(currentFrame: number): SpawnPlatform[] {
    const expired: SpawnPlatform[] = [];
    for (let i = this.platforms.length - 1; i >= 0; i -= 1) {
      const p = this.platforms[i]!;
      if (currentFrame >= p.expireFrame) {
        expired.push(p);
        this.platforms.splice(i, 1);
      }
    }
    // Reverse so the order matches insertion (we walked backwards).
    expired.reverse();
    return expired;
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /**
   * Live snapshot of the active spawn-platform overlays. Returned
   * array is a copy — mutating it is safe.
   */
  getActiveSpawnPlatforms(): SpawnPlatform[] {
    return this.platforms.slice();
  }

  /** True iff there's an active spawn-platform overlay for `playerIndex`. */
  hasActiveSpawnPlatform(playerIndex: number): boolean {
    for (const p of this.platforms) {
      if (p.playerIndex === playerIndex) return true;
    }
    return false;
  }

  /** Number of currently-active spawn-platform overlays. */
  getActiveSpawnPlatformCount(): number {
    return this.platforms.length;
  }

  /**
   * Read-only view of the configured spawn-platform geometry. Mostly
   * used by tests and the (future) stage-builder preview.
   */
  getSpawnPlatformGeometry(): SpawnPlatformGeometry {
    return { ...this.geometry };
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Drop all active platforms and registered slots. Called by the
   * scene's SHUTDOWN hook so a re-entry into MatchScene starts with
   * a clean handler.
   */
  reset(): void {
    this.slots.clear();
    this.platforms.length = 0;
    this.sideEffects.length = 0;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private dropPlatformsFor(playerIndex: number): void {
    for (let i = this.platforms.length - 1; i >= 0; i -= 1) {
      if (this.platforms[i]!.playerIndex === playerIndex) {
        this.platforms.splice(i, 1);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Strip `undefined` values so they don't override defaults during a
 * spread merge. Mirrors the helper inside `Character.ts` — keeping a
 * local copy avoids reaching cross-package for a one-line utility.
 */
function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(obj) as Array<keyof T>) {
    const v = obj[key];
    if (v !== undefined) {
      out[key] = v;
    }
  }
  return out;
}
