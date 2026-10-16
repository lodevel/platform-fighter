import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { STAGE_DESIGN_HEIGHT, STAGE_DESIGN_WIDTH } from '../../../../src/stages/stageDefinitions';
import { PX_PER_UNIT } from '../space';
import { SpriteLayer, type SpriteDraw } from './spriteLayer';
import type { SheetTexture, TextureStore } from './textureStore';

const W = 40, H = 30, COLS = 3, FRAMES = 6;
const texture = new THREE.Texture();

/** A 3x2 grid sheet, and the same sheet tight-packed with every drawing filling its whole cell. */
const grid: SheetTexture = {
  texture, width: W * COLS, height: H * 2, frameWidth: W, frameHeight: H, margin: 0, spacing: 0, columns: COLS, frameCount: FRAMES,
};
const fullCellTrims: SheetTexture = {
  ...grid, columns: 1,
  atlas: [grid.width, grid.height],
  trims: Array.from({ length: FRAMES }, (_, i) => [(i % COLS) * W, Math.floor(i / COLS) * H, W, H, 0, 0] as const),
};

function layerFor(sheet: SheetTexture): SpriteLayer {
  return new SpriteLayer({ get: () => sheet } as unknown as TextureStore);
}

/** The placed quad: its matrix and UV rect after a flush. */
function placed(sheet: SheetTexture, draw: Partial<SpriteDraw>) {
  const layer = layerFor(sheet);
  layer.draw({ key: 'k', x: 300, y: 200, ...draw });
  layer.flush();
  const mesh = layer.scene.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  return { matrix: mesh.matrix.toArray(), uv: mesh.material.uniforms.uvRect!.value.toArray() as number[], mesh };
}

describe('SpriteLayer with packed sheets', () => {
  const origins = [0, 0.25, 0.5, 1];
  const flips = [false, true];
  const rotations = [0, 0.7, -2.1];

  it('places a full-cell trim exactly like the grid path, for every origin, flip, rotation and frame', () => {
    for (const originX of origins) for (const originY of origins)
      for (const flipX of flips) for (const flipY of flips)
        for (const rotation of rotations) for (const frame of [0, 1, 4, 5]) {
          const draw = { frame, originX, originY, flipX, flipY, rotation, scaleX: 1.3, scaleY: 0.8 };
          const a = placed(grid, draw), b = placed(fullCellTrims, draw);
          expect(b.matrix).toEqual(a.matrix);
          expect(b.uv).toEqual(a.uv);
        }
  });

  it('keeps a displaySize draw on the logical cell', () => {
    const draw = { frame: 2, displayWidth: 120, displayHeight: 45, flipX: true };
    expect(placed(fullCellTrims, draw).matrix).toEqual(placed(grid, draw).matrix);
  });

  it('draws a trim at its offset inside the cell, mirrored inside the same box when flipped', () => {
    const [dx, dy, w, h] = [12, 7, 20, 10];
    const trimmed: SheetTexture = { ...grid, columns: 1, frameCount: 1, atlas: [64, 32], width: 64, height: 32, trims: [[4, 2, w, h, dx, dy]] };
    const originX = 0.25, originY = 0.6, scale = 2, X = 300, Y = 200;
    const ox = originX * W, oy = originY * H;
    /** The quad's edges in design px (y down). */
    const edges = (flipX: boolean, flipY: boolean) => {
      const { mesh } = placed(trimmed, { frame: 0, originX, originY, flipX, flipY, scaleX: scale, scaleY: scale, x: X, y: Y });
      const toDesign = (p: THREE.Vector3) => ({ x: p.x * PX_PER_UNIT + STAGE_DESIGN_WIDTH / 2, y: STAGE_DESIGN_HEIGHT / 2 - p.y * PX_PER_UNIT });
      const a = toDesign(new THREE.Vector3(0, 0, 0).applyMatrix4(mesh.matrix)), b = toDesign(new THREE.Vector3(1, 1, 0).applyMatrix4(mesh.matrix));
      return { left: Math.min(a.x, b.x), right: Math.max(a.x, b.x), top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) };
    };
    const plain = edges(false, false);
    expect(plain.left).toBeCloseTo(X + scale * (dx - ox), 6);
    expect(plain.right).toBeCloseTo(X + scale * (dx + w - ox), 6);
    expect(plain.top).toBeCloseTo(Y + scale * (dy - oy), 6);
    expect(plain.bottom).toBeCloseTo(Y + scale * (dy + h - oy), 6);
    // Flipping mirrors the drawing inside the same logical box: cell px c lands at W - c - ox.
    const flipped = edges(true, true);
    expect(flipped.left).toBeCloseTo(X + scale * (W - dx - w - ox), 6);
    expect(flipped.right).toBeCloseTo(X + scale * (W - dx - ox), 6);
    expect(flipped.top).toBeCloseTo(Y + scale * (H - dy - h - oy), 6);
    expect(flipped.bottom).toBeCloseTo(Y + scale * (H - dy - oy), 6);
  });

  it('divides UVs by the layout atlas size, not the decoded image', () => {
    const trimmed: SheetTexture = { ...grid, columns: 1, frameCount: 1, atlas: [64, 32], width: 64, height: 32, trims: [[4, 2, 20, 10, 0, 0]] };
    expect(placed(trimmed, {}).uv).toEqual([4 / 64, 1 - 12 / 32, 20 / 64, 10 / 32]);
  });

  it('clips shooting layers in logical rows while retaining the packed UV and world registration', () => {
    const sheet: SheetTexture = { ...grid, columns: 1, frameCount: 1, atlas: [64, 32], width: 64, height: 32,
      trims: [[4, 2, 20, 16, 12, 7]] };
    const full = placed(sheet, { x: 300, y: 200, originX: 0, originY: 0 });
    const crop = placed(sheet, { x: 300, y: 200, originX: 0, originY: 0, clipRows: { top: 12, bottom: 20 } });
    expect(crop.uv).toEqual([4 / 64, 1 - 15 / 32, 20 / 64, 8 / 32]);
    const point = (mesh: typeof crop.mesh, y: number) => new THREE.Vector3(0, y, 0).applyMatrix4(mesh.matrix);
    const croppedTop = point(crop.mesh, 0), originalTop = point(full.mesh, 0);
    expect(croppedTop.y).toBeCloseTo(originalTop.y - 5 / PX_PER_UNIT);
    expect(point(crop.mesh, 1).y).toBeCloseTo(croppedTop.y - 8 / PX_PER_UNIT);
  });
});
