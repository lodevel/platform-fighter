import * as THREE from 'three';
import { STAGE_DESIGN_HEIGHT, STAGE_DESIGN_WIDTH } from '../../../../src/stages/stageDefinitions';
import { PX_PER_UNIT } from '../space';
import { SpriteLayer, type SpriteDraw } from './spriteLayer';
import { TextureStore } from './textureStore';

/**
 * An indexed drawing at page resolution as straight RGBA: each index through the palette row,
 * mirrored for `flipX`, times tint and alpha. Reads the CPU bytes of the page and palette
 * DataTextures (a borrowed, never uploaded page), so menu art needs no GPU work and never
 * waits behind queued uploads.
 */
export function indexedPixels(draw: SpriteDraw): Uint8ClampedArray<ArrayBuffer> {
  const { page, rect: [x0, y0, w, h], palette, paletteRow } = draw.indexed!;
  const indices = (page.texture.image as { data?: Uint8Array }).data;
  const colours = palette.image as { data?: Uint8Array; width: number };
  if (!indices || !colours.data) throw new Error('Indexed menu art needs the page and palette bytes');
  const tint = draw.tint ?? 0xffffff, alpha = draw.alpha ?? 1, row = paletteRow * colours.width;
  const scale = [(tint >> 16 & 255) / 255, (tint >> 8 & 255) / 255, (tint & 255) / 255, alpha];
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const entry = (row + indices[(y0 + y) * page.width + x0 + (draw.flipX ? w - 1 - x : x)]!) * 4, at = (y * w + x) * 4;
    for (let c = 0; c < 4; c++) out[at + c] = colours.data[entry + c]! * scale[c]!;
  }
  return out;
}

/** A CPU-backed canvas: menus read its pixels back (trimming), which then never waits for the GPU. */
function readableCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  canvas.getContext('2d', { willReadFrequently: true });
  return canvas;
}

/**
 * Draws one sprite, recolour included, to a canvas for HTML (menu art), so menus show exactly
 * what the game draws, at the frame's native resolution. Sheets go through one small offscreen
 * renderer, centred; indexed package drawings are composed on the CPU (`indexedPixels`).
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
    if (draw.indexed) {
      const [, , width, height] = draw.indexed.rect, out = readableCanvas(width, height);
      out.getContext('2d')!.putImageData(new ImageData(indexedPixels(draw), width, height), 0, 0);
      return out;
    }
    const { frameWidth: w, frameHeight: h } = await this.textures.load(draw.key);
    const scale = Math.abs(draw.scaleX ?? 1);
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
    const out = readableCanvas(w, h);
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
