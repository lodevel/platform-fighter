import type { Drawing } from '../package/types';
import { costumePalette } from '../render/palette';
import { costumeShifts, type HsvShift } from '../render/recolor';
import { RecolorCanvas } from './recolorCanvas';
import type { OpenPackage } from './source';
import type { DrawingPixels } from './stage';

/** One opened package as the lab draws it: its page images, loaded on demand, and its costumes. */
export class PackageView {
  private readonly images = new Map<string, HTMLImageElement>();
  private readonly shifts = new Map<number, HsvShift[]>();
  /** Indexed pages turned into colours, per page and costume. */
  private readonly coloured = new Map<string, HTMLCanvasElement>();
  private recolorer: RecolorCanvas | null = null;

  constructor(readonly open: OpenPackage, private readonly onImageLoad: () => void) {}

  get pkg() { return this.open.pkg; }

  /** The drawing in costume `costume`: its page as is, or a recoloured copy. */
  pixels(drawing: Drawing, costume: number): DrawingPixels | undefined {
    if (this.pkg.pages[drawing.page]?.format === 'indexed') {
      const page = this.indexedPage(drawing.page, costume);
      return page && { image: page, rect: drawing.rect };
    }
    const image = this.page(drawing.page), shifts = this.costumeShifts(costume);
    if (!image || shifts.length === 0) return image && { image, rect: drawing.rect };
    this.recolorer ??= new RecolorCanvas();
    return { image: this.recolorer.draw(image, drawing.rect, shifts), rect: [0, 0, drawing.rect[2], drawing.rect[3]] };
  }

  /** An indexed page drawn through the costume's palette (the lab's stand-in for the game's palette shader). */
  private indexedPage(page: string, costume: number): HTMLCanvasElement | undefined {
    const key = `${page}\n${costume}`, cached = this.coloured.get(key);
    if (cached) return cached;
    const image = this.page(page);
    if (!image) return undefined;
    const canvas = Object.assign(document.createElement('canvas'), { width: image.naturalWidth, height: image.naturalHeight });
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height), palette = costumePalette(this.pkg, costume);
    for (let i = 0; i < pixels.data.length; i += 4) pixels.data.set(palette.subarray(pixels.data[i]! * 4, pixels.data[i]! * 4 + 4), i);
    ctx.putImageData(pixels, 0, 0);
    this.coloured.set(key, canvas);
    return canvas;
  }

  private costumeShifts(costume: number): HsvShift[] {
    if (!this.shifts.has(costume)) this.shifts.set(costume, costumeShifts(this.pkg.costumes, costume));
    return this.shifts.get(costume)!;
  }

  private page(page: string): HTMLImageElement | undefined {
    let image = this.images.get(page);
    if (!image) {
      image = new Image();
      image.src = this.open.fileUrl(this.pkg.pages[page]!.file);
      image.onload = this.onImageLoad;
      this.images.set(page, image);
    }
    return image.complete && image.naturalWidth ? image : undefined;
  }
}
