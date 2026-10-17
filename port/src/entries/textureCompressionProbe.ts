/** Probe-only page (dev server; not a build input). Draws installed fighter
 * drawings through the production StagePresenter/SpriteLayer twice — the PNG
 * texture the game uploads, then a KTX2 (UASTC) transcoded texture of the same
 * sheet — and diffs the resulting drawing-buffer pixels. No production module
 * changes; the KTX2 texture is swapped into the store's resident sheet only. */
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { StagePresenter } from '../arena/presenter';
import { fighterDraw } from '../fighters/poses';
import { frameRect } from '../../../src/assets/packedFrames';
import { textureFormatName, uploadAsSprite, type SheetTexture, type TextureStore } from '../engine/sprites/textureStore';
import type { SpriteDraw } from '../engine/sprites/spriteLayer';
import type { CharacterId } from '../../../src/types';

interface CompareRequest {
  readonly characterId: CharacterId;
  readonly sheet: string;
  readonly ktx2Url: string;
  readonly paddedWidth: number;
  readonly paddedHeight: number;
  readonly paletteIndices: readonly number[];
  /** Camera zoom (screen px per design px on a 1920-wide buffer). */
  readonly zoom: number;
  /** Diff threshold per channel, 0-255, counted as a visibly changed pixel. */
  readonly thresholds: readonly number[];
  /** Number of worst drawings to export as PNG crops. */
  readonly exportWorst: number;
}

const presenter = new StagePresenter(document.getElementById('view')!);
presenter.setStage('flat');
presenter.paused = true;
const gl = presenter.renderer.getContext() as WebGL2RenderingContext;
const store: TextureStore = presenter.sprites.textures;
/** Probe-only access to the store's resident sheets, to swap one texture. */
const resident = (store as unknown as { sheets: Map<string, SheetTexture> }).sheets;
let loader: KTX2Loader | null = null;
const NOW = 1_000_000;

function bounds(draw: SpriteDraw, sheet: SheetTexture, frame: number) {
  const r = frameRect(sheet, frame);
  const ox = (draw.originX ?? .5) * sheet.frameWidth, oy = (draw.originY ?? .5) * sheet.frameHeight;
  const sx = draw.scaleX ?? 1, sy = draw.scaleY ?? 1;
  const x0 = draw.x + sx * (-ox + r.dx), y0 = draw.y + sy * (-oy + r.dy);
  return { x0, y0, x1: x0 + sx * r.w, y1: y0 + sy * r.h, texels: r.w * r.h };
}

function render(draw: SpriteDraw): void {
  presenter.spriteSource = () => [draw];
  presenter.frame(NOW);
}

function read(x: number, y: number, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  gl.readPixels(x, gl.drawingBufferHeight - y - h, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
  return out;
}

function crop(pixels: Uint8Array, w: number, h: number, scale = 1): string {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const image = new ImageData(w, h);
  for (let row = 0; row < h; row++) for (let col = 0; col < w * 4; col++) {
    const v = pixels[(h - 1 - row) * w * 4 + col]!;
    image.data[row * w * 4 + col] = col % 4 === 3 ? 255 : Math.min(255, v * scale);
  }
  canvas.getContext('2d')!.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

function diff(a: Uint8Array, b: Uint8Array, thresholds: readonly number[]) {
  const pixels = a.length / 4, over = thresholds.map(() => 0), delta = new Uint8Array(a.length);
  let max = 0, sum = 0, squared = 0, covered = 0;
  for (let i = 0; i < a.length; i += 4) {
    let worst = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a[i + c]! - b[i + c]!);
      delta[i + c] = d; sum += d; squared += d * d;
      if (d > worst) worst = d;
    }
    delta[i + 3] = 255;
    if (worst > max) max = worst;
    if (worst > 0) covered++;
    thresholds.forEach((t, k) => { if (worst > t) over[k]!++; });
  }
  const mse = squared / (pixels * 3);
  return { pixels, changedPixels: covered, maxChannelDiff: max, meanChannelDiff: sum / (pixels * 3),
    psnr: mse === 0 ? Infinity : 10 * Math.log10(255 * 255 / mse),
    over: Object.fromEntries(thresholds.map((t, k) => [`>${t}`, over[k]])), delta };
}

async function compare(request: CompareRequest) {
  const key = `char.${request.characterId}.${request.sheet}`;
  const original = await store.load(key);
  loader ??= new KTX2Loader().setTranscoderPath(transcoderPath).detectSupport(presenter.renderer);
  const started = performance.now();
  const compressed = uploadAsSprite(await loader.loadAsync(request.ktx2Url));
  const transcodeMs = performance.now() - started;
  const variant: SheetTexture = { ...original, texture: compressed, width: request.paddedWidth, height: request.paddedHeight };
  const level = compressed.mipmaps?.[0] as { data: ArrayBufferView; width: number; height: number } | undefined;
  const scale = gl.drawingBufferWidth / presenter.renderer.domElement.clientWidth;
  const rows: Array<Record<string, unknown>> = [];
  const crops: Array<{ frame: number; paletteIndex: number; score: number; png: string; ktx2: string; diff: string }> = [];
  for (const paletteIndex of request.paletteIndices) {
    for (let frame = 0; frame < original.frameCount; frame++) {
      const base = fighterDraw({ characterId: request.characterId, x: 960, y: 700, facing: 1, paletteIndex }, request.sheet, 0, 0xffffff);
      if (!base || base.key !== key) throw new Error(`Probe draw does not address ${key} (got ${base?.key})`);
      const draw: SpriteDraw = { ...base, frame };
      const b = bounds(draw, original, frame);
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, w = 1920 / request.zoom, h = 1080 / request.zoom;
      presenter.viewRect = { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
      const p0 = presenter.project(b.x0, b.y0), p1 = presenter.project(b.x1, b.y1);
      const x = Math.max(0, Math.floor(p0.x * scale) - 2), y = Math.max(0, Math.floor(p0.y * scale) - 2);
      const rw = Math.min(gl.drawingBufferWidth - x, Math.ceil(p1.x * scale) + 2 - x);
      const rh = Math.min(gl.drawingBufferHeight - y, Math.ceil(p1.y * scale) + 2 - y);
      resident.set(key, original); render(draw);
      const png = read(x, y, rw, rh);
      render(draw);
      const control = diff(png, read(x, y, rw, rh), request.thresholds);
      resident.set(key, variant); render(draw);
      const ktx2 = read(x, y, rw, rh);
      resident.set(key, original);
      const d = diff(png, ktx2, request.thresholds);
      const { delta, ...metrics } = d;
      rows.push({ paletteIndex, frame, texels: b.texels, screenPixels: rw * rh,
        clipped: rw < (p1.x - p0.x) * scale || rh < (p1.y - p0.y) * scale, ...metrics,
        control: { maxChannelDiff: control.maxChannelDiff, over: control.over } });
      const score = d.over[`>${request.thresholds[request.thresholds.length - 1]}`]! * 1000 + d.maxChannelDiff;
      crops.push({ frame, paletteIndex, score, png: '', ktx2: '', diff: '' });
      crops.sort((l, r) => r.score - l.score);
      const kept = crops.slice(0, request.exportWorst);
      if (kept.some(row => row.frame === frame && row.paletteIndex === paletteIndex)) {
        const row = kept.find(r => r.frame === frame && r.paletteIndex === paletteIndex)!;
        row.png = crop(png, rw, rh); row.ktx2 = crop(ktx2, rw, rh); row.diff = crop(delta, rw, rh, 8);
      }
      crops.length = Math.min(crops.length, request.exportWorst);
    }
  }
  return {
    key, zoom: request.zoom, buffer: { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight, cssWidth: presenter.renderer.domElement.clientWidth, devicePixelRatio },
    texture: { format: compressed.format, formatName: textureFormatName(compressed), type: compressed.type,
      colorSpace: compressed.colorSpace, width: level?.width, height: level?.height, gpuPayloadBytes: level?.data.byteLength ?? null,
      pngRgba8Bytes: original.width * original.height * 4, transcodeMs },
    rows, worst: crops,
  };
}

let transcoderPath = '';

Object.assign(window, { __textureProbe: {
  ready: Promise.resolve(),
  setTranscoderPath(path: string) { transcoderPath = path; },
  extensions: () => (gl.getSupportedExtensions() ?? []).filter(name => /compressed|astc|bptc|s3tc|etc|pvrtc|rgtc/i.test(name)),
  gpu() {
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      vendor: info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR), version: gl.getParameter(gl.VERSION) };
  },
  compare,
} });
