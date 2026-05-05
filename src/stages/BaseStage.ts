/**
 * `BaseStage` — the shared stage runtime contract (AC 20101 Sub-AC 1).
 *
 * Before this module landed, every gameplay scene that wanted to host a
 * fight had to wire the stage piecemeal:
 *
 *   1. Resolve a {@link StageLayout} from somewhere (registry / custom-
 *      stage loader / replay header).
 *   2. Hand it to {@link renderStage} for platform colliders + four
 *      blast-zone sensor walls.
 *   3. Compute the design→viewport transform a second time so spawn
 *      points, hazards, and HUD overlays land on the rendered geometry.
 *   4. Walk `layout.hazards` and instantiate {@link renderLavaHazards} /
 *      {@link renderWindHazards} (and any future hazard family) with the
 *      same transform.
 *   5. Construct + register a {@link LavaCollisionWatcher} and a
 *      {@link WindForceController} and remember to forward
 *      `collisionstart` / `collisionend` events to all of them.
 *   6. Call `entity.tick()` on every hazard each fixed step BEFORE
 *      `matter.world.step` so the hazard clock stays locked to the
 *      simulation clock.
 *   7. Call `update()` on every hazard renderer each render frame to
 *      re-position the visuals.
 *   8. Tear it all down on shutdown — bodies, visuals, watcher state —
 *      in a specific order so a stray late `collisionend` event can't
 *      reach a half-torn-down watcher.
 *
 * The orchestration is mechanical, but the *order* matters and the
 * lifecycle is brittle: forgetting one of the steps silently breaks
 * either determinism (hazards drift), KO firing (watchers don't see
 * pairs), or shutdown safety (Matter throws on the next scene boot).
 *
 * `BaseStage` exists to make every step a method call on a single
 * object. The owning scene constructs one with the resolved
 * {@link StageLayout} and a small {@link BaseStageOptions} record that
 * carries the per-match callbacks (lava KO, wind force) and any
 * render-time tuning (debug overlays, viewport overrides). After that
 * the scene only ever calls into the stage:
 *
 *   - `registerPlayer(slot, body)` / `unregisterPlayer(slot)` —
 *     fans the registration out to every hazard adapter so the scene
 *     doesn't have to remember which hazard families exist on which
 *     stage.
 *   - `tickHazards(frame)` — call BEFORE `matter.world.step`. Advances
 *     every hazard entity exactly once.
 *   - `applyHazardEffects(frame)` — call AFTER `matter.world.step`.
 *     Drains the lava-KO and wind-force overlap queues.
 *   - `handleCollisionStart(event)` / `handleCollisionEnd(event)` —
 *     forward Matter's pair stream to every registered hazard watcher
 *     in one shot.
 *   - `updateRender(frame)` — call once per render frame. Re-syncs
 *     hazard visuals to the entity state and refreshes the platform
 *     visual binders.
 *   - `destroy()` — tears down all bodies + visuals in the safe order.
 *
 * Why a class (instead of a bag of free functions):
 *
 *   • A stage carries non-trivial state — multiple hazard renderers,
 *     two collision adapters, a viewport transform, and the live
 *     `RenderedStage` handle. Threading all of that through free
 *     functions every frame was the source of the wiring drift the M2
 *     hazard stages kept hitting.
 *
 *   • Future stages (M2 hazard variants, M3 builder-loaded custom
 *     stages, M4 replay-rehydrated stages) can subclass `BaseStage` and
 *     override targeted hooks (`onPlayerRegistered`, `tickHazards`,
 *     etc.) without re-implementing the orchestration. Subclasses are
 *     OPTIONAL — the base class is a fully-functional concrete stage
 *     for every layout in the {@link STAGES} registry.
 *
 *   • The class encapsulates the design→viewport transform so the
 *     scene doesn't have to keep two copies of the same math in sync.
 *     Every coordinate-conversion helper (`designToViewportX`,
 *     `getSpawnPoint`, `getViewportBlastZone`) reads from the
 *     transform that was used to construct the bodies — no drift
 *     possible.
 *
 * Determinism contract:
 *
 *   • `tickHazards(frame)` advances every hazard entity by exactly
 *     one fixed step. Two simulations driven through identical
 *     `tickHazards` call sequences produce identical hazard state.
 *
 *   • `applyHazardEffects(frame)` is a pure function of (overlap set,
 *     hazard active state). It fires KO/force callbacks in a fixed
 *     order across runs because the underlying watcher iterates its
 *     `Map` in insertion order.
 *
 *   • `updateRender(frame)` only mutates visuals — never simulation
 *     state — so calling it zero times (e.g. during a headless replay
 *     scrub) does not affect determinism.
 *
 * Phaser-binding boundary:
 *
 *   The class needs a `Phaser.Scene` to construct platform / hazard
 *   bodies and visuals. Once constructed, the per-frame methods only
 *   touch the scene through the rendered handles they already own —
 *   so a future headless replay scrubber that reuses BaseStage just
 *   needs a thin mock `Phaser.Scene` (the same pattern
 *   {@link StageRenderer.test.ts} already uses) and never has to fake
 *   the full Phaser API surface.
 */

import Phaser from 'phaser';
import type {
  BlastZone,
  StageHazard,
  StageLayout,
} from '../types';
import {
  LavaCollisionWatcher,
  WindForceController,
  type LavaCollisionEvent,
  type LavaMinimalBody,
  type WindCollisionEvent,
  type WindMinimalBody,
} from '../match';
import {
  STAGE_DESIGN_HEIGHT,
  STAGE_DESIGN_WIDTH,
} from './stageDefinitions';
import {
  renderStage,
  type RenderedStage,
  type StageRenderOptions,
  type PlatformVisualInputProvider,
} from './StageRenderer';
import {
  renderLavaHazards,
  type LavaHazardsRenderResult,
} from './LavaHazardRenderer';
import {
  renderWindHazards,
  type WindHazardsRenderResult,
} from './WindHazardRenderer';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * 2D coordinate pair, in Phaser viewport pixels (after design→viewport
 * scaling + centering offset). The same shape used by
 * {@link Phaser.Math.Vector2.toJSON}; declared as a plain object so
 * tests don't have to import Phaser to assert against it.
 */
export interface ViewportPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Callback fired by {@link BaseStage.applyHazardEffects} for every
 * fighter currently overlapping ACTIVE lava. The owning scene typically
 * forwards this to its `StockTracker.loseStock` so the same KO pipeline
 * that handles blast-zone touches handles lava deaths too.
 */
export type LavaKoListener = (
  playerIndex: number,
  hazardId: string,
  frame: number,
) => void;

/**
 * Callback fired by {@link BaseStage.applyHazardEffects} once per fixed
 * step for every fighter overlapping an active wind zone. The force
 * vector is the cosine-scaled per-frame nudge — the owning scene
 * typically integrates it into the fighter's velocity directly.
 */
export type WindForceListener = (
  playerIndex: number,
  hazardId: string,
  force: { x: number; y: number },
  frame: number,
) => void;

/**
 * Construction options for {@link BaseStage}. Every field is optional —
 * the defaults reproduce the same wiring `MatchScene` used before this
 * abstraction landed:
 *
 *   - `viewportSize` defaults to `scene.scale.gameSize` (the live
 *     viewport). Tests / headless rehydration can pass an explicit size
 *     so the design→viewport transform stays deterministic across
 *     environments.
 *   - `renderOptions` is forwarded verbatim to {@link renderStage}.
 *     Notably `drawBlastZone: true` keeps the existing M1/M2 dev-mode
 *     behaviour where the four blast-zone bands are visible.
 *   - The two listener fields wire the lava + wind hazard adapters.
 *     They are optional because tests / headless previews may not need
 *     them; production wiring always supplies them.
 */
export interface BaseStageOptions {
  /**
   * Override the viewport size used for the design→viewport
   * transform. Defaults to `scene.scale.gameSize`. Pass an explicit
   * size from tests / headless replay scrubbers so the transform
   * stays deterministic across environments.
   */
  readonly viewportSize?: { readonly width: number; readonly height: number };
  /**
   * Forwarded to {@link renderStage}. Use `drawBlastZone: true` to
   * surface the four edge bands; `skipBlastZoneBodies: true` to build
   * a builder-preview stage with no KO triggers; etc.
   */
  readonly renderOptions?: StageRenderOptions;
  /**
   * Lava-KO listener — called once per overlap session the first
   * frame the fighter touches active lava. The default
   * `LavaCollisionWatcher` only fires once per overlap; leaving and
   * re-entering the lava body is required to re-arm.
   */
  readonly onLavaKo?: LavaKoListener;
  /**
   * Wind-force listener — called every fixed step for every fighter
   * overlapping an active wind zone. Continuous: every active tick
   * fires.
   */
  readonly onWindForce?: WindForceListener;
}

/**
 * Snapshot of the design→viewport transform used to build this stage's
 * bodies and visuals. Exposed so subsystems that need to convert
 * design-space coordinates (HUD overlays, camera, debug graphics) can
 * read the same numbers the renderer used.
 */
export interface StageViewportTransform {
  readonly viewportScale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}

// ---------------------------------------------------------------------------
// BaseStage class
// ---------------------------------------------------------------------------

/**
 * Concrete, fully-functional stage runtime. Orchestrates the
 * `StageLayout` data into platform colliders, blast-zone sensor walls,
 * spawn-point lookups, and the lava + wind hazard lifecycles.
 *
 * Subclassable: future stage variants (M2 hazard polish, M3 custom
 * stages, M4 replay rehydration) can override targeted hooks
 * (`tickHazards`, `applyHazardEffects`, `onPlayerRegistered`,
 * `onPlayerUnregistered`) without re-implementing the rest of the
 * orchestration. The default implementations cover every layout
 * currently in the registry — subclassing is purely additive.
 */
export class BaseStage {
  // ---------------------------- Inputs --------------------------------------

  /** The `Phaser.Scene` that owns the rendered bodies + visuals. */
  protected readonly scene: Phaser.Scene;
  /** The authoring data record this stage was constructed from. */
  readonly layout: StageLayout;
  /** Construction options frozen at build time so a `restart()` can re-apply them. */
  protected readonly options: BaseStageOptions;

  // ---------------------------- Geometry ------------------------------------

  /**
   * Live `RenderedStage` handle from {@link renderStage}. Owns the
   * platform Matter bodies, the blast-zone sensor walls, the platform
   * visuals, and the optional blast-zone debug overlay.
   */
  readonly rendered: RenderedStage;

  /**
   * Cached design→viewport transform — same triple
   * (viewportScale, offsetX, offsetY) {@link renderStage} used
   * internally. Subsystems that need to convert design coordinates
   * (spawn points, HUD overlays, camera, custom hazards added in
   * later ACs) read this so a future viewport-resize listener only
   * has to update one source of truth.
   */
  readonly transform: StageViewportTransform;

  // ---------------------------- Hazards -------------------------------------

  /**
   * Lava hazard handles, one per `'lava'`-typed entry in
   * `layout.hazards`. `null` when the stage carries no lava hazards
   * (e.g. the flat / wind / crumbling / moving-platform stages).
   */
  readonly lavaHazards: LavaHazardsRenderResult | null;

  /**
   * Wind hazard handles, one per `'wind'`-typed entry in
   * `layout.hazards`. `null` when the stage carries no wind hazards.
   */
  readonly windHazards: WindHazardsRenderResult | null;

  /**
   * Lava overlap → instant-KO adapter. Constructed iff the layout
   * carries any `'lava'`-typed hazards AND an `onLavaKo` listener was
   * supplied to the stage. The collision-event forwarders
   * (`handleCollisionStart` / `handleCollisionEnd`) are no-ops when
   * this watcher is null — the stage stays cheap on non-lava layouts.
   */
  readonly lavaCollisionWatcher: LavaCollisionWatcher | null;

  /**
   * Wind overlap → per-frame force adapter. Constructed iff the
   * layout carries any `'wind'`-typed hazards AND an `onWindForce`
   * listener was supplied to the stage.
   */
  readonly windForceController: WindForceController | null;

  // ---------------------------- Lifecycle -----------------------------------

  /**
   * Tracks the most recent `frame` value passed to `tickHazards`. The
   * owning scene supplies the deterministic frame counter (e.g.
   * `physicsEngine.getFrame()`); the stage just remembers the last
   * value so `applyHazardEffects` can stamp it onto the listener
   * callbacks without the scene having to pass it twice.
   */
  protected lastTickedFrame: number = -1;

  /**
   * Idempotent destroy guard — `destroy()` is safe to call multiple
   * times during a transitional shutdown sequence.
   */
  protected destroyed: boolean = false;

  // ---------------------------- Construction --------------------------------

  /**
   * Build all bodies + visuals + adapters for `layout`. The stage is
   * "live" the moment the constructor returns: platform colliders are
   * in the world, blast-zone walls are firing pair events, hazard
   * entities are at frame 0, and the watchers are ready to receive
   * `registerPlayer` calls.
   *
   * Hazard *callbacks* are wired iff the matching listener was
   * supplied. A stage built with no `onLavaKo` listener still
   * constructs the lava bodies + visuals (so the player sees the lava
   * pool and walks safely above it), but an overlap will not produce
   * a stock loss. This is intentional — the stage builder preview
   * (M3) wants the same visuals without the gameplay consequences.
   */
  constructor(
    scene: Phaser.Scene,
    layout: StageLayout,
    options: BaseStageOptions = {},
  ) {
    if (!scene) {
      throw new Error('BaseStage: scene is required');
    }
    if (!layout) {
      throw new Error('BaseStage: layout is required');
    }
    this.scene = scene;
    this.layout = layout;
    this.options = options;

    // --- Geometry: platforms + blast-zone sensor walls + visuals -----------
    // Forward `renderOptions` verbatim so the caller can opt into the
    // blast-zone debug overlay, skip the sensor walls (builder preview),
    // or tweak fill / stroke colours without us having to mirror every
    // option here.
    this.rendered = renderStage(scene, layout, options.renderOptions);

    // --- Cache the design→viewport transform ------------------------------
    // We take the viewport size from the option override (tests /
    // headless) or fall back to the live `scene.scale.gameSize`. Both
    // paths use the SAME formula `renderStage` applies internally, so
    // the cached transform agrees with the rendered bodies.
    const vp = options.viewportSize ?? scene.scale.gameSize;
    const viewportWidth = vp.width;
    const viewportHeight = vp.height;
    const viewportScale = Math.min(
      viewportWidth / STAGE_DESIGN_WIDTH,
      viewportHeight / STAGE_DESIGN_HEIGHT,
    );
    const offsetX = (viewportWidth - STAGE_DESIGN_WIDTH * viewportScale) / 2;
    const offsetY = (viewportHeight - STAGE_DESIGN_HEIGHT * viewportScale) / 2;
    this.transform = Object.freeze({
      viewportScale,
      offsetX,
      offsetY,
      viewportWidth,
      viewportHeight,
    });

    // --- Lava hazards + adapter -------------------------------------------
    // Build the renderers iff the layout carries any 'lava'-typed
    // hazards. Build the watcher additionally iff the caller supplied
    // an `onLavaKo` listener — see class header for the "preview vs
    // production" rationale.
    const hasLava = this.layout.hazards.some(isLavaHazard);
    if (hasLava) {
      this.lavaHazards = renderLavaHazards(scene, layout, {
        viewportScale,
        offsetX,
        offsetY,
      });
    } else {
      this.lavaHazards = null;
    }

    if (hasLava && options.onLavaKo) {
      const onKo = options.onLavaKo;
      this.lavaCollisionWatcher = new LavaCollisionWatcher(
        (playerIndex, hazardId) => {
          onKo(playerIndex, hazardId, this.lastTickedFrame);
        },
      );
      // Register every lava entity↔body pair so an overlap can resolve
      // to a hazard id without the caller maintaining a parallel map.
      if (this.lavaHazards) {
        for (const handle of this.lavaHazards.hazards) {
          this.lavaCollisionWatcher.registerHazard(
            handle.entity,
            handle.body as unknown as LavaMinimalBody,
          );
        }
      }
    } else {
      this.lavaCollisionWatcher = null;
    }

    // --- Wind hazards + adapter -------------------------------------------
    const hasWind = this.layout.hazards.some(isWindHazard);
    if (hasWind) {
      this.windHazards = renderWindHazards(scene, layout, {
        viewportScale,
        offsetX,
        offsetY,
      });
    } else {
      this.windHazards = null;
    }

    if (hasWind && options.onWindForce) {
      const onForce = options.onWindForce;
      this.windForceController = new WindForceController(
        (playerIndex, hazardId, force) => {
          onForce(playerIndex, hazardId, force, this.lastTickedFrame);
        },
      );
      if (this.windHazards) {
        for (const handle of this.windHazards.hazards) {
          this.windForceController.registerHazard(
            handle.entity,
            handle.body as unknown as WindMinimalBody,
          );
        }
      }
    } else {
      this.windForceController = null;
    }
  }

  // ---------------------------- Geometry helpers ----------------------------

  /**
   * Convert a design-space X coordinate (e.g. a `StagePlatform.x` or
   * `spawnPoint.x`) into the matching viewport pixel.
   */
  designToViewportX(designX: number): number {
    return this.transform.offsetX + designX * this.transform.viewportScale;
  }

  /**
   * Convert a design-space Y coordinate into the matching viewport
   * pixel. Mirrors {@link designToViewportX}.
   */
  designToViewportY(designY: number): number {
    return this.transform.offsetY + designY * this.transform.viewportScale;
  }

  /**
   * Convert a design-space `(x, y)` pair to a viewport `(x, y)` pair
   * in one call. Convenience wrapper around the two helpers above so
   * call sites that already work with point shapes (HUD overlays,
   * spawn-point markers) don't have to destructure.
   */
  designToViewport(point: { readonly x: number; readonly y: number }): ViewportPoint {
    return {
      x: this.designToViewportX(point.x),
      y: this.designToViewportY(point.y),
    };
  }

  /**
   * Look up a spawn point by its index in `layout.spawnPoints`,
   * already converted to viewport coordinates so the caller can pass
   * the result straight to `Character.constructor({ spawnX, spawnY })`.
   *
   * Throws if the index is out of range — that is, if the layout
   * carries fewer spawn points than the lobby slot the caller is
   * trying to spawn. The current 4-stage roster always carries 4
   * spawn points so this is only reachable from a deliberately
   * malformed custom stage.
   */
  getSpawnPoint(spawnIndex: number): ViewportPoint {
    const spawn = this.layout.spawnPoints[spawnIndex];
    if (!spawn) {
      throw new Error(
        `BaseStage.getSpawnPoint: index ${spawnIndex} out of range ` +
          `(layout '${this.layout.id}' has ${this.layout.spawnPoints.length} spawn points).`,
      );
    }
    return this.designToViewport(spawn);
  }

  /**
   * The active stage's blast zone in *design* coordinates. Read by
   * the position-based KO watcher (which compares each fighter's
   * design-space centre-of-mass against the same rectangle), the
   * camera bounds setter, and any debug overlay that wants to draw
   * the four edges. Returns the same reference held on
   * `layout.blastZone` — no allocation per call.
   */
  getBlastZone(): BlastZone {
    return this.layout.blastZone;
  }

  /**
   * The blast zone projected into viewport coordinates — what the
   * Matter `world.bounds` rectangle wants. The four physical
   * walls are intentionally disabled by the renderer (fighters MUST
   * fly past the blast zone for the KO sensors to fire), so the
   * caller usually only needs this to drive `matter.world.setBounds`
   * for broadphase metadata.
   */
  getViewportBlastZone(): {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  } {
    const z = this.layout.blastZone;
    const scale = this.transform.viewportScale;
    return {
      x: this.transform.offsetX + z.left * scale,
      y: this.transform.offsetY + z.top * scale,
      width: (z.right - z.left) * scale,
      height: (z.bottom - z.top) * scale,
    };
  }

  // ---------------------------- Player registration -------------------------

  /**
   * Register a fighter's body with every stage-owned watcher so the
   * stage can deliver KO / force callbacks for them. Forwards to:
   *
   *   • {@link LavaCollisionWatcher.registerPlayer} (if the stage has
   *     lava hazards AND an `onLavaKo` listener was supplied).
   *   • {@link WindForceController.registerPlayer} (if the stage has
   *     wind hazards AND an `onWindForce` listener was supplied).
   *
   * The {@link BlastZoneWatcher} / {@link BlastZonePositionWatcher}
   * registration stays at the {@link MatchScene} layer because those
   * watchers are scene-scoped (they outlive any single stage when the
   * scene transitions back to the menu) — the stage only owns the
   * hazard-specific watchers it constructed.
   *
   * Subclasses can override {@link onPlayerRegistered} to wire
   * additional stage-specific systems (e.g. a future trap-timer
   * watcher) without re-implementing the lava/wind dispatch above.
   */
  registerPlayer(playerIndex: number, body: unknown): void {
    if (this.lavaCollisionWatcher) {
      this.lavaCollisionWatcher.registerPlayer(
        playerIndex,
        body as LavaMinimalBody,
      );
    }
    if (this.windForceController) {
      this.windForceController.registerPlayer(
        playerIndex,
        body as WindMinimalBody,
      );
    }
    this.onPlayerRegistered(playerIndex, body);
  }

  /**
   * Unregister a fighter from every stage-owned watcher — typically
   * called when the slot is eliminated or the scene shuts down.
   * Idempotent on already-removed slots.
   */
  unregisterPlayer(playerIndex: number): void {
    if (this.lavaCollisionWatcher?.isRegistered(playerIndex)) {
      this.lavaCollisionWatcher.unregisterPlayer(playerIndex);
    }
    if (this.windForceController?.isRegistered(playerIndex)) {
      this.windForceController.unregisterPlayer(playerIndex);
    }
    this.onPlayerUnregistered(playerIndex);
  }

  /**
   * Subclass hook fired AFTER `registerPlayer` finishes wiring the
   * default watchers. Default implementation is a no-op so plain
   * `BaseStage` instances pay no cost.
   */
  protected onPlayerRegistered(_playerIndex: number, _body: unknown): void {
    /* no-op — subclass extension point */
  }

  /**
   * Subclass hook fired AFTER `unregisterPlayer` finishes dropping
   * the slot from the default watchers. Default implementation is a
   * no-op.
   */
  protected onPlayerUnregistered(_playerIndex: number): void {
    /* no-op — subclass extension point */
  }

  // ---------------------------- Collision routing ---------------------------

  /**
   * Forward a Matter `collisionstart` event to every hazard watcher
   * the stage owns. The owning scene wires this once on the world's
   * `collisionstart` channel; the stage takes care of fanning it out
   * to lava + wind (and any future hazard family).
   *
   * Cheap on non-hazard stages — both branches short-circuit when the
   * watcher is null. Subclasses can override to add stage-specific
   * dispatch (a moving-platform "rider attached" event, etc.).
   */
  handleCollisionStart(event: LavaCollisionEvent | WindCollisionEvent): void {
    this.lavaCollisionWatcher?.handleCollisionStart(event);
    this.windForceController?.handleCollisionStart(event);
  }

  /**
   * Forward a Matter `collisionend` event. Lava + wind both need this
   * because the watcher decides "still overlapping" off the live set,
   * not off `collisionstart` alone.
   */
  handleCollisionEnd(event: LavaCollisionEvent | WindCollisionEvent): void {
    this.lavaCollisionWatcher?.handleCollisionEnd(event);
    this.windForceController?.handleCollisionEnd(event);
  }

  /**
   * True iff the stage's hazard set requires the owning scene to
   * subscribe to Matter's `collisionend` channel. Lets the scene avoid
   * paying the listener cost on stages with no hazards (i.e. flat
   * stage). The blast-zone collision watcher only needs `collisionstart`,
   * so the scene's own subscription decision can read this field
   * verbatim.
   */
  needsCollisionEndChannel(): boolean {
    return this.lavaCollisionWatcher !== null || this.windForceController !== null;
  }

  // ---------------------------- Per-step lifecycle --------------------------

  /**
   * Tick every hazard entity by exactly one fixed step. Call BEFORE
   * `matter.world.step` so the freshly-computed bounds are reflected
   * in the next sensor body update — and so a fighter that walks onto
   * newly-active lava on this step gets KO'd at the same frame the
   * lava became lethal.
   *
   * Subclasses can override to layer additional hazard families on
   * top of the lava + wind defaults; remember to call `super.tickHazards(frame)`
   * so the base hazards still advance.
   */
  tickHazards(frame: number): void {
    if (this.destroyed) return;
    this.lastTickedFrame = frame;
    if (this.lavaHazards) {
      for (const handle of this.lavaHazards.hazards) {
        handle.entity.tick();
      }
      this.lavaHazards.update();
    }
    if (this.windHazards) {
      for (const handle of this.windHazards.hazards) {
        handle.entity.tick();
      }
      this.windHazards.update();
    }
  }

  /**
   * Drain the lava-KO + wind-force overlap queues. Call AFTER
   * `matter.world.step` so the freshly-settled overlap pairs reflect
   * the current step's motion. Each overlap fires its callback exactly
   * once per active tick (lava: once per overlap session; wind: once
   * per active frame).
   */
  applyHazardEffects(frame: number): void {
    if (this.destroyed) return;
    this.lastTickedFrame = frame;
    this.lavaCollisionWatcher?.tick();
    this.windForceController?.tick();
  }

  /**
   * Render-time refresh — re-syncs platform visual states (drop-
   * through fade, moving-platform offset, crumble wobble) and hazard
   * visuals to the current frame. Call once per render frame; pass
   * the deterministic physics frame so the wobble jitter stays
   * replay-stable.
   *
   * `provider` is the same per-platform runtime-state lookup
   * documented on {@link RenderedStage.updateVisuals}; pass `undefined`
   * for stages with no per-platform runtime entities (the renderer
   * falls back to the platform's static base behavior).
   */
  updateRender(frame: number, provider?: PlatformVisualInputProvider): void {
    if (this.destroyed) return;
    this.rendered.updateVisuals(frame, provider);
    // Hazard visuals are already re-synced inside `tickHazards`
    // (because the entity tick precedes the visual update), but
    // calling them here again is safe + idempotent and keeps the
    // visuals fresh on render frames that don't carry a fixed step
    // (the deterministic loop renders zero-or-N times per rAF tick).
    this.lavaHazards?.update();
    this.windHazards?.update();
  }

  // ---------------------------- Teardown ------------------------------------

  /**
   * Tear down all bodies + visuals + watchers in the safe order:
   *
   *   1. Reset the watchers (so a final `collisionend` event fired
   *      mid-shutdown can't reach a half-torn-down state).
   *   2. Destroy the hazard renderers (drops sensor bodies + visuals).
   *   3. Destroy the rendered stage handle (drops platform bodies +
   *      blast-zone sensor walls + platform visuals + debug overlays).
   *
   * Idempotent — safe to call multiple times during a transitional
   * shutdown sequence.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    // 1. Reset watchers FIRST so a stray late `collisionend` can't
    //    fire callbacks against entities we're about to destroy.
    this.lavaCollisionWatcher?.reset();
    this.windForceController?.reset();
    // 2. Destroy hazard renderers — drops sensor bodies + visuals.
    this.lavaHazards?.destroy();
    this.windHazards?.destroy();
    // 3. Destroy the platform/blast-zone geometry last.
    this.rendered.destroy();
  }

  /** True iff `destroy()` has been called. Useful for late-tick guards. */
  isDestroyed(): boolean {
    return this.destroyed;
  }
}

// ---------------------------------------------------------------------------
// Type guards (kept private to the module — the public surface stays small)
// ---------------------------------------------------------------------------

/**
 * Predicate guard for a `'lava'`-typed `StageHazard`. Lifted to a
 * named function so the constructor's "build hazard pipeline iff there's
 * at least one lava entry" check reads naturally.
 */
function isLavaHazard(h: StageHazard): boolean {
  return h.type === 'lava';
}

/**
 * Predicate guard for a `'wind'`-typed `StageHazard`. Mirrors
 * {@link isLavaHazard}.
 */
function isWindHazard(h: StageHazard): boolean {
  return h.type === 'wind';
}
