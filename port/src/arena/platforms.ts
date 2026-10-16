import * as THREE from 'three';
import { getPlatformBehavior } from '../../../src/stages/platformBehavior';
import { computeMovingPlatformOffset } from '../../../src/stages/platformVisualState';
import type { StageLayout, StagePlatform } from '../../../src/types';
import { toWorldLength, toWorldX, toWorldY } from '../engine/space';
import type { PlatformSpec, ThemeHooks } from './contract';
import { outlineRect } from './outline';

export const platformKind = (p: StagePlatform): PlatformSpec['kind'] => {
  const behavior = getPlatformBehavior(p);
  return behavior === 'moving' ? 'moving' : behavior === 'pass-through' ? 'floating' : 'ground';
};

export interface PlatformSnapshot {
  readonly id: string; readonly x: number; readonly y: number;
  readonly width: number; readonly height: number; readonly active: boolean;
}

/**
 * The layout's platforms as theme visuals. Each visual's top-front edge is
 * the platform's collision top; moving platforms follow the game's shared
 * `computeMovingPlatformOffset` path every frame.
 */
export function createPlatforms(scene: THREE.Scene, theme: ThemeHooks, layout: StageLayout) {
  let snapshots: ReadonlyMap<string, PlatformSnapshot> | null = null;
  const outlines = new THREE.Group();
  const placed = layout.platforms.map((p, index) => {
    const kind = platformKind(p);
    const visual = theme.platform({
      index, kind, width: toWorldLength(p.width), height: toWorldLength(p.height), travel: travelOf(p),
      x: toWorldX(p.x), top: toWorldY(p.y - p.height / 2),
    });
    const outline = outlineRect(toWorldLength(p.width), toWorldLength(p.height), kind === 'floating' ? 0x7ff3ff : 0xff3df0);
    scene.add(visual);
    outlines.add(outline);
    const place = (frame: number) => {
      const source = p.id ? snapshots?.get(p.id) : undefined;
      const offset = p.motion ? computeMovingPlatformOffset(p.motion, frame) : { x: 0, y: 0 };
      const x = toWorldX(source?.x ?? p.x + offset.x), y = toWorldY((source?.y ?? p.y + offset.y) - (source?.height ?? p.height) / 2);
      visual.visible = source?.active ?? true;
      outline.visible = source?.active ?? true;
      visual.position.x = x;
      visual.position.y = y;
      outline.position.set(x, y, 0);
    };
    place(0);
    return { place, moving: Boolean(p.motion) };
  });
  return {
    outlines,
    setSnapshots(state: readonly PlatformSnapshot[] | null) { snapshots = state ? new Map(state.map((entry) => [entry.id, entry])) : null; },
    update(frame: number) { placed.forEach((p) => { p.place(frame); }); },
  };
}

/** Extent of a platform's motion path, in world units. */
function travelOf(p: StagePlatform): PlatformSpec['travel'] {
  const points = p.motion?.waypoints ?? [];
  if (points.length < 2) return { x: 0, y: 0 };
  const xs = points.map((w) => w.x), ys = points.map((w) => w.y);
  return { x: toWorldLength(Math.max(...xs) - Math.min(...xs)), y: toWorldLength(Math.max(...ys) - Math.min(...ys)) };
}

/** World-space extent of the solid ground, which themes build their scenery around. */
export function groundExtent(layout: StageLayout) {
  const ground = layout.platforms.filter((p) => platformKind(p) === 'ground');
  const reference = ground.length ? ground : layout.platforms;
  const widest = reference.reduce((a, b) => (b.width > a.width ? b : a));
  return {
    groundTop: toWorldY(widest.y - widest.height / 2),
    groundLeft: Math.min(...reference.map((p) => toWorldX(p.x - p.width / 2))),
    groundRight: Math.max(...reference.map((p) => toWorldX(p.x + p.width / 2))),
  };
}
