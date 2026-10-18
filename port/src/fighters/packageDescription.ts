import type { CharacterPackage } from '../../../character/package/types';
import { validatePackage } from '../../../character/package/validate';
import { costumePalette } from '../../../character/render/palette';

/** Palette textures are this many entries wide, whatever the package uses. */
export const PALETTE_WIDTH = 256;

/** A validated character.json and its costumes as palette rows. */
export interface PackageDescription {
  readonly pkg: CharacterPackage;
  /** Straight RGBA, PALETTE_WIDTH × costumes, row N = costume N (`costumePalette`). */
  readonly palette: Uint8Array<ArrayBuffer>;
  readonly costumes: number;
}

/** Parse, validate and pin-check package `id`'s character.json, and build its palette rows. */
export function describePackage(id: string, bytes: Uint8Array, pinned: string | undefined): PackageDescription {
  const pkg = JSON.parse(new TextDecoder().decode(bytes)) as CharacterPackage;
  const problems = validatePackage(pkg);
  if (problems.length) throw new Error(`${id}: invalid character package: ${problems.slice(0, 3).join('; ')}`);
  if (pinned !== undefined && pkg.revision !== pinned) throw new Error(`${id}: package revision ${pkg.revision} is not the pinned ${pinned}`);
  const unindexed = Object.keys(pkg.pages).find(page => pkg.pages[page]!.format !== 'indexed');
  if (unindexed) throw new Error(`${id}: page ${unindexed} is not indexed`);
  const costumes = Math.max(1, pkg.costumes?.list.length ?? 0), palette = new Uint8Array(PALETTE_WIDTH * costumes * 4);
  for (let row = 0; row < costumes; row++) palette.set(costumePalette(pkg, row).subarray(0, PALETTE_WIDTH * 4), row * PALETTE_WIDTH * 4);
  return { pkg, palette, costumes };
}

/**
 * A description as a worker sends it: the validated package as compact JSON bytes. Edge parses
 * those on the main thread in 2–4 ms, about three times faster than it deserializes a
 * structured clone of the same object.
 */
export interface EncodedDescription {
  readonly json: Uint8Array<ArrayBuffer>;
  readonly palette: Uint8Array<ArrayBuffer>;
  readonly costumes: number;
}

export function encodeDescription({ pkg, palette, costumes }: PackageDescription): EncodedDescription {
  return { json: new TextEncoder().encode(JSON.stringify(pkg)), palette, costumes };
}

export function decodeDescription({ json, palette, costumes }: EncodedDescription): PackageDescription {
  return { pkg: JSON.parse(new TextDecoder().decode(json)) as CharacterPackage, palette, costumes };
}
