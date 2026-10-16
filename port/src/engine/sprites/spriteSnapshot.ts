import * as THREE from 'three';
import { STAGE_DESIGN_HEIGHT, STAGE_DESIGN_WIDTH } from '../../../../src/stages/stageDefinitions';
import { PX_PER_UNIT } from '../space';
import { SpriteLayer, type SpriteDraw } from './spriteLayer';
import { TextureStore } from './textureStore';

/**
 * Draws one sprite, recolour included, to a canvas for HTML (menu art), so
 * menus show exactly what the game draws. One small offscreen renderer;
 * each sprite is drawn at its frame's native resolution, centred.
 */
export class SpriteSnapshotter {
  private readonly textures = new TextureStore();
  private readonly layer = new SpriteLayer(this.textures);
  private readonly camera = new THREE.OrthographicCamera();
  private renderer: THREE.WebGLRenderer | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  /** Snapshots run one at a time on the shared renderer. */
  snapshot(draw: SpriteDraw): Promise<HTMLCanvasElement> {
    const job = this.queue.then(() => this.render(draw));
    this.queue = job.catch(() => undefined);
    return job;
  }

  private async render(draw: SpriteDraw): Promise<HTMLCanvasElement> {
    const sheet = await this.textures.load(draw.key);
    const scale = Math.abs(draw.scaleX ?? 1);
    const w = sheet.frameWidth, h = sheet.frameHeight;
    const renderer = this.renderer ??= this.createRenderer();
    renderer.setSize(w, h, false);
    // Centre of the design space is the world origin; frame the sprite's box there.
    const halfW = (w * scale) / PX_PER_UNIT / 2, halfH = (h * scale) / PX_PER_UNIT / 2;
    Object.assign(this.camera, { left: -halfW, right: halfW, top: halfH, bottom: -halfH, near: 0.1, far: 100 });
    this.camera.position.set(0, 0, 10);
    this.camera.updateProjectionMatrix();
    this.layer.draw({ ...draw, x: STAGE_DESIGN_WIDTH / 2, y: STAGE_DESIGN_HEIGHT / 2, originX: 0.5, originY: 0.5, depth: 0 });
    this.layer.flush();
    renderer.clear();
    renderer.render(this.layer.scene, this.camera);
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    out.getContext('2d')!.drawImage(renderer.domElement, 0, 0);
    return out;
  }

  private createRenderer(): THREE.WebGLRenderer {
    THREE.ColorManagement.enabled = false;
    const renderer = new THREE.WebGLRenderer({ alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    return renderer;
  }
}
