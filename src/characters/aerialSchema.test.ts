import { describe, it, expect } from 'vitest';
import {
  validateAerialMove,
  validateAutoCancelWindow,
  isAutoCancelFrame,
  getLandingLagFrames,
  getAutoCancelWindowPhase,
  getAutoCancelWindowsByPhase,
  getKnockbackLaunchAngleRadians,
  getKnockbackLaunchAngleDegrees,
  type AerialMove,
  type AutoCancelWindow,
} from './aerialSchema';
import {
  WOLF_NAIR_AERIAL,
  WOLF_FAIR,
  WOLF_BAIR,
  CAT_NAIR_AERIAL,
  CAT_FAIR,
  CAT_BAIR,
  OWL_NAIR,
  OWL_FAIR,
  OWL_BAIR,
  BEAR_NAIR,
  BEAR_FAIR,
  BEAR_BAIR,
} from './index';

/**
 * AC 60101 Sub-AC 1 — aerial schema + per-character aerial data.
 *
 * `aerialSchema.ts` is pure (no Phaser, no Matter, no Math.random,
 * no wall-clock). This suite locks down:
 *
 *   1. Schema validators — `validateAutoCancelWindow` and
 *      `validateAerialMove` reject malformed records with clear
 *      errors and accept all twelve authored aerial records.
 *   2. Auto-cancel predicate — `isAutoCancelFrame` reads the windows
 *      correctly, including the half-open boundaries and the
 *      "post-busy" implicit auto-cancel.
 *   3. Landing-lag selector — `getLandingLagFrames` returns 0 in
 *      auto-cancel windows and the move's lag value otherwise.
 *   4. Knockback angle helpers — convert Phaser screen-space (y-down)
 *      vectors into standard math-convention angles (y-up).
 *   5. Per-character data — each authored aerial passes the schema
 *      and the Seed roster invariants (every character has nair,
 *      fair, bair; ids are unique; type is 'aerial'; aerialDirection
 *      matches the move semantically).
 */

// ---------------------------------------------------------------------------
// validateAutoCancelWindow
// ---------------------------------------------------------------------------

describe('validateAutoCancelWindow', () => {
  it('accepts a valid half-open window', () => {
    const w: AutoCancelWindow = { startFrame: 0, endFrame: 5 };
    expect(validateAutoCancelWindow(w)).toBe(w);
  });

  it('rejects a window with non-integer frames', () => {
    expect(() =>
      validateAutoCancelWindow({ startFrame: 0.5, endFrame: 5 }),
    ).toThrow(/integers/);
  });

  it('rejects a negative startFrame', () => {
    expect(() =>
      validateAutoCancelWindow({ startFrame: -1, endFrame: 5 }),
    ).toThrow(/non-negative/);
  });

  it('rejects endFrame <= startFrame (empty / inverted window)', () => {
    expect(() =>
      validateAutoCancelWindow({ startFrame: 5, endFrame: 5 }),
    ).toThrow(/> startFrame/);
    expect(() =>
      validateAutoCancelWindow({ startFrame: 5, endFrame: 3 }),
    ).toThrow(/> startFrame/);
  });
});

// ---------------------------------------------------------------------------
// validateAerialMove
// ---------------------------------------------------------------------------

const SAMPLE_AERIAL: AerialMove = {
  id: 'sample.nair',
  type: 'aerial',
  aerialDirection: 'neutral',
  damage: 6,
  knockback: { x: 1.0, y: -1.0, scaling: 0.1 },
  hitbox: { offsetX: 0, offsetY: 0, width: 80, height: 80 },
  startupFrames: 4,
  activeFrames: 4,
  recoveryFrames: 8,
  cooldownFrames: 6,
  landingLagFrames: 10,
  autoCancelWindows: [{ startFrame: 0, endFrame: 4 }],
};

describe('validateAerialMove', () => {
  it('accepts a well-formed aerial', () => {
    expect(validateAerialMove(SAMPLE_AERIAL)).toBe(SAMPLE_AERIAL);
  });

  it("rejects type !== 'aerial'", () => {
    const bad = { ...SAMPLE_AERIAL, type: 'jab' as const } as unknown as AerialMove;
    expect(() => validateAerialMove(bad)).toThrow(/type must be 'aerial'/);
  });

  it('rejects negative landingLagFrames', () => {
    const bad: AerialMove = { ...SAMPLE_AERIAL, landingLagFrames: -1 };
    expect(() => validateAerialMove(bad)).toThrow(/non-negative integer/);
  });

  it('rejects non-integer landingLagFrames', () => {
    const bad: AerialMove = { ...SAMPLE_AERIAL, landingLagFrames: 5.5 };
    expect(() => validateAerialMove(bad)).toThrow(/non-negative integer/);
  });

  it('rejects an auto-cancel window past busyTotal', () => {
    // SAMPLE_AERIAL busy = 4+4+8 = 16
    const bad: AerialMove = {
      ...SAMPLE_AERIAL,
      autoCancelWindows: [{ startFrame: 0, endFrame: 99 }],
    };
    expect(() => validateAerialMove(bad)).toThrow(/extends past busyTotal/);
  });

  it('rejects overlapping auto-cancel windows', () => {
    const bad: AerialMove = {
      ...SAMPLE_AERIAL,
      autoCancelWindows: [
        { startFrame: 0, endFrame: 5 },
        { startFrame: 4, endFrame: 8 },
      ],
    };
    expect(() => validateAerialMove(bad)).toThrow(/overlap/);
  });

  it('accepts adjacent (touching) windows as non-overlapping', () => {
    // SAMPLE_AERIAL: startup=4, active=4, recovery=8 → busy=16.
    // Recovery phase = [8, 16); two touching windows wholly inside
    // recovery exercise the half-open boundary check without tripping
    // the AC 60204 Sub-AC 4 "no active overlap" rule.
    const ok: AerialMove = {
      ...SAMPLE_AERIAL,
      autoCancelWindows: [
        { startFrame: 8, endFrame: 12 },
        { startFrame: 12, endFrame: 16 },
      ],
    };
    expect(() => validateAerialMove(ok)).not.toThrow();
  });

  it('accepts a record with no auto-cancel windows declared', () => {
    const ok: AerialMove = { ...SAMPLE_AERIAL };
    delete (ok as { autoCancelWindows?: unknown }).autoCancelWindows;
    expect(() => validateAerialMove(ok)).not.toThrow();
  });

  // AC 60204 Sub-AC 4 — windows must be designated startup or
  // recovery ranges; overlapping the active phase is rejected.
  it('rejects an auto-cancel window that overlaps the active phase', () => {
    // SAMPLE_AERIAL: startup=4, active=4 → active phase = [4, 8).
    // A window [3, 6) starts in startup but ends inside active —
    // straddles the startup→active boundary.
    const bad: AerialMove = {
      ...SAMPLE_AERIAL,
      autoCancelWindows: [{ startFrame: 3, endFrame: 6 }],
    };
    expect(() => validateAerialMove(bad)).toThrow(/overlaps the active phase/);
  });

  it('rejects a window placed entirely inside the active phase', () => {
    // SAMPLE_AERIAL: active phase = [4, 8). A window [5, 7) is wholly
    // inside active — would let a fighter cancel out of a live
    // hitbox AND skip recovery, which is the canonical "auto-cancel
    // a still-swinging move" footgun.
    const bad: AerialMove = {
      ...SAMPLE_AERIAL,
      autoCancelWindows: [{ startFrame: 5, endFrame: 7 }],
    };
    expect(() => validateAerialMove(bad)).toThrow(/overlaps the active phase/);
  });

  it('rejects a window that straddles the active→recovery boundary', () => {
    // SAMPLE_AERIAL: active = [4, 8), recovery = [8, 16). A window
    // [7, 10) sits across the boundary — partially in active,
    // partially in recovery.
    const bad: AerialMove = {
      ...SAMPLE_AERIAL,
      autoCancelWindows: [{ startFrame: 7, endFrame: 10 }],
    };
    expect(() => validateAerialMove(bad)).toThrow(/overlaps the active phase/);
  });

  it('accepts a window that exactly touches the startup→active boundary at endFrame', () => {
    // [0, 4) ends EXACTLY at startupFrames=4 (half-open exclusion)
    // so the window covers only startup-phase frames.
    const ok: AerialMove = {
      ...SAMPLE_AERIAL,
      autoCancelWindows: [{ startFrame: 0, endFrame: 4 }],
    };
    expect(() => validateAerialMove(ok)).not.toThrow();
  });

  it('accepts a window that exactly touches the active→recovery boundary at startFrame', () => {
    // [8, 16) starts EXACTLY at startup+active=8 so the window covers
    // only recovery-phase frames.
    const ok: AerialMove = {
      ...SAMPLE_AERIAL,
      autoCancelWindows: [{ startFrame: 8, endFrame: 16 }],
    };
    expect(() => validateAerialMove(ok)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC 60204 Sub-AC 4 — auto-cancel windows are designated startup OR
// recovery frame ranges. The classifier helpers tell consumers (balance
// pass tooling, AI predictors, the runtime lockout handler) which
// bucket each authored window lives in.
// ---------------------------------------------------------------------------

describe('getAutoCancelWindowPhase (AC 60204 Sub-AC 4)', () => {
  // SAMPLE_AERIAL: startup=4, active=4, recovery=8 → busy=16.
  // Phase ranges:
  //   startup  = [0, 4)
  //   active   = [4, 8)
  //   recovery = [8, 16)
  it("returns 'startup' for a window wholly inside startup", () => {
    expect(
      getAutoCancelWindowPhase({ startFrame: 0, endFrame: 4 }, SAMPLE_AERIAL),
    ).toBe('startup');
    expect(
      getAutoCancelWindowPhase({ startFrame: 0, endFrame: 2 }, SAMPLE_AERIAL),
    ).toBe('startup');
  });

  it("returns 'recovery' for a window wholly inside recovery", () => {
    expect(
      getAutoCancelWindowPhase({ startFrame: 8, endFrame: 16 }, SAMPLE_AERIAL),
    ).toBe('recovery');
    expect(
      getAutoCancelWindowPhase({ startFrame: 14, endFrame: 16 }, SAMPLE_AERIAL),
    ).toBe('recovery');
  });

  it('returns null for a window overlapping the active phase', () => {
    expect(
      getAutoCancelWindowPhase({ startFrame: 5, endFrame: 7 }, SAMPLE_AERIAL),
    ).toBeNull();
  });

  it('returns null for a window straddling the startup→active boundary', () => {
    expect(
      getAutoCancelWindowPhase({ startFrame: 3, endFrame: 6 }, SAMPLE_AERIAL),
    ).toBeNull();
  });

  it('returns null for a window straddling the active→recovery boundary', () => {
    expect(
      getAutoCancelWindowPhase({ startFrame: 7, endFrame: 10 }, SAMPLE_AERIAL),
    ).toBeNull();
  });

  it('respects half-open boundaries: endFrame == startupFrames is startup', () => {
    // window [0, 4) — endFrame 4 is excluded, so the window covers
    // frames {0,1,2,3} which are all in startup.
    expect(
      getAutoCancelWindowPhase({ startFrame: 0, endFrame: 4 }, SAMPLE_AERIAL),
    ).toBe('startup');
  });

  it('respects half-open boundaries: startFrame == startup+active is recovery', () => {
    // window [8, 12) — startFrame 8 is the first recovery frame,
    // window covers frames {8..11} which are all in recovery.
    expect(
      getAutoCancelWindowPhase({ startFrame: 8, endFrame: 12 }, SAMPLE_AERIAL),
    ).toBe('recovery');
  });
});

describe('getAutoCancelWindowsByPhase (AC 60204 Sub-AC 4)', () => {
  it('partitions a two-window move into one startup and one recovery bucket', () => {
    const move: AerialMove = {
      ...SAMPLE_AERIAL,
      autoCancelWindows: [
        { startFrame: 0, endFrame: 3 },
        { startFrame: 14, endFrame: 16 },
      ],
    };
    const grouped = getAutoCancelWindowsByPhase(move);
    expect(grouped.startup).toEqual([{ startFrame: 0, endFrame: 3 }]);
    expect(grouped.recovery).toEqual([{ startFrame: 14, endFrame: 16 }]);
  });

  it('returns empty arrays when no windows declared', () => {
    const move: AerialMove = { ...SAMPLE_AERIAL, autoCancelWindows: [] };
    const grouped = getAutoCancelWindowsByPhase(move);
    expect(grouped.startup).toEqual([]);
    expect(grouped.recovery).toEqual([]);
  });

  it('preserves authoring order within each bucket', () => {
    const move: AerialMove = {
      ...SAMPLE_AERIAL,
      autoCancelWindows: [
        { startFrame: 0, endFrame: 2 },
        { startFrame: 8, endFrame: 10 },
        { startFrame: 2, endFrame: 4 },
        { startFrame: 14, endFrame: 16 },
      ],
    };
    const grouped = getAutoCancelWindowsByPhase(move);
    // First bucket entry comes before second; order preserved.
    expect(grouped.startup.map((w) => w.startFrame)).toEqual([0, 2]);
    expect(grouped.recovery.map((w) => w.startFrame)).toEqual([8, 14]);
  });

  it('throws on a malformed (active-overlapping) window', () => {
    const move: AerialMove = {
      ...SAMPLE_AERIAL,
      autoCancelWindows: [{ startFrame: 5, endFrame: 7 }],
    };
    expect(() => getAutoCancelWindowsByPhase(move)).toThrow(
      /overlaps the active phase/,
    );
  });

  it('returned arrays are frozen so callers cannot mutate the classification', () => {
    const move: AerialMove = {
      ...SAMPLE_AERIAL,
      autoCancelWindows: [{ startFrame: 0, endFrame: 2 }],
    };
    const grouped = getAutoCancelWindowsByPhase(move);
    expect(Object.isFrozen(grouped)).toBe(true);
    expect(Object.isFrozen(grouped.startup)).toBe(true);
    expect(Object.isFrozen(grouped.recovery)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isAutoCancelFrame
// ---------------------------------------------------------------------------

describe('isAutoCancelFrame', () => {
  const move: AerialMove = {
    ...SAMPLE_AERIAL,
    autoCancelWindows: [
      { startFrame: 0, endFrame: 3 },
      { startFrame: 14, endFrame: 16 },
    ],
  };

  it('returns true within the early window', () => {
    expect(isAutoCancelFrame(move, 0)).toBe(true);
    expect(isAutoCancelFrame(move, 2)).toBe(true);
  });

  it('respects the half-open upper bound (endFrame is excluded)', () => {
    // window [0, 3) — frame 3 is OUTSIDE the window
    expect(isAutoCancelFrame(move, 3)).toBe(false);
  });

  it('returns true within the late window', () => {
    expect(isAutoCancelFrame(move, 14)).toBe(true);
    expect(isAutoCancelFrame(move, 15)).toBe(true);
  });

  it('returns false in between the two windows', () => {
    expect(isAutoCancelFrame(move, 5)).toBe(false);
    expect(isAutoCancelFrame(move, 10)).toBe(false);
  });

  it('returns true once the move has fully ended (post-busy)', () => {
    // busy = 4+4+8 = 16 → frames >= 16 are 'done' phase, auto-cancel
    expect(isAutoCancelFrame(move, 16)).toBe(true);
    expect(isAutoCancelFrame(move, 100)).toBe(true);
  });

  it('returns false during the busy window when no windows declared', () => {
    const noWindows: AerialMove = { ...SAMPLE_AERIAL, autoCancelWindows: [] };
    expect(isAutoCancelFrame(noWindows, 5)).toBe(false);
    expect(isAutoCancelFrame(noWindows, 10)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getLandingLagFrames
// ---------------------------------------------------------------------------

describe('getLandingLagFrames', () => {
  const move: AerialMove = {
    ...SAMPLE_AERIAL,
    landingLagFrames: 12,
    autoCancelWindows: [{ startFrame: 0, endFrame: 4 }],
  };

  it('returns 0 inside an auto-cancel window', () => {
    expect(getLandingLagFrames(move, 0)).toBe(0);
    expect(getLandingLagFrames(move, 3)).toBe(0);
  });

  it('returns the move lag value outside any window', () => {
    expect(getLandingLagFrames(move, 5)).toBe(12);
    expect(getLandingLagFrames(move, 10)).toBe(12);
  });

  it('returns 0 once the move is done (post-busy implicit cancel)', () => {
    expect(getLandingLagFrames(move, 100)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Knockback angle helpers
// ---------------------------------------------------------------------------

describe('knockback launch angle helpers', () => {
  it('horizontal-only knockback returns 0 rad / 0°', () => {
    const m = { ...SAMPLE_AERIAL, knockback: { x: 1, y: 0, scaling: 0 } };
    expect(getKnockbackLaunchAngleRadians(m)).toBeCloseTo(0);
    expect(getKnockbackLaunchAngleDegrees(m)).toBeCloseTo(0);
  });

  it('y < 0 (Phaser "up") returns positive angle in math-convention (up is +)', () => {
    // (1, -1) in screen-space → math angle = atan2(1, 1) = +45°
    const m = { ...SAMPLE_AERIAL, knockback: { x: 1, y: -1, scaling: 0 } };
    expect(getKnockbackLaunchAngleDegrees(m)).toBeCloseTo(45);
  });

  it('y > 0 (Phaser "down") returns a negative angle (downward = below horizon)', () => {
    const m = { ...SAMPLE_AERIAL, knockback: { x: 1, y: 1, scaling: 0 } };
    expect(getKnockbackLaunchAngleDegrees(m)).toBeCloseTo(-45);
  });

  it('straight up (y < 0, x = 0) returns +90°', () => {
    const m = { ...SAMPLE_AERIAL, knockback: { x: 0, y: -1, scaling: 0 } };
    expect(getKnockbackLaunchAngleDegrees(m)).toBeCloseTo(90);
  });

  it('horizontal back (x < 0) returns 180°', () => {
    const m = { ...SAMPLE_AERIAL, knockback: { x: -1, y: 0, scaling: 0 } };
    expect(Math.abs(getKnockbackLaunchAngleDegrees(m))).toBeCloseTo(180);
  });
});

// ---------------------------------------------------------------------------
// Per-character authored data — every aerial validates and matches the
// expected direction / id naming.
// ---------------------------------------------------------------------------

const CHARACTER_AERIALS = [
  { name: 'wolf.nair', move: WOLF_NAIR_AERIAL, dir: 'neutral' },
  { name: 'wolf.fair', move: WOLF_FAIR, dir: 'forward' },
  { name: 'wolf.bair', move: WOLF_BAIR, dir: 'back' },
  { name: 'cat.nair', move: CAT_NAIR_AERIAL, dir: 'neutral' },
  { name: 'cat.fair', move: CAT_FAIR, dir: 'forward' },
  { name: 'cat.bair', move: CAT_BAIR, dir: 'back' },
  { name: 'owl.nair', move: OWL_NAIR, dir: 'neutral' },
  { name: 'owl.fair', move: OWL_FAIR, dir: 'forward' },
  { name: 'owl.bair', move: OWL_BAIR, dir: 'back' },
  { name: 'bear.nair', move: BEAR_NAIR, dir: 'neutral' },
  { name: 'bear.fair', move: BEAR_FAIR, dir: 'forward' },
  { name: 'bear.bair', move: BEAR_BAIR, dir: 'back' },
] as const;

describe('per-character aerial data', () => {
  for (const entry of CHARACTER_AERIALS) {
    it(`${entry.name}: passes validateAerialMove`, () => {
      expect(() => validateAerialMove(entry.move)).not.toThrow();
    });

    it(`${entry.name}: aerialDirection matches the expected '${entry.dir}'`, () => {
      expect(entry.move.aerialDirection).toBe(entry.dir);
    });

    it(`${entry.name}: id is the canonical '<character>.<direction>' label`, () => {
      const expectedSuffix =
        entry.dir === 'neutral' ? '.nair' : entry.dir === 'forward' ? '.fair' : '.bair';
      expect(entry.move.id.endsWith(expectedSuffix)).toBe(true);
    });

    it(`${entry.name}: declares an animation block within the 6-8 frame Seed range`, () => {
      const a = entry.move.animation;
      expect(a).toBeDefined();
      const total =
        (a?.startupFrames ?? 0) + (a?.activeFrames ?? 0) + (a?.recoveryFrames ?? 0);
      expect(total).toBeGreaterThanOrEqual(6);
      expect(total).toBeLessThanOrEqual(8);
    });

    it(`${entry.name}: damage is positive`, () => {
      expect(entry.move.damage).toBeGreaterThan(0);
    });

    it(`${entry.name}: hitbox has positive dimensions`, () => {
      expect(entry.move.hitbox.width).toBeGreaterThan(0);
      expect(entry.move.hitbox.height).toBeGreaterThan(0);
    });

    it(`${entry.name}: startup/active/recovery/cooldown are all non-negative`, () => {
      expect(entry.move.startupFrames).toBeGreaterThanOrEqual(0);
      expect(entry.move.activeFrames).toBeGreaterThanOrEqual(0);
      expect(entry.move.recoveryFrames).toBeGreaterThanOrEqual(0);
      expect(entry.move.cooldownFrames).toBeGreaterThanOrEqual(0);
    });
  }

  // --- Cross-cutting roster invariants ---

  it('every aerial id is unique across all four characters', () => {
    const ids = CHARACTER_AERIALS.map((e) => e.move.id);
    const set = new Set(ids);
    expect(set.size).toBe(ids.length);
  });

  it('every character has nair + fair + bair (12 records total)', () => {
    expect(CHARACTER_AERIALS.length).toBe(12);
    const grouped = new Map<string, Set<string>>();
    for (const e of CHARACTER_AERIALS) {
      const character = e.move.id.split('.')[0]!;
      const existing = grouped.get(character) ?? new Set<string>();
      existing.add(e.dir);
      grouped.set(character, existing);
    }
    expect(grouped.size).toBe(4);
    for (const [, dirs] of grouped) {
      expect(dirs).toEqual(new Set(['neutral', 'forward', 'back']));
    }
  });

  it('forward / back aerials use a non-zero hitbox offsetX (extends from body)', () => {
    for (const e of CHARACTER_AERIALS) {
      if (e.dir === 'forward' || e.dir === 'back') {
        expect(e.move.hitbox.offsetX).toBeGreaterThan(0);
      }
    }
  });

  it('neutral aerials use a zero hitbox offsetX (body-centred sphere)', () => {
    for (const e of CHARACTER_AERIALS) {
      if (e.dir === 'neutral') {
        expect(e.move.hitbox.offsetX).toBe(0);
      }
    }
  });

  it('every aerial sends the target up-and-away (knockback angle in (0, 90])', () => {
    for (const e of CHARACTER_AERIALS) {
      const angle = getKnockbackLaunchAngleDegrees(e.move);
      // Up-and-forward / up-and-back aerials should launch into [0, 90]
      // range — never into the ground (negative angle) and never
      // straight back (180°).
      expect(angle).toBeGreaterThan(0);
      expect(angle).toBeLessThanOrEqual(90);
    }
  });

  // AC 60204 Sub-AC 4 — every authored auto-cancel window across the
  // whole roster must be a designated startup OR recovery range; none
  // may overlap the active phase.
  it('every authored auto-cancel window is a designated startup or recovery range', () => {
    for (const e of CHARACTER_AERIALS) {
      const windows = e.move.autoCancelWindows ?? [];
      for (const w of windows) {
        const phase = getAutoCancelWindowPhase(w, e.move);
        expect(
          phase,
          `${e.move.id}: window [${w.startFrame}, ${w.endFrame}) is in ${phase ?? 'active/straddling'}`,
        ).not.toBeNull();
        expect(['startup', 'recovery']).toContain(phase);
      }
    }
  });

  it('every aerial declares at least one startup-side ("early-out") window', () => {
    // Authoring convention: every aerial in the M2 cut declares an
    // early-out window so a fighter who twitch-presses on the way
    // down still gets a clean landing. The recovery-side window is
    // optional (committal moves like Bear's bair omit it).
    for (const e of CHARACTER_AERIALS) {
      const grouped = getAutoCancelWindowsByPhase(e.move);
      expect(
        grouped.startup.length,
        `${e.move.id}: missing startup-side auto-cancel window`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  // --- Per-character archetype sanity (locks the design intent) ---

  it("Cat's nair has the lightest landing lag in the cast", () => {
    const lags = CHARACTER_AERIALS.filter((e) => e.dir === 'neutral').map((e) => ({
      id: e.move.id,
      lag: e.move.landingLagFrames,
    }));
    const cat = lags.find((l) => l.id === 'cat.nair')!;
    for (const l of lags) {
      expect(cat.lag).toBeLessThanOrEqual(l.lag);
    }
  });

  it("Bear's bair has the heaviest landing lag in the cast", () => {
    const allLags = CHARACTER_AERIALS.map((e) => ({
      id: e.move.id,
      lag: e.move.landingLagFrames,
    }));
    const bear = allLags.find((l) => l.id === 'bear.bair')!;
    for (const l of allLags) {
      expect(bear.lag).toBeGreaterThanOrEqual(l.lag);
    }
  });

  it("Bear's bair has the highest damage of any aerial in the cast", () => {
    const damages = CHARACTER_AERIALS.map((e) => ({
      id: e.move.id,
      dmg: e.move.damage,
    }));
    const bear = damages.find((d) => d.id === 'bear.bair')!;
    for (const d of damages) {
      expect(bear.dmg).toBeGreaterThanOrEqual(d.dmg);
    }
  });

  it("Cat's fair has the fastest startup of any aerial in the cast", () => {
    const startups = CHARACTER_AERIALS.map((e) => ({
      id: e.move.id,
      s: e.move.startupFrames,
    }));
    // Cat's nair is the cast-fastest aerial overall (3); fair (4) is
    // the fastest fair specifically. Lock both invariants.
    const catNair = startups.find((s) => s.id === 'cat.nair')!;
    for (const s of startups) {
      expect(catNair.s).toBeLessThanOrEqual(s.s);
    }
    const fairs = startups.filter((s) => s.id.endsWith('.fair'));
    const catFair = fairs.find((s) => s.id === 'cat.fair')!;
    for (const s of fairs) {
      expect(catFair.s).toBeLessThanOrEqual(s.s);
    }
  });
});

// ---------------------------------------------------------------------------
// Determinism — schema helpers are pure
// ---------------------------------------------------------------------------

describe('aerialSchema determinism', () => {
  it('isAutoCancelFrame is a pure function of (move, frame)', () => {
    for (let f = 0; f < 50; f++) {
      const a = isAutoCancelFrame(WOLF_NAIR_AERIAL, f);
      const b = isAutoCancelFrame(WOLF_NAIR_AERIAL, f);
      expect(a).toBe(b);
    }
  });

  it('getKnockbackLaunchAngleDegrees is deterministic across repeated calls', () => {
    for (const e of CHARACTER_AERIALS) {
      const a = getKnockbackLaunchAngleDegrees(e.move);
      const b = getKnockbackLaunchAngleDegrees(e.move);
      expect(a).toBe(b);
    }
  });

  it('getLandingLagFrames is a pure function', () => {
    for (let f = 0; f < 50; f++) {
      const a = getLandingLagFrames(WOLF_BAIR, f);
      const b = getLandingLagFrames(WOLF_BAIR, f);
      expect(a).toBe(b);
    }
  });
});
