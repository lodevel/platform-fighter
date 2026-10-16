import { COLLISION_CATEGORIES, COLLISION_MASKS } from '../engine/collisionCategories';
import { createLavaHazardFromStageHazard, type LavaHazard } from '../entities/LavaHazard';
import { createWindHazardFromStageHazard, type WindZoneHazard } from '../entities/WindZoneHazard';
import type { StageLayout } from '../types';
import { LAVA_HAZARD_LABEL_PREFIX } from '../match/LavaCollisionWatcher';
import { WIND_HAZARD_LABEL_PREFIX } from '../match/WindForceController';
import type { Body, PhysicsWorld } from '../physics/PhysicsWorld';
import type { StageViewportTransform } from './stageViewport';

/**
 * The simulation half of the lava and wind hazards (STEP5-DESIGN 5.4):
 * the Matter sensor body of each hazard and its per-step sync from the
 * entity. Phaser-free; `BaseStage` owns them, and the Phaser renderers
 * (`LavaHazardRenderer`, `WindHazardRenderer`) only draw rectangles from the
 * same geometry.
 */

/**
 * Minimum lava body height (design px). Matter requires a non-degenerate
 * body (below ~0.1 px risks NaN broadphase normals), so the sensor floors
 * at 1 px and its collision mask is switched off while the lava is inactive.
 */
export const MIN_LAVA_SENSOR_HEIGHT_DESIGN_PX = 1;

/** A hazard body's viewport geometry for one step (what the visual draws). */
export interface HazardBodyGeometry {
  readonly centerX: number;
  readonly centerY: number;
  readonly width: number;
  readonly height: number;
}

/** Lava geometry plus the design height the glow strip is placed from. */
export interface LavaBodyGeometry extends HazardBodyGeometry {
  readonly heightDesign: number;
}

/** A body some callers fake with a `setPosition` method (tests); Matter bodies have none. */
type SyncedBody = Body & {
  setPosition?: (pos: { x: number; y: number }) => void;
  vertices?: Array<{ x: number; y: number }>;
};

function setBodyCentre(body: SyncedBody, x: number, y: number): void {
  if (typeof body.setPosition === 'function') {
    body.setPosition({ x, y });
  } else {
    body.position.x = x;
    body.position.y = y;
  }
}

function setHazardMask(body: SyncedBody, active: boolean): void {
  if (body.collisionFilter) body.collisionFilter.mask = active ? COLLISION_MASKS.HAZARD : 0;
}

function hazardSensorOptions(label: string, hazardKind: 'lava' | 'wind', hazardId: string) {
  return {
    isStatic: true,
    isSensor: true,
    label,
    collisionFilter: { category: COLLISION_CATEGORIES.HAZARD, mask: COLLISION_MASKS.HAZARD, group: 0 },
    plugin: { hazardKind, hazardId },
  };
}

/** Current viewport geometry of a lava hazard. */
export function lavaBodyGeometry(hazard: LavaHazard, t: StageViewportTransform): LavaBodyGeometry {
  const bounds = hazard.getBounds();
  const heightDesign = Math.max(MIN_LAVA_SENSOR_HEIGHT_DESIGN_PX, bounds.height);
  return {
    centerX: t.offsetX + bounds.x * t.viewportScale,
    centerY: t.offsetY + (hazard.getBaseY() - heightDesign / 2) * t.viewportScale,
    width: hazard.getWidth() * t.viewportScale,
    height: heightDesign * t.viewportScale,
    heightDesign,
  };
}

/** Create the lava sensor body (label `hazard.lava.<id>`) at the hazard's current geometry. */
export function createLavaHazardBody(physics: Pick<PhysicsWorld, 'add'>, hazard: LavaHazard, t: StageViewportTransform): Body {
  const g = lavaBodyGeometry(hazard, t);
  const id = hazard.getId();
  return physics.add.rectangle(g.centerX, g.centerY, g.width, g.height,
    hazardSensorOptions(`${LAVA_HAZARD_LABEL_PREFIX}${id}`, 'lava', id));
}

/**
 * Move the lava body to the entity's current height: centre, the four
 * vertices written in place, and the mask on only while the lava is active.
 * Returns the geometry for the visual.
 */
export function syncLavaHazardBody(body: Body, hazard: LavaHazard, t: StageViewportTransform): LavaBodyGeometry {
  const g = lavaBodyGeometry(hazard, t);
  const synced = body as SyncedBody;
  setBodyCentre(synced, g.centerX, g.centerY);
  if (Array.isArray(synced.vertices) && synced.vertices.length === 4) {
    const halfW = g.width / 2;
    const halfH = g.height / 2;
    synced.vertices[0]!.x = g.centerX - halfW;
    synced.vertices[0]!.y = g.centerY - halfH;
    synced.vertices[1]!.x = g.centerX + halfW;
    synced.vertices[1]!.y = g.centerY - halfH;
    synced.vertices[2]!.x = g.centerX + halfW;
    synced.vertices[2]!.y = g.centerY + halfH;
    synced.vertices[3]!.x = g.centerX - halfW;
    synced.vertices[3]!.y = g.centerY + halfH;
  }
  setHazardMask(synced, hazard.isActive());
  return g;
}

/** Current viewport geometry of a wind zone. */
export function windBodyGeometry(hazard: WindZoneHazard, t: StageViewportTransform): HazardBodyGeometry {
  const bounds = hazard.getBounds();
  return {
    centerX: t.offsetX + bounds.x * t.viewportScale,
    centerY: t.offsetY + bounds.y * t.viewportScale,
    width: bounds.width * t.viewportScale,
    height: bounds.height * t.viewportScale,
  };
}

/** Create the wind sensor body (label `hazard.wind.<id>`) at the zone's current geometry. */
export function createWindHazardBody(physics: Pick<PhysicsWorld, 'add'>, hazard: WindZoneHazard, t: StageViewportTransform): Body {
  const g = windBodyGeometry(hazard, t);
  const id = hazard.getId();
  return physics.add.rectangle(g.centerX, g.centerY, g.width, g.height,
    hazardSensorOptions(`${WIND_HAZARD_LABEL_PREFIX}${id}`, 'wind', id));
}

/** Move the wind body to the zone's current bounds; mask on only while active. Returns the geometry. */
export function syncWindHazardBody(body: Body, hazard: WindZoneHazard, t: StageViewportTransform): HazardBodyGeometry {
  const g = windBodyGeometry(hazard, t);
  const synced = body as SyncedBody;
  setBodyCentre(synced, g.centerX, g.centerY);
  setHazardMask(synced, hazard.isActive());
  return g;
}

/** One hazard entity and its sensor body. */
export interface StageHazardBody<E> {
  readonly entity: E;
  readonly body: Body;
}

/** A stage's lava and wind hazards (entities + sensor bodies), in layout order. */
export interface StageHazardBodies {
  readonly lava: ReadonlyArray<StageHazardBody<LavaHazard>>;
  readonly wind: ReadonlyArray<StageHazardBody<WindZoneHazard>>;
}

/**
 * Build every lava hazard, then every wind zone, of a layout: the entity and
 * its sensor body, synced once at creation (the per-step sync writes the
 * vertices in place, so the first sync fixes them exactly as every later one).
 */
export function createStageHazardBodies(
  physics: Pick<PhysicsWorld, 'add'>,
  layout: StageLayout,
  t: StageViewportTransform,
): StageHazardBodies {
  const lava = layout.hazards.flatMap(hazard => {
    if (hazard.type !== 'lava') return [];
    const entity = createLavaHazardFromStageHazard(hazard);
    const body = createLavaHazardBody(physics, entity, t);
    syncLavaHazardBody(body, entity, t);
    return [{ entity, body }];
  });
  const wind = layout.hazards.flatMap(hazard => {
    if (hazard.type !== 'wind') return [];
    const entity = createWindHazardFromStageHazard(hazard);
    const body = createWindHazardBody(physics, entity, t);
    syncWindHazardBody(body, entity, t);
    return [{ entity, body }];
  });
  return { lava, wind };
}
