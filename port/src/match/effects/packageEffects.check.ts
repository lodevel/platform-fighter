import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { CharacterPackage } from '../../../../character/package/types';
import { SAMPLE } from '../../../../character/testing/samplePackage';
import type { LoadedPackage } from '../../fighters/packageLibrary';
import { effectDraw, type EffectSprite } from './packageEffects';

/** SAMPLE's drawings as a 4-tick burst: 32×32 rects anchored at (16, 30), 0.5 design px per page px. */
const PKG: CharacterPackage = { ...SAMPLE, actions: { ...SAMPLE.actions, 'effect.burst': { bodyCentreFromRootY: 0,
  drawings: { after: 'stop', windows: [{ start: 0, end: 2, drawing: 'idle/0' }, { start: 2, end: 4, drawing: 'idle/1' }] } } } };
const PAGE = { texture: new THREE.Texture(), width: 64, height: 32 };
const LOADED: LoadedPackage = { pkg: PKG, pages: new Map([['p0', PAGE]]), palette: new THREE.DataTexture(), costumes: 2, gpuBytes: 0 };

/** The legacy draw: a 256 px cell, centred origin, rotated, cue scale 2 on a 0.25 sheet. */
const sprite = (facing: 1 | -1, tick: number): EffectSprite => ({ key: 'char.sample.fx__burst', frame: tick, x: 300, y: 200,
  originX: .5, originY: .5, scaleX: .5, scaleY: .5, flipX: facing === -1, rotation: .3, depth: 5, alpha: .8,
  art: { characterId: 'sample', action: 'effect.burst', tick, facing, scaleX: 2, scaleY: 2 } });

describe('effects from character packages', () => {
  it('keeps the legacy sprite for a fighter drawn from legacy sheets', () => {
    const legacy = sprite(1, 0);
    expect(effectDraw(legacy, () => undefined)).toBe(legacy);
    expect(effectDraw({ ...legacy, art: undefined }, () => LOADED)).toEqual({ ...legacy, art: undefined });
  });

  it.each([1, -1] as const)('draws the action at its tick on the root, in costume 0, facing %s', facing => {
    const draw = effectDraw(sprite(facing, 3), () => LOADED)!;
    expect(draw).toMatchObject({ key: 'package.sample.idle/1', x: 300, y: 200, rotation: .3, depth: 5, alpha: .8, flipX: facing === -1,
      originX: facing === 1 ? 16 / 32 : 1 - 16 / 32, originY: 30 / 32, scaleX: 1, scaleY: 1 });
    expect(draw.frame).toBeUndefined();
    expect(draw.indexed).toEqual({ page: PAGE, rect: [32, 0, 32, 32], palette: LOADED.palette, paletteRow: 0 });
  });

  it('draws nothing past a stopped effect, for an unknown action, or while the package is not resident', () => {
    expect(effectDraw(sprite(1, 4), () => LOADED)).toBeNull();
    expect(effectDraw({ ...sprite(1, 0), art: { characterId: 'sample', action: 'effect.none', tick: 0, facing: 1 } }, () => LOADED)).toBeNull();
    expect(effectDraw(sprite(1, 0), () => null)).toBeNull();
  });
});
