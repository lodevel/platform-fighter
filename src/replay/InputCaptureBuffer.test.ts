import { describe, it, expect } from 'vitest';
import type { CharacterInput } from '../characters/Character';
import {
  InputCaptureBuffer,
  NEUTRAL_INPUT,
  type RecordedCharacterInput,
} from './InputCaptureBuffer';

/**
 * AC 30002 Sub-AC 2: per-frame input capture buffer.
 *
 * The buffer is the deterministic core of the M4 hybrid replay
 * system. These tests lock down:
 *
 *   1. Construction — refuses out-of-range player counts and
 *      non-integer values; defaults to empty.
 *   2. Capture — accepts a per-player array of CharacterInput keyed
 *      by frame, normalises optional fields to a closed shape.
 *   3. Frame validation — rejects negative / non-integer / non-
 *      monotonic frames so the log can't be silently corrupted.
 *   4. Player-count validation — rejects mismatched-length input
 *      arrays.
 *   5. Defensive copy — mutating the caller's CharacterInput after
 *      capture must not affect the recorded entry.
 *   6. Per-frame and per-player lookup — `getFrame` / `getPlayerInput`
 *      return the right snapshot or `null` for unknown frames.
 *   7. Iteration — `getEntries` yields every captured frame in
 *      capture order.
 *   8. Reset — clears the log and resets the monotonic invariant.
 *   9. Determinism — replaying the same capture log yields identical
 *      entries (same frame numbers, same input bits).
 */

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('InputCaptureBuffer — construction', () => {
  it('starts empty', () => {
    const buf = new InputCaptureBuffer({ playerCount: 2 });
    expect(buf.size()).toBe(0);
    expect(buf.isEmpty()).toBe(true);
    expect(buf.getLastFrame()).toBeNull();
    expect(buf.getEntries()).toEqual([]);
  });

  it('exposes the configured player count', () => {
    expect(new InputCaptureBuffer({ playerCount: 1 }).getPlayerCount()).toBe(1);
    expect(new InputCaptureBuffer({ playerCount: 4 }).getPlayerCount()).toBe(4);
  });

  it('rejects playerCount below 1', () => {
    expect(() => new InputCaptureBuffer({ playerCount: 0 })).toThrow(
      /playerCount/i,
    );
  });

  it('rejects playerCount above 4 (Seed local-multiplayer cap)', () => {
    expect(() => new InputCaptureBuffer({ playerCount: 5 })).toThrow(
      /playerCount/i,
    );
  });

  it('rejects non-integer playerCount', () => {
    expect(() => new InputCaptureBuffer({ playerCount: 2.5 })).toThrow(
      /integer/i,
    );
    expect(() =>
      new InputCaptureBuffer({ playerCount: Number.NaN }),
    ).toThrow(/integer/i);
  });
});

// ---------------------------------------------------------------------------
// Neutral input fixture
// ---------------------------------------------------------------------------

describe('InputCaptureBuffer — NEUTRAL_INPUT', () => {
  it('has every field at its zero / false value', () => {
    expect(NEUTRAL_INPUT).toEqual({
      moveX: 0,
      jump: false,
      attack: false,
      dropThrough: false,
    });
  });

  it('is frozen so callers cannot mutate the shared instance', () => {
    expect(Object.isFrozen(NEUTRAL_INPUT)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

describe('InputCaptureBuffer — captureFrame', () => {
  it('records a single frame with both players', () => {
    const buf = new InputCaptureBuffer({ playerCount: 2 });
    const p1: CharacterInput = { moveX: 1, jump: true, attack: false };
    const p2: CharacterInput = { moveX: -1, jump: false, attack: true };

    buf.captureFrame(0, [p1, p2]);

    expect(buf.size()).toBe(1);
    expect(buf.isEmpty()).toBe(false);
    expect(buf.getLastFrame()).toBe(0);

    const entry = buf.getFrame(0);
    expect(entry).not.toBeNull();
    expect(entry!.frame).toBe(0);
    expect(entry!.inputs).toHaveLength(2);
    expect(entry!.inputs[0]).toEqual({
      moveX: 1,
      jump: true,
      attack: false,
      dropThrough: false,
    });
    expect(entry!.inputs[1]).toEqual({
      moveX: -1,
      jump: false,
      attack: true,
      dropThrough: false,
    });
  });

  it('normalises optional fields to deterministic defaults', () => {
    const buf = new InputCaptureBuffer({ playerCount: 1 });
    // No `attack`, no `dropThrough` — the normalised entry must be a
    // closed shape with both flags as `false`.
    buf.captureFrame(0, [{ moveX: 0, jump: false }]);
    const entry = buf.getFrame(0)!;
    expect(entry.inputs[0]).toEqual({
      moveX: 0,
      jump: false,
      attack: false,
      dropThrough: false,
    });
  });

  it('coerces undefined slot inputs to NEUTRAL_INPUT', () => {
    const buf = new InputCaptureBuffer({ playerCount: 2 });
    buf.captureFrame(0, [
      { moveX: 1, jump: true, attack: true },
      undefined,
    ]);
    const entry = buf.getFrame(0)!;
    expect(entry.inputs[1]).toEqual(NEUTRAL_INPUT);
  });

  it('clamps moveX into [-1, 1]', () => {
    const buf = new InputCaptureBuffer({ playerCount: 1 });
    buf.captureFrame(0, [{ moveX: 5, jump: false }]);
    buf.captureFrame(1, [{ moveX: -3, jump: false }]);
    expect(buf.getFrame(0)!.inputs[0]!.moveX).toBe(1);
    expect(buf.getFrame(1)!.inputs[0]!.moveX).toBe(-1);
  });

  it('treats non-finite moveX as neutral', () => {
    const buf = new InputCaptureBuffer({ playerCount: 1 });
    buf.captureFrame(0, [{ moveX: Number.NaN, jump: true }]);
    buf.captureFrame(1, [{ moveX: Number.POSITIVE_INFINITY, jump: false }]);
    expect(buf.getFrame(0)!.inputs[0]!.moveX).toBe(0);
    expect(buf.getFrame(1)!.inputs[0]!.moveX).toBe(0);
  });

  it('stores entries keyed by frame number', () => {
    const buf = new InputCaptureBuffer({ playerCount: 1 });
    buf.captureFrame(10, [{ moveX: 1, jump: false }]);
    buf.captureFrame(11, [{ moveX: -1, jump: true }]);
    buf.captureFrame(20, [{ moveX: 0, jump: false }]);

    expect(buf.getFrame(10)!.inputs[0]!.moveX).toBe(1);
    expect(buf.getFrame(11)!.inputs[0]!.jump).toBe(true);
    expect(buf.getFrame(20)!.inputs[0]!.moveX).toBe(0);
    // Unknown frames return null — they were never captured.
    expect(buf.getFrame(0)).toBeNull();
    expect(buf.getFrame(15)).toBeNull();
    expect(buf.getFrame(99)).toBeNull();
  });

  it('captures all 4 players when configured for a 4P FFA', () => {
    const buf = new InputCaptureBuffer({ playerCount: 4 });
    buf.captureFrame(0, [
      { moveX: 1, jump: false },
      { moveX: 0, jump: true, attack: true },
      { moveX: -1, jump: false, dropThrough: true },
      undefined,
    ]);
    const entry = buf.getFrame(0)!;
    expect(entry.inputs).toHaveLength(4);
    expect(entry.inputs[0]!.moveX).toBe(1);
    expect(entry.inputs[1]!.attack).toBe(true);
    expect(entry.inputs[2]!.dropThrough).toBe(true);
    expect(entry.inputs[3]).toEqual(NEUTRAL_INPUT);
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('InputCaptureBuffer — frame validation', () => {
  it('rejects negative frames', () => {
    const buf = new InputCaptureBuffer({ playerCount: 1 });
    expect(() => buf.captureFrame(-1, [{ moveX: 0, jump: false }])).toThrow(
      /non-negative/i,
    );
  });

  it('rejects non-integer frames', () => {
    const buf = new InputCaptureBuffer({ playerCount: 1 });
    expect(() => buf.captureFrame(1.5, [{ moveX: 0, jump: false }])).toThrow(
      /integer/i,
    );
    expect(() =>
      buf.captureFrame(Number.NaN, [{ moveX: 0, jump: false }]),
    ).toThrow(/integer/i);
  });

  it('rejects non-monotonic frames (duplicate)', () => {
    const buf = new InputCaptureBuffer({ playerCount: 1 });
    buf.captureFrame(5, [{ moveX: 0, jump: false }]);
    expect(() => buf.captureFrame(5, [{ moveX: 1, jump: false }])).toThrow(
      /monotonic/i,
    );
  });

  it('rejects non-monotonic frames (rewinds)', () => {
    const buf = new InputCaptureBuffer({ playerCount: 1 });
    buf.captureFrame(10, [{ moveX: 0, jump: false }]);
    expect(() => buf.captureFrame(9, [{ moveX: 1, jump: false }])).toThrow(
      /monotonic/i,
    );
  });

  it('allows non-contiguous monotonic frames (e.g. paused or skipped frames)', () => {
    // The buffer doesn't require frame N+1 immediately after N — it
    // only requires monotonicity. The replay system can run-length
    // encode "no input change for 8 frames" later.
    const buf = new InputCaptureBuffer({ playerCount: 1 });
    buf.captureFrame(0, [{ moveX: 0, jump: false }]);
    buf.captureFrame(50, [{ moveX: 1, jump: false }]);
    buf.captureFrame(300, [{ moveX: -1, jump: true }]);
    expect(buf.size()).toBe(3);
    expect(buf.getLastFrame()).toBe(300);
  });
});

describe('InputCaptureBuffer — player-count validation', () => {
  it('rejects an inputs array shorter than playerCount', () => {
    const buf = new InputCaptureBuffer({ playerCount: 2 });
    expect(() =>
      buf.captureFrame(0, [{ moveX: 0, jump: false }]),
    ).toThrow(/expected 2/i);
  });

  it('rejects an inputs array longer than playerCount', () => {
    const buf = new InputCaptureBuffer({ playerCount: 2 });
    expect(() =>
      buf.captureFrame(0, [
        { moveX: 0, jump: false },
        { moveX: 1, jump: false },
        { moveX: -1, jump: true },
      ]),
    ).toThrow(/expected 2/i);
  });
});

// ---------------------------------------------------------------------------
// Defensive copy
// ---------------------------------------------------------------------------

describe('InputCaptureBuffer — defensive copy', () => {
  it('mutating the original CharacterInput does not affect the recorded entry', () => {
    const buf = new InputCaptureBuffer({ playerCount: 1 });
    // Use a mutable record to simulate a caller reusing its sample buffer.
    const live = { moveX: 1, jump: true, attack: true, dropThrough: false };
    buf.captureFrame(0, [live]);

    // Mutate every field after capture. The recorded entry must not change.
    live.moveX = -1;
    live.jump = false;
    live.attack = false;
    live.dropThrough = true;

    const entry = buf.getFrame(0)!;
    expect(entry.inputs[0]).toEqual({
      moveX: 1,
      jump: true,
      attack: true,
      dropThrough: false,
    });
  });

  it('recorded entries are frozen', () => {
    const buf = new InputCaptureBuffer({ playerCount: 1 });
    buf.captureFrame(0, [{ moveX: 1, jump: true }]);
    const entry = buf.getFrame(0)!;
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry.inputs)).toBe(true);
    expect(Object.isFrozen(entry.inputs[0])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

describe('InputCaptureBuffer — getPlayerInput', () => {
  it('returns the right player slot for the right frame', () => {
    const buf = new InputCaptureBuffer({ playerCount: 2 });
    buf.captureFrame(0, [
      { moveX: 1, jump: false },
      { moveX: -1, jump: true },
    ]);
    buf.captureFrame(1, [
      { moveX: 0, jump: true, attack: true },
      { moveX: 0, jump: false },
    ]);

    expect(buf.getPlayerInput(0, 0)!.moveX).toBe(1);
    expect(buf.getPlayerInput(0, 1)!.jump).toBe(true);
    expect(buf.getPlayerInput(1, 0)!.attack).toBe(true);
    expect(buf.getPlayerInput(1, 1)!.moveX).toBe(0);
  });

  it('returns null for an out-of-range player index', () => {
    const buf = new InputCaptureBuffer({ playerCount: 2 });
    buf.captureFrame(0, [
      { moveX: 1, jump: false },
      { moveX: 0, jump: false },
    ]);
    // Slot 2 doesn't exist in a 2P match.
    // Cast through unknown to bypass the PlayerIndex literal-type
    // guard for this specifically-bad-input test.
    expect(buf.getPlayerInput(0, 2 as unknown as 0 | 1)).toBeNull();
  });

  it('returns null for unknown frames', () => {
    const buf = new InputCaptureBuffer({ playerCount: 1 });
    buf.captureFrame(0, [{ moveX: 0, jump: false }]);
    expect(buf.getPlayerInput(99, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Iteration
// ---------------------------------------------------------------------------

describe('InputCaptureBuffer — getEntries', () => {
  it('yields every captured frame in capture order', () => {
    const buf = new InputCaptureBuffer({ playerCount: 1 });
    for (let f = 0; f < 5; f += 1) {
      buf.captureFrame(f, [{ moveX: f - 2, jump: f % 2 === 0 }]);
    }
    const entries = buf.getEntries();
    expect(entries).toHaveLength(5);
    for (let f = 0; f < 5; f += 1) {
      expect(entries[f]!.frame).toBe(f);
      expect(entries[f]!.inputs[0]!.moveX).toBe(
        // moveX was -2, -1, 0, 1, 2 → clamped to -1, -1, 0, 1, 1.
        Math.max(-1, Math.min(1, f - 2)),
      );
      expect(entries[f]!.inputs[0]!.jump).toBe(f % 2 === 0);
    }
  });
});

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

describe('InputCaptureBuffer — reset', () => {
  it('clears the log and the monotonic invariant', () => {
    const buf = new InputCaptureBuffer({ playerCount: 1 });
    buf.captureFrame(10, [{ moveX: 1, jump: false }]);
    buf.captureFrame(11, [{ moveX: 0, jump: false }]);
    expect(buf.size()).toBe(2);

    buf.reset();
    expect(buf.size()).toBe(0);
    expect(buf.isEmpty()).toBe(true);
    expect(buf.getLastFrame()).toBeNull();
    // Frame 0 capture must succeed after reset — the monotonic
    // invariant has been cleared along with the log.
    expect(() => buf.captureFrame(0, [{ moveX: 0, jump: false }])).not.toThrow();
    expect(buf.getLastFrame()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('InputCaptureBuffer — determinism', () => {
  it('two buffers fed the same sequence produce identical entries', () => {
    const sequence: Array<[number, CharacterInput, CharacterInput]> = [
      [0, { moveX: 0, jump: false }, { moveX: 0, jump: false }],
      [1, { moveX: 1, jump: true }, { moveX: -1, jump: false }],
      [2, { moveX: 1, jump: false, attack: true }, { moveX: 0, jump: false }],
      [3, { moveX: 0, jump: false, dropThrough: true }, { moveX: 1, jump: true }],
    ];

    const a = new InputCaptureBuffer({ playerCount: 2 });
    const b = new InputCaptureBuffer({ playerCount: 2 });
    for (const [frame, p1, p2] of sequence) {
      a.captureFrame(frame, [p1, p2]);
      b.captureFrame(frame, [p1, p2]);
    }

    // Same shape, same fields, same values — the replay system
    // depends on this byte-for-byte equality.
    const aEntries = a.getEntries();
    const bEntries = b.getEntries();
    expect(aEntries.length).toBe(bEntries.length);
    for (let i = 0; i < aEntries.length; i += 1) {
      const aEntry = aEntries[i]!;
      const bEntry = bEntries[i]!;
      expect(aEntry.frame).toBe(bEntry.frame);
      // Compare inputs as plain objects so frozen-vs-frozen identity
      // doesn't confuse the matcher.
      const aInputs = aEntry.inputs.map((r) => ({ ...r }));
      const bInputs = bEntry.inputs.map((r) => ({ ...r }));
      expect(aInputs).toEqual(bInputs);
    }
  });

  it('round-trip through getFrame yields the exact same RecordedCharacterInput', () => {
    const buf = new InputCaptureBuffer({ playerCount: 1 });
    const expected: RecordedCharacterInput = {
      moveX: 1,
      jump: true,
      attack: true,
      dropThrough: true,
    };
    buf.captureFrame(0, [expected]);
    expect({ ...buf.getFrame(0)!.inputs[0]! }).toEqual(expected);
  });
});
