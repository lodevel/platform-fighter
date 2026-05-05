import { describe, it, expect } from 'vitest';
import type {
  MovingPlatformMotion,
  StagePlatform,
} from '../types';
import {
  PLATFORM_BEHAVIORS,
  MOVING_PLATFORM_MOTION_DEFAULTS,
  getPlatformBehavior,
  isPassThroughPlatform,
  isMovingPlatform,
  resolveMovingPlatformMotion,
  validateMovingPlatformMotion,
  validateStagePlatform,
} from './platformBehavior';

/**
 * Sub-AC 1 of AC 90301 — extend the stage data schema to include the
 * three platform behavior types (solid, pass-through, moving) with
 * associated config fields and TypeScript types.
 *
 * These tests lock down:
 *   - The canonical list of behaviors is exactly the three required.
 *   - Behavior resolution is backward compatible with the M1 schema
 *     (records that only declare `passThrough` keep resolving to
 *     `'solid'` / `'pass-through'`).
 *   - The new explicit `behavior` field takes precedence when set.
 *   - Moving platforms expose all required config fields and are
 *     validated for determinism (integer cycleFrames, ≥ 2 waypoints,
 *     known mode/easing values).
 *   - Cross-field invariants (`behavior === 'moving'` ⇒ motion present;
 *     `behavior === 'solid'` ⇒ no motion; `behavior` ↔ `passThrough`
 *     consistent) are enforced.
 */

function makeBasePlatform(): Pick<
  StagePlatform,
  'x' | 'y' | 'width' | 'height'
> {
  return { x: 100, y: 200, width: 300, height: 40 };
}

const validMotion: MovingPlatformMotion = {
  waypoints: [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
  ],
  cycleFrames: 240,
};

describe('PLATFORM_BEHAVIORS — canonical list of three behavior types', () => {
  it('enumerates exactly solid, pass-through, and moving in that order', () => {
    expect(PLATFORM_BEHAVIORS).toEqual(['solid', 'pass-through', 'moving']);
  });

  it('is frozen so callers cannot mutate the canonical list', () => {
    expect(Object.isFrozen(PLATFORM_BEHAVIORS)).toBe(true);
  });
});

describe('getPlatformBehavior() — backward compatibility with legacy passThrough', () => {
  it('returns "solid" for a legacy platform with passThrough: false and no behavior set', () => {
    const p: StagePlatform = { ...makeBasePlatform(), passThrough: false };
    expect(getPlatformBehavior(p)).toBe('solid');
  });

  it('returns "pass-through" for a legacy platform with passThrough: true and no behavior set', () => {
    const p: StagePlatform = { ...makeBasePlatform(), passThrough: true };
    expect(getPlatformBehavior(p)).toBe('pass-through');
  });

  it('uses the explicit behavior field when present, ignoring legacy fallback', () => {
    const moving: StagePlatform = {
      ...makeBasePlatform(),
      passThrough: false,
      behavior: 'moving',
      motion: validMotion,
    };
    expect(getPlatformBehavior(moving)).toBe('moving');

    // Even with passThrough false, an explicit behavior wins.
    const explicit: StagePlatform = {
      ...makeBasePlatform(),
      passThrough: true,
      behavior: 'pass-through',
    };
    expect(getPlatformBehavior(explicit)).toBe('pass-through');
  });
});

describe('isPassThroughPlatform / isMovingPlatform helpers', () => {
  it('classifies legacy solid platforms correctly', () => {
    const p: StagePlatform = { ...makeBasePlatform(), passThrough: false };
    expect(isPassThroughPlatform(p)).toBe(false);
    expect(isMovingPlatform(p)).toBe(false);
  });

  it('classifies legacy pass-through platforms correctly', () => {
    const p: StagePlatform = { ...makeBasePlatform(), passThrough: true };
    expect(isPassThroughPlatform(p)).toBe(true);
    expect(isMovingPlatform(p)).toBe(false);
  });

  it('classifies moving platforms correctly', () => {
    const p: StagePlatform = {
      ...makeBasePlatform(),
      passThrough: false,
      behavior: 'moving',
      motion: validMotion,
    };
    expect(isPassThroughPlatform(p)).toBe(false);
    expect(isMovingPlatform(p)).toBe(true);
  });
});

describe('resolveMovingPlatformMotion() — fills in optional defaults', () => {
  it('uses the motion record values when all optional fields are set', () => {
    const motion: MovingPlatformMotion = {
      waypoints: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      cycleFrames: 120,
      phaseFrames: 60,
      mode: 'loop',
      easing: 'sine',
    };
    expect(resolveMovingPlatformMotion(motion)).toEqual(motion);
  });

  it('fills phaseFrames, mode, and easing with canonical defaults when omitted', () => {
    const resolved = resolveMovingPlatformMotion(validMotion);
    expect(resolved.phaseFrames).toBe(MOVING_PLATFORM_MOTION_DEFAULTS.phaseFrames);
    expect(resolved.mode).toBe(MOVING_PLATFORM_MOTION_DEFAULTS.mode);
    expect(resolved.easing).toBe(MOVING_PLATFORM_MOTION_DEFAULTS.easing);
    expect(resolved.cycleFrames).toBe(validMotion.cycleFrames);
    expect(resolved.waypoints).toBe(validMotion.waypoints);
  });

  it('exposes the documented defaults: ping-pong / linear / phase 0', () => {
    expect(MOVING_PLATFORM_MOTION_DEFAULTS.mode).toBe('ping-pong');
    expect(MOVING_PLATFORM_MOTION_DEFAULTS.easing).toBe('linear');
    expect(MOVING_PLATFORM_MOTION_DEFAULTS.phaseFrames).toBe(0);
  });
});

describe('validateMovingPlatformMotion() — config invariants', () => {
  it('accepts a minimally valid motion record', () => {
    expect(() => validateMovingPlatformMotion(validMotion)).not.toThrow();
  });

  it('rejects a path with fewer than 2 waypoints', () => {
    expect(() =>
      validateMovingPlatformMotion({
        waypoints: [{ x: 0, y: 0 }],
        cycleFrames: 120,
      }),
    ).toThrow(/at least 2/);
  });

  it('rejects waypoints with non-finite coordinates', () => {
    expect(() =>
      validateMovingPlatformMotion({
        waypoints: [
          { x: 0, y: 0 },
          { x: Number.NaN, y: 10 },
        ],
        cycleFrames: 120,
      }),
    ).toThrow(/non-finite/);
  });

  it('rejects non-integer cycleFrames so the cycle stays deterministic', () => {
    expect(() =>
      validateMovingPlatformMotion({ ...validMotion, cycleFrames: 60.5 }),
    ).toThrow(/cycleFrames/);
  });

  it('rejects cycleFrames below 2 (no oscillation possible)', () => {
    expect(() =>
      validateMovingPlatformMotion({ ...validMotion, cycleFrames: 1 }),
    ).toThrow(/cycleFrames/);
  });

  it('rejects non-integer phaseFrames', () => {
    expect(() =>
      validateMovingPlatformMotion({ ...validMotion, phaseFrames: 12.3 }),
    ).toThrow(/phaseFrames/);
  });

  it('rejects an unknown mode', () => {
    expect(() =>
      validateMovingPlatformMotion({
        ...validMotion,
        mode: 'spiral' as unknown as 'loop',
      }),
    ).toThrow(/mode/);
  });

  it('rejects an unknown easing curve', () => {
    expect(() =>
      validateMovingPlatformMotion({
        ...validMotion,
        easing: 'cubic' as unknown as 'sine',
      }),
    ).toThrow(/easing/);
  });
});

describe('validateStagePlatform() — cross-field schema invariants', () => {
  it('accepts a legacy solid platform (passThrough: false, no behavior)', () => {
    const p: StagePlatform = { ...makeBasePlatform(), passThrough: false };
    expect(() => validateStagePlatform(p)).not.toThrow();
  });

  it('accepts a legacy pass-through platform (passThrough: true, no behavior)', () => {
    const p: StagePlatform = { ...makeBasePlatform(), passThrough: true };
    expect(() => validateStagePlatform(p)).not.toThrow();
  });

  it('accepts an explicit moving platform with a valid motion record', () => {
    const p: StagePlatform = {
      ...makeBasePlatform(),
      passThrough: false,
      behavior: 'moving',
      motion: validMotion,
    };
    expect(() => validateStagePlatform(p)).not.toThrow();
  });

  it('rejects behavior "moving" without a motion record', () => {
    const p: StagePlatform = {
      ...makeBasePlatform(),
      passThrough: false,
      behavior: 'moving',
    };
    expect(() => validateStagePlatform(p)).toThrow(/motion is missing/);
  });

  it('rejects a non-moving behavior that carries a motion record', () => {
    const p: StagePlatform = {
      ...makeBasePlatform(),
      passThrough: false,
      behavior: 'solid',
      motion: validMotion,
    };
    expect(() => validateStagePlatform(p)).toThrow(/motion is only valid/);
  });

  it('rejects behavior "solid" combined with passThrough: true', () => {
    const p: StagePlatform = {
      ...makeBasePlatform(),
      passThrough: true,
      behavior: 'solid',
    };
    expect(() => validateStagePlatform(p)).toThrow(/inconsistent/);
  });

  it('rejects behavior "pass-through" combined with passThrough: false', () => {
    const p: StagePlatform = {
      ...makeBasePlatform(),
      passThrough: false,
      behavior: 'pass-through',
    };
    expect(() => validateStagePlatform(p)).toThrow(/inconsistent/);
  });

  it('propagates motion-config errors with the platform context', () => {
    const p: StagePlatform = {
      ...makeBasePlatform(),
      passThrough: false,
      behavior: 'moving',
      motion: { waypoints: [{ x: 0, y: 0 }], cycleFrames: 120 },
    };
    expect(() => validateStagePlatform(p, 'moving-A')).toThrow(/moving-A.*at least 2/);
  });
});

describe('schema backward compatibility — existing M1 stage records still type-check', () => {
  it('accepts a record with only the legacy fields (no behavior, no motion)', () => {
    const p: StagePlatform = {
      x: 0,
      y: 0,
      width: 100,
      height: 20,
      passThrough: true,
    };
    // Reads fine through the legacy field, and resolves via the helper.
    expect(p.passThrough).toBe(true);
    expect(getPlatformBehavior(p)).toBe('pass-through');
  });
});
