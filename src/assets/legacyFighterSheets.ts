/**
 * The legacy sprite sheets of DK, Link and Pikachu: each clip's image layout and registration from the
 * fighter's frames.json, with its drawing count from gameplay.json (the pose track the sheet draws: cell i
 * draws pose i). Display only. The simulation reads gameplay.json and never this module; it is deleted with
 * the legacy display and frames.json (Phase 6 step 5, docs/review/2026-10-19/phase6/gameplay-data.md).
 */
import donkeykongFrames from '../../assets/characters/donkeykong/frames.json';
import linkFrames from '../../assets/characters/link/frames.json';
import pikachuFrames from '../../assets/characters/pikachu/frames.json';
import donkeykongGameplay from '../../assets/characters/donkeykong/gameplay.json';
import linkGameplay from '../../assets/characters/link/gameplay.json';
import pikachuGameplay from '../../assets/characters/pikachu/gameplay.json';
import type { FrameTrim } from './packedFrames';

export type LegacySheetFighter = 'donkeykong' | 'link' | 'pikachu';

export interface LegacySheet {
  /** Image path relative to the fighter folder (Pikachu loads `animations/<clip>.png` instead). */
  readonly strip: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  /** Drawings in the sheet: the clip's pose count (gameplay.json). */
  readonly frameCount: number;
  readonly atlas?: readonly [number, number];
  readonly trims?: readonly FrameTrim[];
  readonly columns?: number;
  /** Root pixel in the cell; absent on sheets without registration. */
  readonly root?: readonly number[];
  readonly scaleToWorld?: number;
  /** Final FX anchors (bones top/hip) per drawing, in the Final's ROOT space. */
  readonly sourceEffectPointPoses?: readonly { readonly artFrameIndex: number; readonly nativeSample: number; readonly points: unknown }[];
}

type Clips = Readonly<Record<string, object>>;
const FILES: Readonly<Record<string, { readonly images: Clips; readonly poses: Clips }>> = {
  donkeykong: { images: donkeykongFrames.animations, poses: donkeykongGameplay.animations },
  link: { images: linkFrames.animations, poses: linkGameplay.animations },
  pikachu: { images: pikachuFrames.animations, poses: pikachuGameplay.animations },
};
const sheets = new WeakMap<object, LegacySheet>();

/** A fighter's legacy sheet of a clip, or undefined (no sheet, or a fighter without legacy sheets). */
export function legacySheet(fighter: string, clip: string): LegacySheet | undefined {
  const file = FILES[fighter], image = file && Object.hasOwn(file.images, clip) ? file.images[clip] : undefined;
  if (!image) return undefined;
  let sheet = sheets.get(image);
  if (!sheet) {
    sheet = { ...image, frameCount: (file!.poses[clip] as { readonly frameCount: number }).frameCount } as LegacySheet;
    sheets.set(image, sheet);
  }
  return sheet;
}

/** Every legacy sheet of a fighter by clip name, in frames.json order. */
export function legacySheets(fighter: LegacySheetFighter): Readonly<Record<string, LegacySheet>> {
  return Object.fromEntries(Object.keys(FILES[fighter]!.images).map(clip => [clip, legacySheet(fighter, clip)!]));
}

/** The Final FX profile bank of a fighter's frames.json (display; validated by finalFxProfiles.ts). */
export const LEGACY_FINAL_FX_BANKS: Readonly<Partial<Record<LegacySheetFighter, unknown>>> = {
  donkeykong: (donkeykongFrames as { readonly runtimeFinalFxProfiles?: unknown }).runtimeFinalFxProfiles,
  pikachu: (pikachuFrames as { readonly runtimeFinalFxProfiles?: unknown }).runtimeFinalFxProfiles,
};
