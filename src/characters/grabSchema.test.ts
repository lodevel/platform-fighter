import { describe, expect, it } from 'vitest';

import {
  type GrabSpec,
  getGrabWhiffTotalFrames,
  validateGrabSpec,
  validatePummelSpec,
} from './grabSchema';

const validSpec = (): GrabSpec => ({
  id: 'wolf.grab',
  hitbox: { offsetX: 22, offsetY: 0, width: 30, height: 30 },
  startupFrames: 7,
  activeFrames: 2,
  whiffRecoveryFrames: 32,
  holdFramesMax: 90,
  throwRecoveryFrames: 24,
  pummel: { damage: 1.5, cooldownFrames: 14 },
  throws: {
    forward: {
      damage: 8,
      knockback: { x: 2.5, y: -1.0, scaling: 0.1 },
      animationFrames: 22,
    },
    back: {
      damage: 10,
      knockback: { x: 2.8, y: -1.2, scaling: 0.12 },
      animationFrames: 26,
    },
    up: {
      damage: 7,
      knockback: { x: 0.5, y: -3.0, scaling: 0.1 },
      animationFrames: 14,
    },
    down: {
      damage: 6,
      knockback: { x: 0.8, y: 1.2, scaling: 0.08 },
      animationFrames: 16,
    },
  },
});

describe('validateGrabSpec — happy path', () => {
  it('returns the spec unchanged on success', () => {
    const s = validSpec();
    expect(validateGrabSpec(s)).toBe(s);
  });

  it('accepts a spec with no pummel', () => {
    const { pummel, ...rest } = validSpec();
    void pummel;
    expect(() => validateGrabSpec(rest as GrabSpec)).not.toThrow();
  });
});

describe('validateGrabSpec — invariants', () => {
  it('rejects empty id', () => {
    expect(() => validateGrabSpec({ ...validSpec(), id: '' })).toThrow(/id/);
  });

  it('rejects non-positive hitbox dimensions', () => {
    expect(() =>
      validateGrabSpec({
        ...validSpec(),
        hitbox: { ...validSpec().hitbox, width: 0 },
      }),
    ).toThrow(/hitbox/);
  });

  it('rejects non-finite hitbox offsets', () => {
    expect(() =>
      validateGrabSpec({
        ...validSpec(),
        hitbox: { ...validSpec().hitbox, offsetX: NaN },
      }),
    ).toThrow(/hitbox/);
  });

  it('rejects negative frame counts', () => {
    for (const field of [
      'startupFrames',
      'activeFrames',
      'whiffRecoveryFrames',
      'holdFramesMax',
      'throwRecoveryFrames',
    ] as const) {
      const bad = { ...validSpec(), [field]: -1 } as GrabSpec;
      expect(() => validateGrabSpec(bad)).toThrow(new RegExp(field));
    }
  });

  it('rejects non-integer frame counts', () => {
    expect(() =>
      validateGrabSpec({ ...validSpec(), holdFramesMax: 90.5 }),
    ).toThrow(/holdFramesMax/);
  });

  it('rejects activeFrames === 0', () => {
    expect(() =>
      validateGrabSpec({ ...validSpec(), activeFrames: 0 }),
    ).toThrow(/activeFrames/);
  });

  it('rejects holdFramesMax === 0', () => {
    expect(() =>
      validateGrabSpec({ ...validSpec(), holdFramesMax: 0 }),
    ).toThrow(/holdFramesMax/);
  });

  it('cascades into per-throw validation', () => {
    const bad: GrabSpec = {
      ...validSpec(),
      throws: {
        ...validSpec().throws,
        up: { ...validSpec().throws.up, damage: -5 },
      },
    };
    expect(() => validateGrabSpec(bad)).toThrow(/up/);
  });
});

describe('validatePummelSpec', () => {
  it('rejects negative damage', () => {
    expect(() =>
      validatePummelSpec({ damage: -1, cooldownFrames: 12 }, 'test'),
    ).toThrow(/damage/);
  });

  it('rejects negative cooldownFrames', () => {
    expect(() =>
      validatePummelSpec({ damage: 1, cooldownFrames: -1 }, 'test'),
    ).toThrow(/cooldownFrames/);
  });

  it('rejects non-integer cooldownFrames', () => {
    expect(() =>
      validatePummelSpec({ damage: 1, cooldownFrames: 12.5 }, 'test'),
    ).toThrow(/cooldownFrames/);
  });
});

describe('getGrabWhiffTotalFrames', () => {
  it('sums startup + active + whiffRecovery', () => {
    const s = validSpec();
    expect(getGrabWhiffTotalFrames(s)).toBe(
      s.startupFrames + s.activeFrames + s.whiffRecoveryFrames,
    );
  });
});
