/**
 * AC 30104 Sub-AC 4 — replay integrity checksum tests.
 *
 * Coverage map:
 *
 *   • {@link computeReplayChecksum}
 *       - Determinism: identical inputs produce identical outputs across
 *         repeated calls.
 *       - Output shape: 16 lowercase hex chars (CHECKSUM_HEX_LENGTH).
 *       - Avalanche: a single-byte change anywhere in the payload
 *         changes both halves of the 64-bit hash.
 *       - UTF-8 handling: multi-byte characters (é, 漢, 🎮, lone
 *         surrogate fallback) hash deterministically.
 *       - Empty input: stable, well-defined "empty" digest.
 *       - Type guard: rejects non-string input loudly.
 *
 *   • {@link verifyReplayChecksum}
 *       - Returns true on a correct checksum.
 *       - Throws ReplayIntegrityError(kind=mismatch) on a wrong checksum,
 *         carrying expected/actual/algorithm fields.
 *       - Throws ReplayIntegrityError(kind=malformed) on a structurally
 *         invalid checksum string.
 *       - Throws ReplayIntegrityError(kind=unsupported) on an unknown
 *         algorithm identifier.
 *
 *   • {@link isReplayChecksumValid}
 *       - Boolean-form mirror of verify; never throws on integrity failure.
 *
 *   • {@link isWellFormedChecksum}
 *       - Accepts a 16-char lowercase hex string, rejects every other shape.
 *
 *   • Constants
 *       - CHECKSUM_ALGORITHM is the published identifier.
 *       - CHECKSUM_HEX_LENGTH is 16.
 */

import { describe, it, expect } from 'vitest';
import {
  CHECKSUM_ALGORITHM,
  CHECKSUM_HEX_LENGTH,
  ReplayIntegrityError,
  computeReplayChecksum,
  isReplayChecksumValid,
  isWellFormedChecksum,
  verifyReplayChecksum,
} from './replayChecksum';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('replayChecksum — constants', () => {
  it('exposes the algorithm identifier as a stable string literal', () => {
    expect(CHECKSUM_ALGORITHM).toBe('fnv1a-64-v1');
  });

  it('exposes a 16-char hex length', () => {
    expect(CHECKSUM_HEX_LENGTH).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// computeReplayChecksum
// ---------------------------------------------------------------------------

describe('computeReplayChecksum — output shape', () => {
  it('returns a 16-character lowercase hex string', () => {
    const c = computeReplayChecksum('{"format":"x"}');
    expect(c).toHaveLength(CHECKSUM_HEX_LENGTH);
    expect(c).toMatch(/^[0-9a-f]{16}$/);
  });

  it('returns a stable digest for the empty string', () => {
    // Empty input → the two FNV-1a passes never get a byte fed, so the
    // result is the offset-basis pair encoded as hex. We pin the value
    // here so a future refactor that accidentally changes the offset
    // basis fails this test rather than silently invalidating every
    // stored replay.
    const empty = computeReplayChecksum('');
    expect(empty).toBe('811c9dc59dc5811c');
  });
});

describe('computeReplayChecksum — determinism', () => {
  it('produces the same output for repeated calls on the same input', () => {
    const input = '{"hello":"world","frame":42}';
    const a = computeReplayChecksum(input);
    const b = computeReplayChecksum(input);
    expect(a).toBe(b);
  });

  it('is independent of caller state (no closures, no globals)', () => {
    const input = JSON.stringify({ a: 1, b: 2, nested: { x: [1, 2, 3] } });
    const first = computeReplayChecksum(input);
    // Force a few side-effecting computations between calls.
    for (let i = 0; i < 1000; i += 1) Math.imul(i, 0x9e3779b9);
    const second = computeReplayChecksum(input);
    expect(first).toBe(second);
  });

  it('produces different outputs for inputs that differ by one character', () => {
    const a = computeReplayChecksum('frame:0');
    const b = computeReplayChecksum('frame:1');
    expect(a).not.toBe(b);
  });
});

describe('computeReplayChecksum — avalanche', () => {
  it('flips bits in both halves when one byte changes', () => {
    // The two passes use different offset bases and primes, so a single
    // byte flip should perturb both 32-bit halves — not just one.
    const a = computeReplayChecksum('AAAA');
    const b = computeReplayChecksum('AAAB');
    expect(a).not.toBe(b);
    expect(a.slice(0, 8)).not.toBe(b.slice(0, 8));
    expect(a.slice(8, 16)).not.toBe(b.slice(8, 16));
  });

  it('produces unique outputs across a small sample space', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 256; i += 1) {
      // Each input has a different one-character prefix + same body — a
      // realistic "frames differ by one keystroke" scenario.
      seen.add(computeReplayChecksum(String.fromCharCode(i) + 'payload'));
    }
    // FNV-1a's collision rate on 256 distinct inputs is far below 1, so
    // we should observe 256 distinct digests every run.
    expect(seen.size).toBe(256);
  });
});

describe('computeReplayChecksum — UTF-8 handling', () => {
  it('handles 1-byte ASCII', () => {
    const c = computeReplayChecksum('hello world');
    expect(c).toMatch(/^[0-9a-f]{16}$/);
  });

  it('handles 2-byte code points (Latin-1 supplement)', () => {
    // 'é' is U+00E9 → UTF-8 bytes 0xC3 0xA9. Two-byte path.
    const a = computeReplayChecksum('é');
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    // Different from the single-byte 'e' encoding.
    expect(a).not.toBe(computeReplayChecksum('e'));
  });

  it('handles 3-byte code points (BMP)', () => {
    // '漢' is U+6F22 → three UTF-8 bytes.
    const a = computeReplayChecksum('漢字');
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it('handles 4-byte code points (astral / emoji)', () => {
    // '🎮' is U+1F3AE → four UTF-8 bytes, encoded in JS as a surrogate pair.
    const a = computeReplayChecksum('🎮');
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    // Different from the BMP characters that would round-trip incorrectly
    // if the iterator stepped per UTF-16 code unit instead of per code point.
    expect(a).not.toBe(computeReplayChecksum('?'));
  });

  it('treats a lone high surrogate as the Unicode replacement char', () => {
    // The hasher must not throw or produce different outputs depending on
    // platform when fed a malformed string. A lone surrogate is folded to
    // U+FFFD (per WHATWG TextEncoder spec).
    const lone = '\uD800';
    const replacement = '�';
    expect(computeReplayChecksum(lone)).toBe(computeReplayChecksum(replacement));
  });

  it('produces the same output as feeding the string in code-point order', () => {
    // The hasher iterates the string once; this test verifies that
    // splitting the same string into characters and re-joining yields
    // the same digest (i.e. there is no per-call accumulator residue).
    const s = 'frame:42 attack:true 漢字 🎮';
    const direct = computeReplayChecksum(s);
    const rejoined = computeReplayChecksum([...s].join(''));
    expect(rejoined).toBe(direct);
  });
});

describe('computeReplayChecksum — type guard', () => {
  it('throws TypeError on a non-string input', () => {
    expect(() => computeReplayChecksum(null as unknown as string)).toThrow(TypeError);
    expect(() => computeReplayChecksum(123 as unknown as string)).toThrow(TypeError);
    expect(() => computeReplayChecksum({} as unknown as string)).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// verifyReplayChecksum
// ---------------------------------------------------------------------------

describe('verifyReplayChecksum — happy path', () => {
  it('returns true when the checksum matches', () => {
    const payload = '{"frame":0,"input":"left"}';
    const expected = computeReplayChecksum(payload);
    expect(verifyReplayChecksum(payload, expected)).toBe(true);
  });

  it('accepts an explicit algorithm parameter when it equals the build default', () => {
    const payload = '{"x":1}';
    const expected = computeReplayChecksum(payload);
    expect(verifyReplayChecksum(payload, expected, CHECKSUM_ALGORITHM)).toBe(true);
  });
});

describe('verifyReplayChecksum — mismatch', () => {
  it('throws ReplayIntegrityError with kind=mismatch when payload was tampered with', () => {
    const original = '{"frame":0,"input":"left"}';
    const tampered = '{"frame":1,"input":"left"}';
    const expected = computeReplayChecksum(original);
    expect(() => verifyReplayChecksum(tampered, expected)).toThrow(ReplayIntegrityError);
    try {
      verifyReplayChecksum(tampered, expected);
    } catch (err) {
      expect(err).toBeInstanceOf(ReplayIntegrityError);
      const e = err as ReplayIntegrityError;
      expect(e.kind).toBe('mismatch');
      expect(e.expected).toBe(expected);
      expect(e.actual).toBe(computeReplayChecksum(tampered));
      expect(e.algorithm).toBe(CHECKSUM_ALGORITHM);
      expect(e.message).toMatch(/integrity check failed/i);
      expect(e.message).toMatch(/corrupted/i);
    }
  });

  it('reports a mismatch even on a single-byte tamper', () => {
    const original = 'a';
    const tampered = 'b';
    const expected = computeReplayChecksum(original);
    expect(() => verifyReplayChecksum(tampered, expected)).toThrow(/checksum/i);
  });
});

describe('verifyReplayChecksum — malformed checksum string', () => {
  it('rejects a checksum that is too short', () => {
    expect(() => verifyReplayChecksum('any', 'abc')).toThrow(ReplayIntegrityError);
    try {
      verifyReplayChecksum('any', 'abc');
    } catch (err) {
      const e = err as ReplayIntegrityError;
      expect(e.kind).toBe('malformed');
      expect(e.expected).toBe('abc');
    }
  });

  it('rejects a checksum that is too long', () => {
    const tooLong = '0'.repeat(CHECKSUM_HEX_LENGTH + 1);
    expect(() => verifyReplayChecksum('any', tooLong)).toThrow(ReplayIntegrityError);
  });

  it('rejects a checksum containing non-hex characters', () => {
    const bogus = 'GHIJKLMNOPQRSTUV'; // 16 chars but not hex
    expect(() => verifyReplayChecksum('any', bogus)).toThrow(/lowercase hex/);
  });

  it('rejects a checksum containing uppercase hex (canonical form is lowercase)', () => {
    // The hasher emits lowercase; verify rejects uppercase to avoid the
    // ambiguity of two possible canonicalisations.
    const upper = '811C9DC59DC5811C';
    expect(() => verifyReplayChecksum('', upper)).toThrow(ReplayIntegrityError);
  });

  it('rejects a non-string checksum', () => {
    expect(() =>
      verifyReplayChecksum('any', 123 as unknown as string),
    ).toThrow(ReplayIntegrityError);
  });
});

describe('verifyReplayChecksum — unsupported algorithm', () => {
  it('throws kind=unsupported for an unknown algorithm string', () => {
    const payload = '{}';
    const checksum = computeReplayChecksum(payload);
    expect(() =>
      verifyReplayChecksum(payload, checksum, 'sha256-v1'),
    ).toThrow(ReplayIntegrityError);
    try {
      verifyReplayChecksum(payload, checksum, 'sha256-v1');
    } catch (err) {
      const e = err as ReplayIntegrityError;
      expect(e.kind).toBe('unsupported');
      expect(e.algorithm).toBe('sha256-v1');
    }
  });

  it('throws kind=unsupported when algorithm is empty', () => {
    expect(() => verifyReplayChecksum('x', computeReplayChecksum('x'), '')).toThrow(
      /unsupported algorithm/,
    );
  });
});

// ---------------------------------------------------------------------------
// isReplayChecksumValid (non-throwing variant)
// ---------------------------------------------------------------------------

describe('isReplayChecksumValid', () => {
  it('returns true on a correct checksum', () => {
    const p = '{"a":1}';
    expect(isReplayChecksumValid(p, computeReplayChecksum(p))).toBe(true);
  });

  it('returns false on a mismatch (no throw)', () => {
    const p = '{"a":1}';
    const wrong = computeReplayChecksum('{"a":2}');
    expect(isReplayChecksumValid(p, wrong)).toBe(false);
  });

  it('returns false on a malformed checksum (no throw)', () => {
    expect(isReplayChecksumValid('x', 'not-hex')).toBe(false);
  });

  it('returns false on an unsupported algorithm (no throw)', () => {
    const p = 'x';
    expect(isReplayChecksumValid(p, computeReplayChecksum(p), 'crc32-v1')).toBe(
      false,
    );
  });

  it('re-throws non-integrity errors', () => {
    // A TypeError from a non-string payload escapes — only
    // ReplayIntegrityError is swallowed.
    expect(() =>
      isReplayChecksumValid(null as unknown as string, '0'.repeat(16)),
    ).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// isWellFormedChecksum
// ---------------------------------------------------------------------------

describe('isWellFormedChecksum', () => {
  it('accepts the digest of an empty string', () => {
    expect(isWellFormedChecksum(computeReplayChecksum(''))).toBe(true);
  });

  it('accepts every digest the hasher emits', () => {
    for (let i = 0; i < 32; i += 1) {
      expect(isWellFormedChecksum(computeReplayChecksum(String(i)))).toBe(true);
    }
  });

  it('rejects strings of the wrong length', () => {
    expect(isWellFormedChecksum('')).toBe(false);
    expect(isWellFormedChecksum('0'.repeat(15))).toBe(false);
    expect(isWellFormedChecksum('0'.repeat(17))).toBe(false);
  });

  it('rejects non-hex characters', () => {
    expect(isWellFormedChecksum('GGGGGGGGGGGGGGGG')).toBe(false);
    expect(isWellFormedChecksum('0123456789abcdeg')).toBe(false);
  });

  it('rejects uppercase hex', () => {
    expect(isWellFormedChecksum('ABCDEF0123456789')).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(isWellFormedChecksum(undefined)).toBe(false);
    expect(isWellFormedChecksum(null)).toBe(false);
    expect(isWellFormedChecksum(0xdeadbeef)).toBe(false);
    expect(isWellFormedChecksum({})).toBe(false);
    expect(isWellFormedChecksum(['a'])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ReplayIntegrityError
// ---------------------------------------------------------------------------

describe('ReplayIntegrityError', () => {
  it('is an Error subclass with a stable name', () => {
    const e = new ReplayIntegrityError('mismatch', 'oops');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(ReplayIntegrityError);
    expect(e.name).toBe('ReplayIntegrityError');
  });

  it('records the discriminator and the diagnostic fields', () => {
    const e = new ReplayIntegrityError('mismatch', 'bad', {
      expected: '0123456789abcdef',
      actual: 'fedcba9876543210',
      algorithm: 'fnv1a-64-v1',
    });
    expect(e.kind).toBe('mismatch');
    expect(e.expected).toBe('0123456789abcdef');
    expect(e.actual).toBe('fedcba9876543210');
    expect(e.algorithm).toBe('fnv1a-64-v1');
  });

  it('defaults missing diagnostic fields to null', () => {
    const e = new ReplayIntegrityError('malformed', 'shape');
    expect(e.expected).toBeNull();
    expect(e.actual).toBeNull();
    expect(e.algorithm).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: realistic replay-payload smoke test
// ---------------------------------------------------------------------------

describe('replayChecksum — realistic payload smoke', () => {
  /**
   * Mimic a small replay JSON to make sure the hasher handles the
   * structure we'll see in production (nested objects, arrays of numbers
   * and booleans, ISO date strings) without surprises.
   */
  const sample = JSON.stringify({
    format: 'platform-fighter-replay',
    version: 1,
    metadata: {
      recordedAt: '2026-04-30T12:00:00.000Z',
      durationFrames: 2,
      fixedTimestepMs: 1000 / 60,
      playerCount: 2,
      engineVersion: '1.2.3',
      notes: 'exhibition',
    },
    matchConfig: {
      mode: 'stocks',
      stockCount: 3,
      stageId: 'flat',
      players: [
        { index: 1, characterId: 'wolf', paletteIndex: 0, inputType: 'keyboard_p1' },
        { index: 2, characterId: 'cat', paletteIndex: 1, inputType: 'keyboard_p2' },
      ],
      rngSeed: 0xc0ffee,
    },
    rngSeed: 0xc0ffee,
    inputTimeline: {
      playerCount: 2,
      entries: [
        { frame: 0, inputs: [{ moveX: 1, jump: false, attack: false, dropThrough: false }, { moveX: -1, jump: false, attack: false, dropThrough: false }] },
        { frame: 1, inputs: [{ moveX: 0, jump: true, attack: false, dropThrough: false }, { moveX: 0, jump: false, attack: true, dropThrough: false }] },
      ],
    },
  });

  it('verifies a realistic replay JSON round-trip', () => {
    const checksum = computeReplayChecksum(sample);
    expect(verifyReplayChecksum(sample, checksum)).toBe(true);
  });

  it('rejects a single-byte tamper inside the input timeline', () => {
    const checksum = computeReplayChecksum(sample);
    // Flip a single boolean (`false` → `true`) deep inside the payload —
    // this is the realistic "stored replay was corrupted" scenario.
    const tampered = sample.replace('"jump":false', '"jump":true');
    expect(tampered).not.toBe(sample);
    expect(() => verifyReplayChecksum(tampered, checksum)).toThrow(ReplayIntegrityError);
  });

  it('rejects a tamper that adds whitespace (canonical-form sensitivity)', () => {
    const checksum = computeReplayChecksum(sample);
    const tampered = sample.replace('{"frame":0', '{ "frame":0');
    expect(() => verifyReplayChecksum(tampered, checksum)).toThrow(ReplayIntegrityError);
  });
});
