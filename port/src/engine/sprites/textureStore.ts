import * as THREE from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { findAssetEntry, manifestAssetUrl } from '../../../../src/assets/manifest';
import { gridCells, type SheetLayout } from '../../../../src/assets/packedFrames';
import type { TextureQuality } from '../../../../src/config/gameSettings';

/**
 * A loaded texture plus how Phaser slices it: a grid of whole cells, or
 * (`trims`) a tight pack whose drawings sit inside the logical
 * `frameWidth` x `frameHeight` cell. `width`/`height` are the layout's image
 * size (a packed sheet's metadata `atlas`), so UVs do not depend on the
 * resolution the texture was decoded at; a compressed sheet's are scaled to
 * its texture, padded to whole 4x4 blocks past the PNG's right/bottom edge.
 */
export interface SheetTexture extends SheetLayout {
  readonly texture: THREE.Texture;
  readonly width: number;
  readonly height: number;
  readonly margin: number;
  readonly spacing: number;
  readonly columns: number;
}

/** One sheet of `characters/<fighter>/compressed/index.json`; `url` is relative to the fighter's folder. */
interface CompressedSheetRecord { readonly url: string; readonly sourceWidth: number; readonly sourceHeight: number }
type CompressedIndex = Readonly<Record<string, CompressedSheetRecord | undefined>>;

/** A decoded texture and the size of the PNG drawing it holds (smaller than a padded texture). */
interface SheetImage { readonly texture: THREE.Texture; readonly width: number; readonly height: number; readonly sourceWidth: number; readonly sourceHeight: number }

/** Transcoder targets by KTX2Loader support flag. UASTC with alpha needs ASTC,
 * BPTC (BC7), S3TC (BC3) or ETC2; ETC1 has no alpha and PVRTC needs
 * power-of-two sheets, so without the first four it transcodes to RGBA8. */
const SUPPORT_FLAGS = { astcSupported: 'astc', bptcSupported: 'bptc', dxtSupported: 's3tc', etc2Supported: 'etc2', etc1Supported: 'etc1', pvrtcSupported: 'pvrtc' } as const;
const FORMAT_NAMES: Partial<Record<number, string>> = {
  [THREE.RGBA_ASTC_4x4_Format]: 'astc-4x4', [THREE.RGBA_BPTC_Format]: 'bc7', [THREE.RGBA_S3TC_DXT5_Format]: 'bc3',
  [THREE.RGBA_ETC2_EAC_Format]: 'etc2-rgba', [THREE.RGBA_PVRTC_4BPPV1_Format]: 'pvrtc-rgba', [THREE.RGBAFormat]: 'rgba8-transcoded',
};

const isCompressed = (texture: THREE.Texture): texture is THREE.CompressedTexture => (texture as { isCompressedTexture?: boolean }).isCompressedTexture === true;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Upload like Phaser: pixels arrive already flipped and premultiplied (the
 * ImageBitmapLoader does it for PNGs, the encoder for KTX2), linear
 * filtering, no mipmaps, so sprites filter identically. */
export function uploadAsSprite<T extends THREE.Texture>(texture: T): T {
  texture.flipY = false;
  texture.premultiplyAlpha = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** 'rgba8' for a decoded bitmap, else the GPU format the transcoder picked. */
export function textureFormatName(texture: THREE.Texture): string {
  return isCompressed(texture) ? FORMAT_NAMES[texture.format] ?? `format ${texture.format}` : 'rgba8';
}

/** RGBA8 size of the texture's dimensions: an estimate, not driver memory. */
function rgbaBytes(sheet: SheetTexture): number {
  const image = sheet.texture.image as { width?: number; height?: number } | undefined;
  return (image?.width ?? sheet.width) * (image?.height ?? sheet.height) * 4;
}

/** Upload payload: the transcoded levels' measured bytes for a compressed
 * sheet, the RGBA8 estimate for a bitmap. Excludes driver overhead. */
export function sheetTextureBytes(sheet: SheetTexture): number {
  return isCompressed(sheet.texture) ? (sheet.texture.mipmaps ?? []).reduce((n, level) => n + level.data.byteLength, 0) : rgbaBytes(sheet);
}

/** `characters/<fighter>/<path>` of a manifest URL: where its compressed index lives and its key there. */
function characterSheetPath(url: string): { fighter: string; path: string } | null {
  const root = manifestAssetUrl('characters/');
  const match = url.startsWith(root) ? /^([^/]+)\/(.+)$/.exec(url.slice(root.length)) : null;
  return match ? { fighter: match[1]!, path: match[2]! } : null;
}

/**
 * Textures by the game's asset keys (`src/assets/manifest.ts`), loaded on
 * first use. In 'compressed' quality, `char.*` sheets listed in their
 * fighter's compressed index load as transcoded KTX2; every other sheet, and
 * any compressed sheet that is missing or fails, loads the PNG.
 */
export class TextureStore {
  private readonly sheets = new Map<string, SheetTexture>();
  private readonly pending = new Map<string, Promise<SheetTexture>>();
  private readonly failures = new Map<string, string>();
  private readonly prepared = new Map<string, number>();
  /** Character sheets loaded as PNG in 'compressed' quality, with the reason. */
  private readonly fallbacks = new Map<string, string>();
  private readonly indexes = new Map<string, Promise<CompressedIndex | string>>();
  private readonly warned = new Set<string>();
  private quality: TextureQuality = 'full';
  private retentionEpoch = 0;
  private retainPending: (key: string) => boolean = () => true;
  private readonly loader = new THREE.ImageBitmapLoader().setOptions({ premultiplyAlpha: 'premultiply', imageOrientation: 'flipY' });
  private renderer: THREE.WebGLRenderer | null = null;
  private support: KTX2Loader['workerConfig'] | null = null;
  private ktx2: KTX2Loader | null = null;
  private transcoding = 0;
  private idleTranscoder: ReturnType<typeof setTimeout> | undefined;

  /** The renderer whose GPU formats compressed sheets transcode to. */
  attachRenderer(renderer: THREE.WebGLRenderer): void {
    this.renderer = renderer;
    this.support = { ...this.transcoder().detectSupport(renderer).workerConfig };
  }

  /** One transcoder while compressed sheets load. Its workers keep WASM heaps
   * grown to the largest sheet, so they are released once loading goes idle;
   * a later load starts a fresh transcoder. */
  private transcoder(): KTX2Loader {
    clearTimeout(this.idleTranscoder);
    if (!this.ktx2) {
      this.ktx2 = new KTX2Loader().setTranscoderPath(manifestAssetUrl('basis/'))
        .setWorkerLimit(Math.min(globalThis.navigator?.hardwareConcurrency || 4, 8));
      this.ktx2.detectSupport(this.renderer!);
    }
    return this.ktx2;
  }

  private transcoded(): void {
    if (--this.transcoding > 0) return;
    this.idleTranscoder = setTimeout(() => {
      if (this.transcoding > 0) return;
      this.ktx2?.dispose();
      this.ktx2 = null;
    }, 1000);
  }

  get textureQuality(): TextureQuality { return this.quality; }

  /** Later loads use `quality`; resident character sheets of the other
   * quality are released (GPU and CPU copies) and reload on next use. */
  setTextureQuality(quality: TextureQuality): void {
    if (quality === this.quality) return;
    this.quality = quality;
    this.fallbacks.clear();
    for (const [key, sheet] of this.sheets) if (this.otherQuality(key, sheet)) this.evict(key, sheet);
  }

  /** Null before a renderer is attached; `native` false means sheets would
   * transcode to uncompressed RGBA8 (no memory gain). */
  compressedSupport(): { readonly native: boolean; readonly formats: readonly string[] } | null {
    const config = this.support;
    if (!config) return null;
    return { native: config.astcSupported || config.bptcSupported || config.dxtSupported || config.etc2Supported,
      formats: Object.entries(SUPPORT_FLAGS).filter(([flag]) => config[flag as keyof typeof SUPPORT_FLAGS]).map(([, name]) => name) };
  }

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
    for (const [key, sheet] of this.sheets) if (!keep(key)) this.evict(key, sheet);
    for (const key of this.failures.keys()) if (!keep(key)) this.failures.delete(key);
  }

  /** `rgbaBytes` is the RGBA8 estimate of each texture's dimensions;
   * `textureBytes` the upload payload (measured for transcoded sheets, the
   * RGBA8 estimate for bitmaps). Neither counts driver overhead or the CPU
   * copy kept for context restore (the bitmap, or the compressed payload);
   * compressed PNG/KTX2 file size is not texture memory. */
  diagnostics() {
    const resident = [...this.sheets].map(([key, sheet]) => {
      const image = sheet.texture.image as { width?: number; height?: number };
      const width = image.width ?? sheet.width, height = image.height ?? sheet.height;
      return { key, width, height, rgbaBytes: rgbaBytes(sheet), format: textureFormatName(sheet.texture), textureBytes: sheetTextureBytes(sheet) };
    });
    return { textureQuality: this.quality, resident, rgbaBytes: resident.reduce((n, row) => n + row.rgbaBytes, 0),
      textureBytes: resident.reduce((n, row) => n + row.textureBytes, 0),
      preparedDuringLoading: [...this.prepared].map(([key, textureBytes]) => ({ key, textureBytes })),
      preparedDuringLoadingBytes: [...this.prepared.values()].reduce((a, b) => a + b, 0),
      pending: [...this.pending.keys()], failures: Object.fromEntries(this.failures), fallbacks: Object.fromEntries(this.fallbacks) };
  }

  recordPreparation(key: string, bytes: number): void { this.prepared.set(key, bytes); }

  /** A character sheet resident in the quality not currently selected. */
  private otherQuality(key: string, sheet: SheetTexture): boolean {
    if (!key.startsWith('char.')) return false;
    return isCompressed(sheet.texture) ? this.quality === 'full' : this.quality === 'compressed' && !this.fallbacks.has(key);
  }

  private evict(key: string, sheet: SheetTexture): void {
    this.sheets.delete(key);
    this.prepared.delete(key);
    this.release(sheet);
  }

  /** Frees the GPU texture and the CPU copy: the decoded bitmap, or the
   * transcoded payload three would otherwise keep for re-upload. */
  private release(sheet: SheetTexture): void {
    sheet.texture.dispose();
    (sheet.texture.image as { close?: () => void })?.close?.();
    if (isCompressed(sheet.texture)) sheet.texture.mipmaps = [];
  }

  load(key: string): Promise<SheetTexture> {
    const done = this.sheets.get(key);
    if (done) return Promise.resolve(done);
    let job = this.pending.get(key);
    if (!job) {
      const epoch = this.retentionEpoch;
      job = this.fetch(key).then((sheet) => {
        this.pending.delete(key);
        this.failures.delete(key);
        if (epoch !== this.retentionEpoch && !this.retainPending(key)) this.release(sheet);
        // The quality changed while loading: load it again in the new one.
        else if (this.otherQuality(key, sheet)) { this.release(sheet); return this.load(key); }
        else this.sheets.set(key, sheet);
        return sheet;
      }, (error: unknown) => {
        this.pending.delete(key);
        this.failures.set(key, message(error));
        throw error;
      });
      this.pending.set(key, job);
    }
    return job;
  }

  private async fetch(key: string): Promise<SheetTexture> {
    const entry = findAssetEntry(key);
    if (!entry || (entry.kind !== 'image' && entry.kind !== 'spritesheet')) throw new Error(`No image or spritesheet asset '${key}'`);
    const image = (this.quality === 'compressed' && key.startsWith('char.') ? await this.loadCompressed(key, entry.url, entry.kind === 'spritesheet' ? entry.atlas : undefined) : null)
      ?? await this.loadBitmap(entry.url);
    const { texture, width, height } = image;
    if (entry.kind === 'image') {
      return { texture, width, height, frameWidth: image.sourceWidth, frameHeight: image.sourceHeight, margin: 0, spacing: 0, columns: 1, frameCount: 1 };
    }
    const margin = entry.margin ?? 0, spacing = entry.spacing ?? 0;
    const { frameWidth, frameHeight } = entry;
    if (entry.trims && entry.atlas) {
      return {
        texture, width: entry.atlas[0] * width / image.sourceWidth, height: entry.atlas[1] * height / image.sourceHeight,
        frameWidth, frameHeight, margin, spacing, columns: 1, frameCount: entry.trims.length, trims: entry.trims,
      };
    }
    const { columns, rows } = gridCells(entry, image.sourceWidth, image.sourceHeight);
    return {
      texture, width, height, frameWidth, frameHeight, margin, spacing, columns,
      frameCount: Math.min(entry.frameCount || columns * rows, columns * rows),
    };
  }

  private async loadBitmap(url: string): Promise<SheetImage> {
    const bitmap = await this.loader.loadAsync(url);
    return { texture: uploadAsSprite(new THREE.Texture(bitmap)), width: bitmap.width, height: bitmap.height, sourceWidth: bitmap.width, sourceHeight: bitmap.height };
  }

  /** The sheet's transcoded KTX2, or null after recording why the PNG is used
   * instead (one console warning per fighter). */
  private async loadCompressed(key: string, url: string, atlas: readonly [number, number] | undefined): Promise<SheetImage | null> {
    const sheet = characterSheetPath(url);
    const fighter = sheet?.fighter ?? key;
    let reason: string;
    try {
      if (!sheet) reason = 'not under characters/';
      else if (!this.renderer) reason = 'no renderer attached';
      else {
        const index = await this.compressedIndex(sheet.fighter);
        const record = typeof index === 'string' ? undefined : index[sheet.path];
        if (typeof index === 'string') reason = index;
        else if (!record) reason = `${sheet.path} is not in the compressed index`;
        else if (atlas && (record.sourceWidth !== atlas[0] || record.sourceHeight !== atlas[1])) reason = `${sheet.path} is stale (${record.sourceWidth}x${record.sourceHeight}, atlas ${atlas[0]}x${atlas[1]})`;
        else {
          this.transcoding++;
          let texture: THREE.CompressedTexture;
          try { texture = uploadAsSprite(await this.transcoder().loadAsync(manifestAssetUrl(`characters/${sheet.fighter}/${record.url}`))); }
          finally { this.transcoded(); }
          const { width, height } = texture.image as { width: number; height: number };
          return { texture, width, height, sourceWidth: record.sourceWidth, sourceHeight: record.sourceHeight };
        }
      }
    } catch (error) {
      reason = message(error);
    }
    this.fallbacks.set(key, reason);
    if (!this.warned.has(fighter)) {
      this.warned.add(fighter);
      console.warn(`Compressed textures for '${fighter}' fall back to PNG (first: ${key}: ${reason})`);
    }
    return null;
  }

  /** Each fighter's compressed index is fetched once; a string is why it is unusable. */
  private compressedIndex(fighter: string): Promise<CompressedIndex | string> {
    let index = this.indexes.get(fighter);
    if (!index) {
      const url = manifestAssetUrl(`characters/${fighter}/compressed/index.json`);
      index = fetch(url).then(async (response) => {
        if (!response.ok) return `${url}: HTTP ${response.status}`;
        const data = await response.json() as { schema?: unknown; sheets?: unknown } | null;
        return data?.schema === 'compressed-sheets/1' && data.sheets && typeof data.sheets === 'object'
          ? data.sheets as CompressedIndex : `${url}: not a compressed-sheets/1 index`;
      }).catch((error: unknown) => `${url}: ${message(error)}`);
      this.indexes.set(fighter, index);
    }
    return index;
  }
}
