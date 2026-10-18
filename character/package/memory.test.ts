import { expect, it } from 'vitest';
import { SAMPLE } from '../testing/samplePackage';
import { actionMemory, packageMemory, sharedDrawings } from './memory';

it('estimates pages and drawings once each', () => {
  expect(actionMemory(SAMPLE, 'idle')).toEqual({ drawings: 2, pages: 1, drawnPixels: 2 * 32 * 32, rgbaBytes: 64 * 32 * 4, bc7Bytes: 16 * 8 * 16, gpuBytes: 16 * 8 * 16 });
  expect(packageMemory(SAMPLE)).toEqual(actionMemory(SAMPLE, 'idle'));
  expect(sharedDrawings(SAMPLE)).toBe(0);
  expect(sharedDrawings({ ...SAMPLE, actions: { ...SAMPLE.actions, again: SAMPLE.actions.idle! } })).toBe(2);
});
