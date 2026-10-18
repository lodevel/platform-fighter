import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { indexedPixels } from './spriteSnapshot';

describe('indexed menu art', () => {
  // A 4×2 page; the drawing is its middle 2×2. Palette rows: costume 0, costume 1.
  const page = { texture: new THREE.DataTexture(new Uint8Array([0, 1, 2, 0, 0, 2, 1, 0]), 4, 2), width: 4, height: 2 };
  const palette = new THREE.DataTexture(new Uint8Array([
    0, 0, 0, 0, 200, 100, 50, 255, 10, 20, 30, 128,
    0, 0, 0, 0, 50, 100, 200, 255, 30, 20, 10, 128,
  ]), 3, 2);
  const draw = { key: 'k', x: 0, y: 0, indexed: { page, rect: [1, 0, 2, 2] as const, palette, paletteRow: 1 } };
  const pixels = (extra = {}) => [...indexedPixels({ ...draw, ...extra })];

  it('maps each index through its costume row, row by row', () => {
    expect(pixels()).toEqual([50, 100, 200, 255, 30, 20, 10, 128, 30, 20, 10, 128, 50, 100, 200, 255]);
  });

  it('mirrors for flipX and applies tint and alpha', () => {
    expect(pixels({ flipX: true }).slice(0, 8)).toEqual([30, 20, 10, 128, 50, 100, 200, 255]);
    expect(pixels({ tint: 0x808080, alpha: 0.5 }).slice(0, 4)).toEqual([25, 50, 100, 128]);
  });
});
