import * as THREE from 'three';
import { prepareSceneShaders } from '../prepareShaders';
import type { AppearancePreparation } from '../../../../src/characterPresentation/contracts';
import type { SpriteDraw, SpriteLayer } from '../sprites/spriteLayer';

/** Both submissions share the existing stable depth/submission ordering. Geometry
 * uses the design-plane camera, clipping and transparent coverage of sprites. */
export interface PresentationTarget {
  /** Current stage light, evaluated at submission after the stage update. */
  readonly tint?: number;
  sprite(draw: SpriteDraw): void;
  geometry(geometry: ManagedGeometry, depth: number): void;
}

/** A capability can submit geometry without producing an image or a sprite. */
export interface AppearancePreparationHost {
  prepareGeometry(geometry: ManagedGeometry, signal: AbortSignal): Promise<void>;
}

export interface AppearanceSubmission {
  readonly pass?: 'world' | 'screen';
  readonly active?: boolean;
  /** Changes when a reset invalidates an earlier pending preparation. */
  readonly preparationGeneration?: number;
  prepare?(signal?: AbortSignal, host?: AppearancePreparationHost): Promise<AppearancePreparation>;
  submit(target: PresentationTarget): void;
}

export function presentationTarget(layer: SpriteLayer, tint?: number): PresentationTarget {
  return { tint, sprite: draw => layer.draw(draw), geometry: (geometry, depth) => layer.drawGeometry(geometry, depth) };
}

/** Instance-owned geometry/materials. Textures are explicitly shared and are
 * never disposed here. The host only borrows this node for its current pass. */
export class ManagedGeometry {
  private disposed = false;
  constructor(readonly node: THREE.Object3D) {
    node.traverse(object => {
      // Group ordering must not move a mixed composition out of the common queue.
      object.renderOrder = 0;
      if (!(object instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        material.transparent = true;
        material.depthTest = false;
        material.depthWrite = false;
      }
    });
  }
  get active(): boolean { return !this.disposed; }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.node.removeFromParent();
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    this.node.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
  }
}

const geometryPreparations = new WeakMap<ManagedGeometry, { token: object; parent: THREE.Object3D | null; visible: boolean }>();

/** Compile hidden instance-owned nodes in their actual world/screen scene. */
export function geometryPreparationHost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): AppearancePreparationHost {
  return { async prepareGeometry(geometry, signal) {
    if (!geometry.active || signal.aborted) throw new Error('Appearance preparation cancelled');
    const node = geometry.node, prior = geometryPreparations.get(geometry);
    const token = {}, parent = prior ? prior.parent : node.parent, visible = prior ? prior.visible : node.visible;
    geometryPreparations.set(geometry, { token, parent, visible });
    node.visible = false;
    scene.add(node);
    try { await prepareSceneShaders(renderer, scene, camera, signal); }
    finally {
      // An older aborted preparation must not reveal/detach a newer revision.
      if (geometryPreparations.get(geometry)?.token === token) {
        geometryPreparations.delete(geometry);
        node.removeFromParent();
        node.visible = visible;
        if (geometry.active && !signal.aborted && parent) parent.add(node);
      }
    }
  } };
}
