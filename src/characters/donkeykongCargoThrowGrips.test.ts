import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import metadata from '../../assets/characters/donkeykong/frames.json';
import { parseCaptureAttachmentCalibration } from './captureAttachmentCalibration';

/** Carried opponent through a cargo throw until its release: grip = the native `Throw` bone (the node Ultimate attaches a
 * captured fighter to) at each drawing's native sample, derived exactly like the carry grips (grabs-tails/derive_grips.py). */
const derived = JSON.parse(readFileSync(resolve(
  'docs/review/2026-09-25/donkeykong-character/rework-2026-10-10/install/final-gaps/cargo-throw-grips/grips.json'), 'utf8')) as
  Record<string, { artFrameIndex: number; nativeSample: number; grip: { x: number; y: number } }[]>;
type Clip = { frameCount: number; nativeSampleIndices: number[]; captureGripPoses?: unknown[] };
const clips = metadata.animations as unknown as Record<string, Clip>;

describe('DK cargo throws carry the opponent at the native Throw bone until release', () => {
  it.each(['cargo_fthrow', 'cargo_bthrow', 'cargo_uthrow', 'cargo_dthrow'])('%s: one cargo-throw grip per drawing', sheet => {
    const clip = clips[sheet]!;
    const grips = parseCaptureAttachmentCalibration({ profileKey: 'dk-ordinary-grab-target-v1', revision: 'test',
      grips: clip.captureGripPoses }, sheet).grips!;
    expect(grips).toHaveLength(clip.frameCount);
    grips.forEach((row, artFrameIndex) => {
      const source = derived[sheet]!.find(r => r.artFrameIndex === artFrameIndex)!;
      expect(row).toMatchObject({ poseKey: sheet, context: 'cargo-throw', artFrameIndex, nativeSample: clip.nativeSampleIndices[artFrameIndex],
        dimensions: { width: 60, height: 84 }, provenance: 'authored-reviewed-target', facingPolicy: 'preserve-recipient',
        occlusion: 'recipient-back', point: { x: source.grip.x + 0, y: source.grip.y + 0 } }); // + 0: JSON -0.0 vs 0
      expect(source.nativeSample).toBe(clip.nativeSampleIndices[artFrameIndex]);
    });
  });
});
