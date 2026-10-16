import * as THREE from 'three';
import { PX_PER_UNIT } from '../space';
import { SpriteLayer, type SpriteDraw } from '../sprites/spriteLayer';
import { TextureStore } from '../sprites/textureStore';
import { geometryPreparationHost, presentationTarget, type AppearanceSubmission } from './submission';

/** Composite previews use the same ordered host as the match. This cache owns
 * shared textures; each snapshot owns only its temporary layer and output. */
export class AppearanceSnapshotter {
  private readonly textures = new TextureStore();
  private renderer: THREE.WebGLRenderer | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  snapshot(appearance: AppearanceSubmission, signal?: AbortSignal): Promise<HTMLCanvasElement> {
    const job = this.queue.then(() => this.render(appearance, signal));
    this.queue = job.catch(() => undefined);
    return job;
  }
  private async render(appearance: AppearanceSubmission, signal?: AbortSignal): Promise<HTMLCanvasElement> {
    const cancelled = () => signal?.aborted || appearance.active === false;
    if (cancelled()) throw new Error('Appearance preview cancelled');
    const renderer = this.renderer ??= this.createRenderer();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 100);
    camera.position.z = 10;
    const layer = new SpriteLayer(this.textures);
    try {
      await appearance.prepare?.(signal, geometryPreparationHost(renderer, layer.scene, camera));
      const sprites: SpriteDraw[] = [];
      appearance.submit({ sprite: draw => sprites.push(draw), geometry: () => undefined });
      await Promise.all([...new Set(sprites.map(draw => draw.key))].map(key => this.textures.load(key)));
      if (cancelled()) throw new Error('Appearance preview cancelled');
      appearance.submit(presentationTarget(layer));
      layer.flush();
      layer.scene.updateMatrixWorld(true);
      const bounds = new THREE.Box3();
      layer.scene.traverse(object => {
        if (object instanceof THREE.Mesh && object.visible && object.parent?.visible !== false) bounds.expandByObject(object);
      });
      if (bounds.isEmpty()) throw new Error('Appearance preview contains no visible geometry');
      const width = Math.max(1, Math.ceil((bounds.max.x - bounds.min.x) * PX_PER_UNIT));
      const height = Math.max(1, Math.ceil((bounds.max.y - bounds.min.y) * PX_PER_UNIT));
      Object.assign(camera, { left: bounds.min.x, right: bounds.max.x, bottom: bounds.min.y, top: bounds.max.y });
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      renderer.clear();
      renderer.render(layer.scene, camera);
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d')!.drawImage(renderer.domElement, 0, 0);
      return canvas;
    } finally { layer.dispose(); }
  }
  private createRenderer(): THREE.WebGLRenderer {
    THREE.ColorManagement.enabled = false;
    const renderer = new THREE.WebGLRenderer({ alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    return renderer;
  }
}
