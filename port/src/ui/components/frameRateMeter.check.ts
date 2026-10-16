import { describe, expect, it } from 'vitest';
import { FrameRateSampler, type FrameRateSample } from './frameRateMeter';

describe('rendered-frame sampling', () => {
  it.each([30, 60, 120])('measures %i rendered FPS independently of simulation tick rate', fps => {
    const sampler = new FrameRateSampler();
    const samples: FrameRateSample[] = [];
    for (let frame = 0; frame <= fps * 2; frame++) {
      const sample = sampler.record(frame * 1000 / fps);
      if (sample) samples.push(sample);
    }
    expect(samples.length).toBeGreaterThanOrEqual(6);
    for (const sample of samples) {
      expect(sample.fps).toBeCloseTo(fps, 6);
      expect(sample.frameTimeMs).toBeCloseTo(1000 / fps, 6);
    }
  });

  it('reports slower rendering in the rolling window and publishes at most four times per second', () => {
    const sampler = new FrameRateSampler();
    let latest: FrameRateSample | null = null;
    let lastPublication = -Infinity;
    for (let now = 0; now <= 2000; now += 10) {
      if (now > 1000 && now % 50 !== 0) continue;
      const sample = sampler.record(now);
      if (sample) {
        expect(now - lastPublication).toBeGreaterThanOrEqual(250);
        latest = sample; lastPublication = now;
      }
    }
    expect(latest?.fps).toBe(20);
    expect(latest?.frameTimeMs).toBe(50);
  });

  it('counts a visible stall instead of hiding it, but excludes hidden-tab pauses after reset', () => {
    const sampler = new FrameRateSampler();
    for (let now = 0; now <= 1000; now += 20) sampler.record(now);
    expect(sampler.record(4000)?.fps).toBe(1);
    sampler.reset();
    expect(sampler.record(64000)).toBeNull();
    let latest: FrameRateSample | null = null;
    for (let now = 64020; now <= 65000; now += 20) latest = sampler.record(now) ?? latest;
    expect(latest?.fps).toBe(50);
  });

  it('ignores repeated and invalid timestamps rather than counting duplicate renders', () => {
    const sampler = new FrameRateSampler();
    sampler.record(0);
    expect(sampler.record(0)).toBeNull();
    expect(sampler.record(NaN)).toBeNull();
    expect(sampler.record(-1)).toBeNull();
    expect(sampler.record(250)?.fps).toBe(4);
  });
});
