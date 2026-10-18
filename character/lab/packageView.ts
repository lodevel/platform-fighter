import type { Drawing } from '../package/types';
import { costumeShifts, type HsvShift } from '../render/recolor';
import { RecolorCanvas } from './recolorCanvas';
import type { OpenPackage } from './source';
import type { DrawingPixels } from './stage';

/** One opened package as the lab draws it: its page images, loaded on demand, and its costumes. */
export class PackageView {
  private readonly images = new Map<string, HTMLImageElement>();
  private readonly shifts = new Map<number, HsvShift[]>();
  private recolorer: RecolorCanvas | null = null;

  constructor(readonly open: OpenPackage, private readonly onImageLoad: () => void) {}

  get pkg() { return this.open.pkg; }

  /** The drawing in costume `costume`: its page as is, or a recoloured copy. */
  pixels(drawing: Drawing, costume: number): DrawingPixels | undefined {
    const image = this.page(drawing.page), shifts = this.costumeShifts(costume);
    if (!image || shifts.length === 0) return image && { image, rect: drawing.rect };
    this.recolorer ??= new RecolorCanvas();
    return { image: this.recolorer.draw(image, drawing.rect, shifts), rect: [0, 0, drawing.rect[2], drawing.rect[3]] };
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
