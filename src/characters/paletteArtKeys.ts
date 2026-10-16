import type { CharacterId } from '../types';

/**
 * Where each palette slot lives in a fighter's art: the colour the art
 * actually uses for that region, measured from the sheets the fighter draws (median-cut
 * of opaque pixels, 2026-10-13), and how far a pixel may stray from it in
 * hue / saturation / value and still belong to the region. The alternate
 * costume then shifts that region by palette N relative to palette 0
 * (`palettes.ts`), keeping the art's shading.
 *
 * ART-MEASURED from our sheets, not game data. Tolerances are AUTHORED,
 * tuned by eye on the 8 costumes; re-measure when a fighter's art changes.
 *
 * Replaces the exact-match key of the Phaser `paletteSwapShader.ts`, which the
 * soft-shaded art never matched; the Phaser modules go in step 9.
 */
export type PaletteRegionSlot = 'primary' | 'accent';

export interface PaletteArtKey {
  readonly slot: PaletteRegionSlot;
  /** 0xRRGGBB as drawn in the art. */
  readonly color: number;
  /** Max distance in hue (fraction of the wheel), saturation, value. */
  readonly tolerance: readonly [number, number, number];
}

export const PALETTE_ART_KEYS: Readonly<Partial<Record<CharacterId, ReadonlyArray<PaletteArtKey>>>> = Object.freeze({
  // Fur #704023 (shadows to #482817); the red tie (hue 8°) stays out by hue.
  // The tan face and chest stay as drawn in every costume, as in Smash
  // (palette accents would turn them pastel blue / lavender).
  donkeykong: [
    { slot: 'primary', color: 0x704023, tolerance: [0.03, 0.35, 0.3] },
  ],
  // Yellow body (shading down to #b3922c); brown ear tips and back stripes.
  pikachu: [
    { slot: 'primary', color: 0xf0cf2d, tolerance: [0.04, 0.4, 0.45] },
    { slot: 'accent', color: 0x662a1b, tolerance: [0.04, 0.35, 0.25] },
  ],
  // Green tunic and cap (#3e9634, shaded to #175b15), from the fresh Link's
  // a00wait1 / c02attackhi3 sheets. Hair and leather stay as drawn.
  link: [
    { slot: 'primary', color: 0x3e9634, tolerance: [0.04, 0.35, 0.35] },
    // The cap: a darker, fully saturated green (#054d05) that moves with the tunic.
    { slot: 'primary', color: 0x054d05, tolerance: [0.05, 0.3, 0.2] },
  ],
});
