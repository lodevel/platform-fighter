import { describe, expect, it } from 'vitest';
import { frameDeltaMs } from './frameDelta';

describe('frame delta', () => {
  it('never runs backward and caps a long gap', () => {
    expect(frameDeltaMs(1016, 1000)).toBe(16);
    // An animation-frame stamp taken before a long blocking task, read after a draw at performance.now().
    expect(frameDeltaMs(1000, 61000)).toBe(0);
    expect(frameDeltaMs(61000, 1000)).toBe(100);
    expect(frameDeltaMs(1100, 1000, 50)).toBe(50);
  });
});
