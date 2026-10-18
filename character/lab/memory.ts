import type { ActionId, CharacterPackage } from '../package/types';

/** Byte estimates from package data, not measured process memory. */
export interface MemoryEstimate {
  readonly drawings: number;
  readonly pages: number;
  /** Pixels covered by the drawings themselves (their rectangles). */
  readonly drawnPixels: number;
  /** Pages uploaded as uncompressed RGBA8. */
  readonly rgbaBytes: number;
  /** The same pages as BC7 (16 bytes per 4×4 block). */
  readonly bc7Bytes: number;
}

const pageBytes = (width: number, height: number) => ({
  rgba: width * height * 4, bc7: Math.ceil(width / 4) * Math.ceil(height / 4) * 16 });

/** What an action keeps resident: its drawings and every page they sit on. */
export function actionMemory(pkg: CharacterPackage, action: ActionId): MemoryEstimate {
  const ids = new Set(pkg.actions[action]?.drawings.windows.map(w => w.drawing) ?? []);
  return estimate(pkg, ids);
}

/** The whole package, each drawing and page counted once. */
export function packageMemory(pkg: CharacterPackage): MemoryEstimate {
  return estimate(pkg, new Set(Object.keys(pkg.drawings)));
}

/** Drawings shown by more than one action: today's sprites share almost nothing. */
export function sharedDrawings(pkg: CharacterPackage): number {
  const users = new Map<string, number>();
  for (const action of Object.values(pkg.actions))
    for (const id of new Set(action.drawings.windows.map(w => w.drawing))) users.set(id, (users.get(id) ?? 0) + 1);
  return [...users.values()].filter(count => count > 1).length;
}

function estimate(pkg: CharacterPackage, ids: ReadonlySet<string>): MemoryEstimate {
  const pages = new Set<string>();
  let drawnPixels = 0;
  for (const id of ids) {
    const drawing = pkg.drawings[id];
    if (!drawing) continue;
    pages.add(drawing.page);
    drawnPixels += drawing.rect[2] * drawing.rect[3];
  }
  let rgbaBytes = 0, bc7Bytes = 0;
  for (const id of pages) {
    const page = pkg.pages[id];
    if (!page) continue;
    const bytes = pageBytes(page.width, page.height);
    rgbaBytes += bytes.rgba; bc7Bytes += bytes.bc7;
  }
  return { drawings: ids.size, pages: pages.size, drawnPixels, rgbaBytes, bc7Bytes };
}
