import type { StageLayout } from '../types';
import type { Body, PhysicsWorld } from '../physics/PhysicsWorld';
import { COLLISION_CATEGORIES, COLLISION_MASKS } from '../engine/collisionCategories';
import { computeStageViewportTransform, type StageViewportSize } from './stageViewport';
import { getPlatformBehavior } from './platformBehavior';
import { createPlatformMotion, type PlatformRider } from './platformMotion';
import { computeMovingPlatformOffset } from './platformVisualState';
import type { LedgeCandidate } from '../characters/ledgeDetection';

/**
 * The simulation half of a stage (STEP5-DESIGN 5.4): one static Matter body
 * per platform and the four blast-zone sensor walls, the per-step platform
 * motion and the ledge corners. Phaser-free; `StageRenderer` draws on top.
 *
 * Collision rules: solid platforms collide with characters, projectiles and
 * items; pass-through platforms get their own category and a character-only
 * mask so the pass-through driver can phase them per fighter. The blast-zone
 * walls are `isStatic + isSensor`: they never push, they only fire
 * `collisionstart` for the KO watcher.
 *
 * Stages are authored at the design resolution (1920×1080) and fitted to the
 * viewport uniformly (stageViewport.ts).
 */

/** Matter `label` strings — used by the character controller for collision rules. */
export const PLATFORM_LABELS = {
  solid: 'platform.solid',
  passThrough: 'platform.passThrough',
} as const;

/** Matter `label` strings of the four blast-zone walls (which edge a body crossed). */
export const BLAST_ZONE_LABELS = {
  top: 'blastZone.top',
  bottom: 'blastZone.bottom',
  left: 'blastZone.left',
  right: 'blastZone.right',
} as const;

/**
 * Blast-zone wall thickness (design px): far more than the fastest body moves
 * in one step (~30 px), so nothing tunnels through between physics steps.
 */
const BLAST_ZONE_WALL_THICKNESS = 200;

export interface StageBodiesOptions {
  /** Viewport the design space is fitted to (STEP5-DESIGN F8). */
  readonly viewportSize: StageViewportSize;
  /** Skip the blast-zone sensor walls (stage-builder preview). Default: false. */
  readonly skipBlastZoneBodies?: boolean;
}

export interface StageBodies {
  readonly layout: StageLayout;
  /** Matter bodies, one per platform, in layout order. */
  readonly platformBodies: ReadonlyArray<Body>;
  /** Blast-zone sensor walls — `[top, bottom, left, right]` (empty when skipped). */
  readonly blastZoneBodies: ReadonlyArray<Body>;
  /** Uniform scale factor applied (active width / design width). */
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  /** Move collider bodies and their supported riders once per fixed step. */
  updatePlatforms(frame: number, riders?: ReadonlyArray<PlatformRider>): void;
  /** Grabbable corners derived from current solid-body bounds. */
  getLedgeCandidates(): ReadonlyArray<LedgeCandidate>;
  /** Remove every body from the world. Idempotent. */
  destroy(): void;
}

/** Build every platform body and blast-zone wall of a stage, in layout order. */
export function createStageBodies(
  physics: Pick<PhysicsWorld, 'add' | 'body' | 'world'>,
  layout: StageLayout,
  options: StageBodiesOptions,
): StageBodies {
  const { viewportScale: scale, offsetX, offsetY } = computeStageViewportTransform(options.viewportSize);
  const platformBodies: Body[] = [];
  for (const [platformIndex, p] of layout.platforms.entries()) {
    const initialOffset = getPlatformBehavior(p) === 'moving' && p.motion
      ? computeMovingPlatformOffset(p.motion, 0) : { x: 0, y: 0 };
    const isPass = p.passThrough;
    platformBodies.push(physics.add.rectangle(
      offsetX + (p.x + initialOffset.x) * scale,
      offsetY + (p.y + initialOffset.y) * scale,
      p.width * scale,
      p.height * scale,
      {
        isStatic: true,
        label: isPass ? PLATFORM_LABELS.passThrough : PLATFORM_LABELS.solid,
        friction: 0.6,
        collisionFilter: {
          category: isPass ? COLLISION_CATEGORIES.PLATFORM_PASS_THROUGH : COLLISION_CATEGORIES.PLATFORM_SOLID,
          mask: isPass ? COLLISION_MASKS.PLATFORM_PASS_THROUGH : COLLISION_MASKS.PLATFORM_SOLID,
          group: 0,
        },
        // The flag on `plugin` keeps pass-through discoverable inside collision callbacks.
        plugin: { passThrough: isPass, platformId: p.id ?? `plat${platformIndex}` },
      },
    ));
  }

  const blastZoneBodies: Body[] = [];
  if (!options.skipBlastZoneBodies) {
    const z = layout.blastZone;
    const t = BLAST_ZONE_WALL_THICKNESS;
    // Four walls outside the blast-zone rectangle, inner edge on the line; the
    // top and bottom overhang both sides so the corners are sealed.
    const wallSpecs: Array<[string, number, number, number, number]> = [
      [BLAST_ZONE_LABELS.top, (z.left + z.right) / 2, z.top - t / 2, z.right - z.left + t * 2, t],
      [BLAST_ZONE_LABELS.bottom, (z.left + z.right) / 2, z.bottom + t / 2, z.right - z.left + t * 2, t],
      [BLAST_ZONE_LABELS.left, z.left - t / 2, (z.top + z.bottom) / 2, t, z.bottom - z.top],
      [BLAST_ZONE_LABELS.right, z.right + t / 2, (z.top + z.bottom) / 2, t, z.bottom - z.top],
    ];
    for (const [label, dcx, dcy, dw, dh] of wallSpecs) {
      blastZoneBodies.push(physics.add.rectangle(offsetX + dcx * scale, offsetY + dcy * scale, dw * scale, dh * scale, {
        isStatic: true,
        isSensor: true,
        label,
        collisionFilter: { category: COLLISION_CATEGORIES.BLAST_ZONE, mask: COLLISION_MASKS.BLAST_ZONE, group: 0 },
        plugin: { blastZoneEdge: label },
      }));
    }
  }

  let destroyed = false;
  const movePlatforms = createPlatformMotion(layout.platforms, platformBodies,
    { scale, offsetX, offsetY }, (body, point) => physics.body.setPosition(body, point));
  return {
    layout,
    platformBodies,
    blastZoneBodies,
    scale,
    offsetX,
    offsetY,
    updatePlatforms(frame, riders) {
      if (!destroyed) movePlatforms(frame, riders);
    },
    getLedgeCandidates() {
      if (destroyed) return [];
      return layout.platforms.flatMap((platform, i) => {
        const body = platformBodies[i]!;
        if (platform.passThrough || body.collisionFilter?.mask === 0) return [];
        const bounds = body.bounds;
        const halfWidth = platform.width * scale / 2;
        const top = bounds?.min.y ?? body.position.y - platform.height * scale / 2;
        const platformId = platform.id ?? `plat${i}`;
        return [
          { platformId, side: 'left' as const, x: bounds?.min.x ?? body.position.x - halfWidth, y: top },
          { platformId, side: 'right' as const, x: bounds?.max.x ?? body.position.x + halfWidth, y: top },
        ];
      });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const body of [...platformBodies, ...blastZoneBodies]) physics.world?.remove(body);
    },
  };
}
