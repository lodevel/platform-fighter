import * as THREE from 'three';
import { findAssetEntry } from '../../../../src/assets/manifest';
import { gridCells, type SheetLayout } from '../../../../src/assets/packedFrames';

/**
 * A loaded texture plus how Phaser slices it: a grid of whole cells, or
 * (`trims`) a tight pack whose drawings sit inside the logical
 * `frameWidth` x `frameHeight` cell. `width`/`height` are the layout's image
 * size (a packed sheet's metadata `atlas`), so UVs do not depend on the
 * resolution the texture was decoded at.
 */
export interface SheetTexture extends SheetLayout {
  readonly texture: THREE.Texture;
  readonly width: number;
  readonly height: number;
  readonly margin: number;
  readonly spacing: number;
  readonly columns: number;
}

/**
 * Textures by the game's asset keys (`src/assets/manifest.ts`), loaded on
 * first use. Uploaded the way Phaser uploads them: premultiplied alpha,
 * linear filtering, no mipmaps, so sprites filter identically.
 */
export class TextureStore {
  private readonly sheets = new Map<string, SheetTexture>();
  private readonly pending = new Map<string, Promise<SheetTexture>>();
  private readonly failures = new Map<string, string>();
  private readonly prepared = new Map<string, number>();
  private retentionEpoch = 0;
  private retainPending: (key: string) => boolean = () => true;
  private readonly loader = new THREE.ImageBitmapLoader().setOptions({ premultiplyAlpha: 'premultiply', imageOrientation: 'flipY' });

  /** The sheet if it is loaded; otherwise starts loading it and returns undefined. */
  get(key: string): SheetTexture | undefined {
    const sheet = this.sheets.get(key);
    if (!sheet && !this.failures.has(key)) void this.load(key).catch(error => console.error(`Could not load sprite '${key}'`, error));
    return sheet;
  }

  /** Read resident textures without scheduling loading (render diagnostics). */
  resident(key: string): SheetTexture | undefined { return this.sheets.get(key); }

  /** Shared stage presenter survives match changes; obsolete fighter banks do not.
   * Idle cards stay available to the menu while old match-only atlases/bitmaps
   * release both GPU storage and the decoded ImageBitmap. */
  retainMatchFighters(fighters: readonly string[]): void {
    this.prepared.clear();
    const prefixes = fighters.map(id => `char.${id}.`);
    const keep = (key: string) => !key.startsWith('char.') || key.endsWith('.idle') || prefixes.some(prefix => key.startsWith(prefix));
    this.retentionEpoch++;
    this.retainPending = keep;
    for (const [key, sheet] of this.sheets) if (!keep(key)) {
      this.sheets.delete(key);
      this.prepared.delete(key);
      this.release(sheet);
    }
    for (const key of this.failures.keys()) if (!keep(key)) this.failures.delete(key);
  }

  /** Decoded RGBA estimate excludes driver overhead and reports both CPU
   * bitmap/GPU copies separately; compressed PNG size is not texture memory. */
  diagnostics() {
    const resident = [...this.sheets].map(([key, sheet]) => {
      const image = sheet.texture.image as { width?: number; height?: number };
      const width = image.width ?? sheet.width, height = image.height ?? sheet.height;
      return { key, width, height, rgbaBytes: width * height * 4 };
    });
    return { resident, rgbaBytes: resident.reduce((n, row) => n + row.rgbaBytes, 0),
      preparedDuringLoading: [...this.prepared].map(([key, rgbaBytes]) => ({ key, rgbaBytes })),
      preparedDuringLoadingBytes: [...this.prepared.values()].reduce((a, b) => a + b, 0),
      pending: [...this.pending.keys()], failures: Object.fromEntries(this.failures) };
  }

  recordPreparation(key: string, bytes: number): void { this.prepared.set(key, bytes); }

  private release(sheet: SheetTexture): void {
    sheet.texture.dispose();
    (sheet.texture.image as { close?: () => void })?.close?.();
  }

  load(key: string): Promise<SheetTexture> {
    const done = this.sheets.get(key);
    if (done) return Promise.resolve(done);
    let job = this.pending.get(key);
    if (!job) {
      const epoch = this.retentionEpoch;
      job = this.fetch(key).then((sheet) => {
        if (epoch !== this.retentionEpoch && !this.retainPending(key)) this.release(sheet);
        else this.sheets.set(key, sheet);
        this.failures.delete(key);
        return sheet;
      }).catch((error: unknown) => {
        this.failures.set(key, error instanceof Error ? error.message : String(error));
        throw error;
      }).finally(() => this.pending.delete(key));
      this.pending.set(key, job);
    }
    return job;
  }

  private async fetch(key: string): Promise<SheetTexture> {
    const entry = findAssetEntry(key);
    if (!entry || (entry.kind !== 'image' && entry.kind !== 'spritesheet')) throw new Error(`No image or spritesheet asset '${key}'`);
    const bitmap = await this.loader.loadAsync(entry.url);
    const texture = new THREE.Texture(bitmap);
    // ImageBitmapLoader already flipped and premultiplied the pixels.
    texture.flipY = false;
    texture.premultiplyAlpha = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    const width = bitmap.width, height = bitmap.height;
    if (entry.kind === 'image') {
      return { texture, width, height, frameWidth: width, frameHeight: height, margin: 0, spacing: 0, columns: 1, frameCount: 1 };
    }
    const margin = entry.margin ?? 0, spacing = entry.spacing ?? 0;
    const { frameWidth, frameHeight } = entry;
    if (entry.trims && entry.atlas) {
      return {
        texture, width: entry.atlas[0], height: entry.atlas[1], frameWidth, frameHeight, margin, spacing, columns: 1,
        frameCount: entry.trims.length, trims: entry.trims,
      };
    }
    const { columns, rows } = gridCells(entry, width, height);
    return {
      texture, width, height, frameWidth, frameHeight, margin, spacing, columns,
      frameCount: Math.min(entry.frameCount || columns * rows, columns * rows),
    };
  }
}
