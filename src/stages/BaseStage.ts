/**
 * `BaseStage` — the stage runtime of a match (AC 20101 Sub-AC 1), the
 * simulation half only (STEP5-DESIGN 5.4): Phaser-free, built on a
 * {@link PhysicsHost}. The drawing lives in `StageView.ts`.
 *
 * It owns, in body-creation order: the platform bodies and four blast-zone
 * sensor walls (`stageBodies.ts`), then every lava hazard, then every wind
 * zone (`hazardBodies.ts`), plus the lava / wind collision adapters. The
 * owning simulation only calls into it:
 *
 *   - `registerPlayer(slot, body)` / `unregisterPlayer(slot)` — fans out to
 *     every hazard adapter.
 *   - `updatePlatforms(frame, riders)` — moving platforms, once per step.
 *   - `tickHazards(frame)` — BEFORE the world step: advances every hazard
 *     entity once and syncs its sensor body.
 *   - `applyHazardEffects(frame)` / `applyLavaEffects(frame)` — AFTER the
 *     world step: drains the lava-KO and wind-force overlap queues.
 *   - `handleCollisionStart(event)` / `handleCollisionEnd(event)` —
 *     forwards Matter's pair stream to every hazard watcher.
 *   - `destroy()` — watchers first (a late `collisionend` can't reach a
 *     half-torn-down watcher), then hazard bodies, then the stage bodies.
 *
 * The design→viewport transform is cached on construction so spawn points,
 * blast zone and bodies always agree (STEP5-DESIGN F8).
 *
 * Determinism: `tickHazards` advances every hazard entity by exactly one
 * fixed step; `applyHazardEffects` fires KO/force callbacks in watcher
 * insertion order.
 */

import type { BlastZone, StageLayout } from '../types';
import type { PhysicsHost } from '../physics/PhysicsWorld';
import {
  LavaCollisionWatcher,
  type LavaCollisionEvent,
  type LavaMinimalBody,
} from '../match/LavaCollisionWatcher';
import {
  WindForceController,
  type WindCollisionEvent,
  type WindMinimalBody,
} from '../match/WindForceController';
import { computeStageViewportTransform, type StageViewportSize } from './stageViewport';
import { STAGE_DESIGN_HEIGHT, STAGE_DESIGN_WIDTH } from './stageDefinitions';
import { createStageBodies, type StageBodies } from './stageBodies';
import {
  createStageHazardBodies,
  syncLavaHazardBody,
  syncWindHazardBody,
  type StageHazardBodies,
} from './hazardBodies';
import type { PlatformRider } from './platformMotion';
import type { LedgeCandidate } from '../characters/ledgeDetection';
import { createGazeHazardFromStageHazard, type GazeHazard } from '../entities/GazeHazard';

/** A point in viewport pixels (after design→viewport scaling + centering). */
export interface ViewportPoint {
  readonly x: number;
  readonly y: number;
}

/** Fired for every fighter overlapping ACTIVE lava (forwarded to the stock loss). */
export type LavaKoListener = (
  playerIndex: number,
  hazardId: string,
  frame: number,
) => void;

/** Fired once per step for every fighter in an active wind zone (the per-frame nudge). */
export type WindForceListener = (
  playerIndex: number,
  hazardId: string,
  force: { x: number; y: number },
  frame: number,
) => void;

export interface BaseStageOptions {
  /** Viewport the design space is fitted to. Default: the design size 1920×1080 (the game's fixed size). */
  readonly viewportSize?: StageViewportSize;
  /** Skip the blast-zone sensor walls. Default: false. */
  readonly skipBlastZoneBodies?: boolean;
  /** Lava KO listener; the lava watcher is wired only when given and the layout has lava. */
  readonly onLavaKo?: LavaKoListener;
  /** Wind force listener; the wind controller is wired only when given and the layout has wind. */
  readonly onWindForce?: WindForceListener;
}

/** Cached design→viewport transform, plus the viewport it was derived from. */
export interface StageViewportTransform {
  readonly viewportScale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}

export class BaseStage {
  readonly layout: StageLayout;
  /** Platform bodies and blast-zone walls. */
  readonly bodies: StageBodies;
  readonly transform: StageViewportTransform;
  /** Lava hazards and wind zones (entity + sensor body), in layout order. */
  readonly hazards: StageHazardBodies;
  /** Body-free stage hazards use the same authoritative fixed clock. */
  readonly gazeHazards: readonly GazeHazard[];
  readonly lavaCollisionWatcher: LavaCollisionWatcher | null;
  readonly windForceController: WindForceController | null;
  /** Frame of the last hazard tick / lava drain, stamped onto listener callbacks. */
  protected lastTickedFrame: number = -1;
  protected destroyed: boolean = false;

  constructor(
    protected readonly host: PhysicsHost,
    layout: StageLayout,
    options: BaseStageOptions = {},
  ) {
    if (!host) throw new Error('BaseStage: physics host is required');
    if (!layout) throw new Error('BaseStage: layout is required');
    this.layout = layout;
    const vp = options.viewportSize ?? { width: STAGE_DESIGN_WIDTH, height: STAGE_DESIGN_HEIGHT };
    this.bodies = createStageBodies(host.matter, layout, {
      viewportSize: vp,
      skipBlastZoneBodies: options.skipBlastZoneBodies,
    });
    const { viewportScale, offsetX, offsetY } = computeStageViewportTransform(vp);
    this.transform = Object.freeze({
      viewportScale,
      offsetX,
      offsetY,
      viewportWidth: vp.width,
      viewportHeight: vp.height,
    });
    this.hazards = createStageHazardBodies(host.matter, layout, this.transform);
    this.gazeHazards=(layout.hazards??[]).filter(hazard=>hazard.type==='gaze').map(createGazeHazardFromStageHazard);

    if (this.hazards.lava.length > 0 && options.onLavaKo) {
      const onKo = options.onLavaKo;
      this.lavaCollisionWatcher = new LavaCollisionWatcher((playerIndex, hazardId) => {
        onKo(playerIndex, hazardId, this.lastTickedFrame);
      });
      for (const { entity, body } of this.hazards.lava) {
        this.lavaCollisionWatcher.registerHazard(entity, body as unknown as LavaMinimalBody);
      }
    } else {
      this.lavaCollisionWatcher = null;
    }

    if (this.hazards.wind.length > 0 && options.onWindForce) {
      const onForce = options.onWindForce;
      this.windForceController = new WindForceController((playerIndex, hazardId, force) => {
        onForce(playerIndex, hazardId, force, this.lastTickedFrame);
      });
      for (const { entity, body } of this.hazards.wind) {
        this.windForceController.registerHazard(entity, body as unknown as WindMinimalBody);
      }
    } else {
      this.windForceController = null;
    }
  }

  /** Design x → viewport x through the cached transform. */
  designToViewportX(designX: number): number {
    return this.transform.offsetX + designX * this.transform.viewportScale;
  }

  /** Design y → viewport y through the cached transform. */
  designToViewportY(designY: number): number {
    return this.transform.offsetY + designY * this.transform.viewportScale;
  }

  designToViewport(point: { readonly x: number; readonly y: number }): ViewportPoint {
    return { x: this.designToViewportX(point.x), y: this.designToViewportY(point.y) };
  }

  /** Spawn point `spawnIndex` in viewport pixels. Throws when out of range. */
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

  getBlastZone(): BlastZone {
    return this.layout.blastZone;
  }

  /** The blast zone in viewport pixels. */
  getViewportBlastZone(): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
    const z = this.layout.blastZone;
    const scale = this.transform.viewportScale;
    return {
      x: this.transform.offsetX + z.left * scale,
      y: this.transform.offsetY + z.top * scale,
      width: (z.right - z.left) * scale,
      height: (z.bottom - z.top) * scale,
    };
  }

  /** Register a fighter body with every hazard adapter. */
  registerPlayer(playerIndex: number, body: unknown): void {
    this.lavaCollisionWatcher?.registerPlayer(playerIndex, body as unknown as LavaMinimalBody);
    this.windForceController?.registerPlayer(playerIndex, body as unknown as WindMinimalBody);
    this.onPlayerRegistered(playerIndex, body);
  }

  /** Drop a fighter from every hazard adapter. Idempotent. */
  unregisterPlayer(playerIndex: number): void {
    if (this.lavaCollisionWatcher?.isRegistered(playerIndex)) {
      this.lavaCollisionWatcher.unregisterPlayer(playerIndex);
    }
    if (this.windForceController?.isRegistered(playerIndex)) {
      this.windForceController.unregisterPlayer(playerIndex);
    }
    this.onPlayerUnregistered(playerIndex);
  }

  /** Subclass extension point, after the default registration. */
  protected onPlayerRegistered(_playerIndex: number, _body: unknown): void {
    /* no-op */
  }

  /** Subclass extension point, after the default unregistration. */
  protected onPlayerUnregistered(_playerIndex: number): void {
    /* no-op */
  }

  handleCollisionStart(event: LavaCollisionEvent | WindCollisionEvent): void {
    this.lavaCollisionWatcher?.handleCollisionStart(event);
    this.windForceController?.handleCollisionStart(event);
  }

  handleCollisionEnd(event: LavaCollisionEvent | WindCollisionEvent): void {
    this.lavaCollisionWatcher?.handleCollisionEnd(event);
    this.windForceController?.handleCollisionEnd(event);
  }

  /** True when a hazard adapter needs the `collisionend` channel. */
  needsCollisionEndChannel(): boolean {
    return this.lavaCollisionWatcher !== null || this.windForceController !== null;
  }

  updatePlatforms(frame: number, riders?: ReadonlyArray<PlatformRider>): void {
    if (this.destroyed) return;
    this.bodies.updatePlatforms(frame, riders);
  }

  getLedgeCandidates(): ReadonlyArray<LedgeCandidate> {
    return this.bodies.getLedgeCandidates();
  }

  /** Hazard tick count, held during intro, pause and the GAME freeze. */
  getHazardFrame():number{return Math.max(0,this.lastTickedFrame+1);}

  /**
   * Advance every hazard entity by one fixed step and sync its sensor body
   * (lava first, then wind). Call BEFORE the world step so a fighter that
   * walks onto newly-active lava is KO'd on the frame it became lethal.
   */
  tickHazards(frame: number): void {
    if (this.destroyed) return;
    this.lastTickedFrame = frame;
    for (const { entity } of this.hazards.lava) entity.tick();
    for (const { entity, body } of this.hazards.lava) syncLavaHazardBody(body, entity, this.transform);
    for (const { entity } of this.hazards.wind) entity.tick();
    for (const { entity, body } of this.hazards.wind) syncWindHazardBody(body, entity, this.transform);
    for (const gaze of this.gazeHazards) gaze.tick();
  }

  /** Drain the lava-KO and wind-force queues. Call AFTER the world step. */
  applyHazardEffects(frame: number): void {
    if (this.destroyed) return;
    this.applyLavaEffects(frame);
    this.windForceController?.tick();
  }

  /** Lava only: also run after every reference substep so transient crossings KO. */
  applyLavaEffects(frame: number): void {
    if (this.destroyed) return;
    this.lastTickedFrame = frame;
    this.lavaCollisionWatcher?.tick();
  }

  /** Tear down in the safe order. Idempotent. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.lavaCollisionWatcher?.reset();
    this.windForceController?.reset();
    for (const { body } of [...this.hazards.lava, ...this.hazards.wind]) this.host.matter.world?.remove(body);
    this.bodies.destroy();
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }
}
