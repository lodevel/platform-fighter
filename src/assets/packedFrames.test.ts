import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { frameRect, gridCells, packedLayoutOf, phaserAtlasJson, type SheetLayout } from './packedFrames';
import { legacySheets } from './legacyFighterSheets';

type LinkSheet = SheetLayout & { readonly root: readonly [number, number]; readonly scaleToWorld: number };
type LinkPoses = { readonly frameCount: number; readonly nativeSampleIndices?: readonly (number | null)[]; readonly actionFrameStarts?: readonly number[] };
type AuthoredProfile = { sheet: string; frameWidth: number; frameHeight: number; scaleToWorld: number; sourceSampleBasis: string; authoredSourceIdentity: { kind: string; sha256: string }; drawings: readonly { nativeSample: null; frameIndex: number }[] };
const LINK = { animations: legacySheets('link') as unknown as Readonly<Record<string, LinkSheet>> };
const LINK_POSES: { animations: Record<string, LinkPoses>; runtimeFinalVictimProfiles?: { profiles: Record<string, AuthoredProfile> } } =
  JSON.parse(readFileSync(new URL('../../assets/characters/link/gameplay.json', import.meta.url), 'utf8'));

const AUTHORED_RECIPIENTS = new Map(Object.values(LINK_POSES.runtimeFinalVictimProfiles?.profiles ?? {}).map(profile => [profile.sheet, profile]));

const PACKED: SheetLayout = {
  frameWidth: 100, frameHeight: 80, frameCount: 3, atlas: [64, 48],
  trims: [[0, 0, 30, 20, 5, 6], [32, 0, 31, 40, 0, 0], [0, 22, 10, 12, 70, 60]],
};

describe('frameRect', () => {
  it('returns the trim for a packed sheet', () => {
    expect(frameRect(PACKED, 0)).toEqual({ x: 0, y: 0, w: 30, h: 20, dx: 5, dy: 6 });
    expect(frameRect(PACKED, 2)).toEqual({ x: 0, y: 22, w: 10, h: 12, dx: 70, dy: 60 });
  });

  it('rejects a drawing the packed sheet does not have', () => {
    expect(() => frameRect(PACKED, 3)).toThrow(RangeError);
  });

  it('returns the whole cell at offset 0 for a grid sheet, row-major', () => {
    const grid: SheetLayout = { frameWidth: 10, frameHeight: 20, frameCount: 5, columns: 3 };
    expect(frameRect(grid, 0)).toEqual({ x: 0, y: 0, w: 10, h: 20, dx: 0, dy: 0 });
    expect(frameRect(grid, 4)).toEqual({ x: 10, y: 20, w: 10, h: 20, dx: 0, dy: 0 });
  });

  it('honours margin and spacing like Phaser\'s spritesheet parser', () => {
    const grid: SheetLayout = { frameWidth: 10, frameHeight: 10, frameCount: 4, columns: 2, margin: 1, spacing: 2 };
    expect(frameRect(grid, 3)).toEqual({ x: 13, y: 13, w: 10, h: 10, dx: 0, dy: 0 });
  });

  it('needs columns for a grid sheet', () => {
    expect(() => frameRect({ frameWidth: 10, frameHeight: 10, frameCount: 1 }, 0)).toThrow();
  });
});

describe('gridCells', () => {
  it('counts whole cells, ignoring leftovers', () => {
    expect(gridCells({ frameWidth: 10, frameHeight: 20, frameCount: 0 }, 35, 65)).toEqual({ columns: 3, rows: 3 });
    expect(gridCells({ frameWidth: 10, frameHeight: 10, frameCount: 0, margin: 1, spacing: 2 }, 25, 25)).toEqual({ columns: 2, rows: 2 });
  });
});

describe('phaserAtlasJson', () => {
  it('writes a trimmed JSON-hash frame per drawing, named "0".."n-1"', () => {
    const json = phaserAtlasJson(PACKED);
    expect(Object.keys(json.frames)).toEqual(['0', '1', '2']);
    expect(json.meta.size).toEqual({ w: 64, h: 48 });
    expect(json.frames['0']).toEqual({
      frame: { x: 0, y: 0, w: 30, h: 20 }, rotated: false, trimmed: true,
      spriteSourceSize: { x: 5, y: 6, w: 30, h: 20 }, sourceSize: { w: 100, h: 80 },
    });
    expect(json.frames['2']!.spriteSourceSize).toEqual({ x: 70, y: 60, w: 10, h: 12 });
  });

  it('refuses a grid sheet', () => {
    expect(() => phaserAtlasJson({ frameWidth: 10, frameHeight: 10, frameCount: 1, columns: 1 })).toThrow();
  });

  it('describes the installed tight Link sheets written by tools/fighter-pack.py', () => {
    for (const clip of Object.values(LINK.animations)) {
      const layout = { ...clip, ...packedLayoutOf(clip) };
      if (!layout.trims) {
        // New authored cinematic sheets use real grid cells. Native body
        // sheets retain the separate tighter packed-atlas contract below.
        expect(AUTHORED_RECIPIENTS.has(Object.entries(LINK.animations).find(([, value]) => value === clip)![0])).toBe(true);
        for (let i = 0; i < clip.frameCount; i += 1) {
          const rect = frameRect(layout, i);
          expect(rect.w).toBe(clip.frameWidth); expect(rect.h).toBe(clip.frameHeight);
          expect(rect.dx).toBe(0); expect(rect.dy).toBe(0);
        }
        continue;
      }
      expect(layout.trims).toHaveLength(clip.frameCount);
      const json = phaserAtlasJson(layout);
      for (let i = 0; i < clip.frameCount; i += 1) {
        const f = json.frames[String(i)]!;
        expect(f.sourceSize).toEqual({ w: clip.frameWidth, h: clip.frameHeight });
        expect(f.spriteSourceSize.x + f.spriteSourceSize.w).toBeLessThanOrEqual(clip.frameWidth);
        expect(f.spriteSourceSize.y + f.spriteSourceSize.h).toBeLessThanOrEqual(clip.frameHeight);
        expect(f.frame.x + f.frame.w).toBeLessThanOrEqual(clip.atlas![0]);
        expect(f.frame.y + f.frame.h).toBeLessThanOrEqual(clip.atlas![1]);
      }
    }
  });
});

describe('installed Link frames.json and gameplay.json', () => {
  it('preserves native sample/scale identity and authored recipient recipe identity with every ROOT inside its cell', () => {
    for (const [name, clip] of Object.entries(LINK.animations)) {
      const authored = AUTHORED_RECIPIENTS.get(name), poses = LINK_POSES.animations[name]!;
      if (authored) {
        expect(poses.nativeSampleIndices, name).toBeUndefined();
        expect(authored.sourceSampleBasis).toBe('authored-final-victim-recipe-index');
        expect(authored.authoredSourceIdentity.kind).toBe('AUTHORED_FINAL_CINEMATIC_RECIPIENT');
        expect(authored.authoredSourceIdentity.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(authored.drawings).toHaveLength(poses.frameCount);
        expect(authored.drawings.every((d, i) => d.nativeSample === null && d.frameIndex === i)).toBe(true);
        expect(clip.scaleToWorld).toBe(authored.scaleToWorld);
        expect(clip.frameWidth).toBe(authored.frameWidth); expect(clip.frameHeight).toBe(authored.frameHeight);
      } else {
        expect(poses.nativeSampleIndices, name).toHaveLength(poses.frameCount);
        expect(clip.scaleToWorld, name).toBe(0.4666667);
      }
      if (poses.actionFrameStarts) expect(poses.actionFrameStarts, name).toHaveLength(poses.frameCount);
      const [x, y] = clip.root;
      expect(x, name).toBeGreaterThanOrEqual(0); expect(x, name).toBeLessThanOrEqual(clip.frameWidth);
      expect(y, name).toBeGreaterThanOrEqual(0); expect(y, name).toBeLessThanOrEqual(clip.frameHeight);
    }
  });
});

describe('packedLayoutOf', () => {
  it('passes atlas and trims through and leaves grid clips empty', () => {
    expect(packedLayoutOf({ atlas: [4, 4], trims: [[0, 0, 4, 4, 0, 0]] })).toEqual({ atlas: [4, 4], trims: [[0, 0, 4, 4, 0, 0]] });
    expect(packedLayoutOf({ frameWidth: 4 })).toEqual({});
  });
});
