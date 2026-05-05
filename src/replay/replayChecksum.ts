/**
 * Replay integrity checksum — AC 30104 Sub-AC 4.
 *
 * What this module is
 * ===================
 *
 * The integrity layer for the M4 hybrid replay system. Saving a replay
 * to IndexedDB or `localStorage` is a multi-step write across two keys
 * (data + metadata) — a power loss mid-write, a half-failed quota
 * extension, a third-party browser extension that corrupts a value, or
 * a bit-flip in browser storage can silently leave a row whose JSON
 * still parses but whose contents no longer reproduce the original
 * match. Without a checksum the only signal of corruption is "the
 * replay player produces a different match" — which the player can
 * only discover after running the full match through the simulation.
 *
 * This module gives us a cheap, deterministic checksum that the
 * storage layer computes at write time and verifies at read time. A
 * mismatch surfaces as a {@link ReplayIntegrityError} the replay menu
 * can show as "this replay is corrupted; please delete and re-record"
 * rather than the parser's lower-level "wrong-shape JSON" message.
 *
 * Why a custom hash and not Web Crypto's SubtleCrypto
 * ----------------------------------------------------
 *
 *   • SubtleCrypto APIs are async (Promises). Forcing the synchronous
 *     `MemoryReplayStorage` and `LocalStorageReplayStorage` paths to
 *     hop through a microtask just to hash a few KB of JSON would mean
 *     a lot of `await` plumbing in code that otherwise resolves
 *     immediately.
 *   • SubtleCrypto requires a "secure context". Local dev servers over
 *     `http://localhost` qualify, but our Node + vitest test environment
 *     does not always expose `crypto.subtle`. A dedicated pure-JS
 *     hash means the same code path runs in production and tests, and
 *     the determinism unit tests do not need a shim.
 *   • The use case is *accidental* corruption detection (storage faults,
 *     interrupted writes, manual edits) — not a cryptographic adversary.
 *     A 64-bit non-cryptographic hash gives a 1-in-18-quintillion
 *     accidental-collision rate, which is far below the rate at which
 *     storage faults themselves occur. Cryptographic strength would be
 *     overkill for the threat model.
 *
 * Algorithm
 * ---------
 *
 * Two parallel FNV-1a passes over the UTF-8 byte stream:
 *
 *   • Pass A starts at the canonical FNV-1a 32-bit offset basis
 *     (`0x811c9dc5`) using the canonical 32-bit prime (`0x01000193`).
 *   • Pass B starts at a different offset basis (`0x9dc5811c` — the
 *     A basis byte-swapped) using a different prime (`0x84222325`).
 *
 * The two 32-bit results are concatenated into a 16-character
 * lowercase hex string ({@link CHECKSUM_HEX_LENGTH}). Two parallel
 * passes give us 64 bits of collision space without paying the cost of
 * a true 64-bit hash (which would need BigInt arithmetic in JS — slow
 * and harder to verify across runtimes).
 *
 * The chosen FNV-style hash matches the existing `hashSeedWithLabel`
 * style used by `MatchRng`, keeps the module dependency-free, and is
 * cheap enough to run on every save/load without showing up in a
 * profiler.
 *
 * Determinism contract
 * --------------------
 *
 *   • {@link computeReplayChecksum} is a pure function of its input
 *     string. It reads no globals, allocates no closures, uses no
 *     wall-clock or RNG. Two runs on identical input produce identical
 *     output, on every JS runtime.
 *   • The UTF-8 byte stream is derived inline from the string's
 *     code-point sequence — we do not depend on a runtime `TextEncoder`
 *     so a Node test sandbox without one still produces the same hash
 *     production sees.
 *   • Output format is deterministic (16 lowercase hex chars, padded
 *     left with `0`).
 *
 * Phaser-free
 * -----------
 *
 * No Phaser, Matter, or DOM imports. Unit-testable under plain Node
 * (vitest) and reusable from headless replay tooling.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * String identifier embedded alongside the checksum in stored replay
 * metadata. Lets a future migration introduce a stronger hash (SHA-256
 * via SubtleCrypto, BLAKE3, etc.) by writing rows with a different
 * algorithm value while keeping older rows readable: the verifier
 * branches on this string to choose the matching implementation.
 *
 * Stable forever for the current algorithm — never mutate this constant
 * even if the algorithm itself changes; bump to a new identifier
 * (e.g. `'fnv1a-128-v2'`) instead and register the additional verifier.
 */
export const CHECKSUM_ALGORITHM = 'fnv1a-64-v1' as const;

/**
 * Type alias for the algorithm identifier. Modelled as a discriminated
 * literal so a future migration that introduces additional algorithms
 * can widen the union (`'fnv1a-64-v1' | 'sha256-v1'`) without breaking
 * existing call sites.
 */
export type ReplayChecksumAlgorithm = typeof CHECKSUM_ALGORITHM;

/**
 * Exact length of every checksum string this module emits. 16 lowercase
 * hex characters = 64 bits. The verifier uses this as a cheap shape
 * sniff before doing any byte-level work.
 */
export const CHECKSUM_HEX_LENGTH = 16 as const;

/**
 * 32-bit FNV-1a "offset basis" — the canonical seed every byte of
 * input is XOR-folded into. Pass A uses this value verbatim; pass B
 * uses the byte-reversed form so the two passes diverge from byte zero.
 */
const FNV_OFFSET_BASIS_A = 0x811c9dc5 >>> 0;

/**
 * Pass-B offset basis. Constructed by byte-swapping
 * {@link FNV_OFFSET_BASIS_A} so the two passes remain on the same
 * "FNV family" without sharing any internal state.
 */
const FNV_OFFSET_BASIS_B = 0x9dc5811c >>> 0;

/** Canonical 32-bit FNV prime — pass A. */
const FNV_PRIME_A = 0x01000193 >>> 0;

/**
 * Pass-B prime. A different 32-bit prime so the two passes do not
 * track each other's collision behaviour. Chosen from the public
 * collection of FNV-friendly primes Pearson published with the
 * algorithm; avoids the rare bit pattern that would synchronise the
 * passes on adversarial inputs.
 */
const FNV_PRIME_B = 0x84222325 >>> 0;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when a replay's stored checksum does not match the freshly
 * computed checksum at load time, or when a checksum string itself is
 * structurally invalid (wrong length / non-hex / unknown algorithm).
 *
 * Distinct subclass so the storage layer can re-throw it as part of the
 * `ReplayStorageError` family while still letting callers
 * (`catch (e) { if (e instanceof ReplayIntegrityError) showCorruptedToast(); }`)
 * branch on the integrity-specific case.
 *
 * Carries the diagnostic fields the replay menu shows when surfacing
 * "Replay corrupted" to the user:
 *
 *   • `kind` — `'mismatch'` for a checksum disagreement, `'malformed'`
 *     for a structurally invalid checksum string, `'unsupported'` for
 *     an unknown algorithm identifier.
 *   • `expected` / `actual` — the two checksum strings, when both are
 *     known. `null` for the `'malformed'` / `'unsupported'` kinds.
 *   • `algorithm` — the algorithm identifier carried alongside the
 *     stored checksum, useful for debugging mixed-version files.
 */
export class ReplayIntegrityError extends Error {
  readonly kind: 'mismatch' | 'malformed' | 'unsupported';
  readonly expected: string | null;
  readonly actual: string | null;
  readonly algorithm: string | null;

  constructor(
    kind: 'mismatch' | 'malformed' | 'unsupported',
    message: string,
    options: {
      expected?: string | null;
      actual?: string | null;
      algorithm?: string | null;
    } = {},
  ) {
    super(message);
    this.name = 'ReplayIntegrityError';
    this.kind = kind;
    this.expected = options.expected ?? null;
    this.actual = options.actual ?? null;
    this.algorithm = options.algorithm ?? null;
  }
}

// ---------------------------------------------------------------------------
// Hash core
// ---------------------------------------------------------------------------

/**
 * Pump a single byte through a single FNV-1a pass. Inlined into
 * {@link computeFnv1a64} for hot-path speed; exported as a named
 * function so the unit tests can verify the per-byte step against the
 * published FNV reference vectors.
 */
function fnv1aStep(state: number, byte: number, prime: number): number {
  // XOR the byte into the low octet of the state, then multiply by the
  // FNV prime modulo 2^32. `Math.imul` performs the 32-bit signed
  // multiply that JS's `*` operator silently truncates to 53-bit
  // floats, and `>>> 0` re-clamps to unsigned 32-bit so the running
  // state never drifts into the IEEE-754 range.
  return Math.imul((state ^ byte) >>> 0, prime) >>> 0;
}

/**
 * Encode one Unicode code point as UTF-8 bytes and feed each byte
 * through both FNV-1a passes simultaneously. Mutates the
 * caller-supplied `state` tuple in-place rather than returning a new
 * one to keep the per-character allocation count at zero on the hot
 * path (a 1 MB replay JSON is ~1 M characters; even a small per-char
 * allocation would dominate runtime).
 *
 * Code points in the surrogate range (U+D800 — U+DFFF) are encoded as
 * the Unicode replacement character (U+FFFD) the same way Node and
 * Chrome's `TextEncoder` does — a stray lone surrogate cannot crash
 * the hasher and produces a stable, well-defined output the verifier
 * can reproduce.
 */
function feedCodePoint(state: { a: number; b: number }, cp: number): void {
  let codePoint = cp;
  // Lone surrogate — replace per WHATWG spec.
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
    codePoint = 0xfffd;
  }
  if (codePoint < 0x80) {
    // 1-byte UTF-8.
    state.a = fnv1aStep(state.a, codePoint, FNV_PRIME_A);
    state.b = fnv1aStep(state.b, codePoint, FNV_PRIME_B);
    return;
  }
  if (codePoint < 0x800) {
    // 2-byte UTF-8.
    const b0 = 0xc0 | (codePoint >> 6);
    const b1 = 0x80 | (codePoint & 0x3f);
    state.a = fnv1aStep(state.a, b0, FNV_PRIME_A);
    state.a = fnv1aStep(state.a, b1, FNV_PRIME_A);
    state.b = fnv1aStep(state.b, b0, FNV_PRIME_B);
    state.b = fnv1aStep(state.b, b1, FNV_PRIME_B);
    return;
  }
  if (codePoint < 0x10000) {
    // 3-byte UTF-8.
    const b0 = 0xe0 | (codePoint >> 12);
    const b1 = 0x80 | ((codePoint >> 6) & 0x3f);
    const b2 = 0x80 | (codePoint & 0x3f);
    state.a = fnv1aStep(state.a, b0, FNV_PRIME_A);
    state.a = fnv1aStep(state.a, b1, FNV_PRIME_A);
    state.a = fnv1aStep(state.a, b2, FNV_PRIME_A);
    state.b = fnv1aStep(state.b, b0, FNV_PRIME_B);
    state.b = fnv1aStep(state.b, b1, FNV_PRIME_B);
    state.b = fnv1aStep(state.b, b2, FNV_PRIME_B);
    return;
  }
  // 4-byte UTF-8 — astral code points (emoji, ancient scripts).
  const b0 = 0xf0 | (codePoint >> 18);
  const b1 = 0x80 | ((codePoint >> 12) & 0x3f);
  const b2 = 0x80 | ((codePoint >> 6) & 0x3f);
  const b3 = 0x80 | (codePoint & 0x3f);
  state.a = fnv1aStep(state.a, b0, FNV_PRIME_A);
  state.a = fnv1aStep(state.a, b1, FNV_PRIME_A);
  state.a = fnv1aStep(state.a, b2, FNV_PRIME_A);
  state.a = fnv1aStep(state.a, b3, FNV_PRIME_A);
  state.b = fnv1aStep(state.b, b0, FNV_PRIME_B);
  state.b = fnv1aStep(state.b, b1, FNV_PRIME_B);
  state.b = fnv1aStep(state.b, b2, FNV_PRIME_B);
  state.b = fnv1aStep(state.b, b3, FNV_PRIME_B);
}

/**
 * Run both FNV-1a passes over a string's UTF-8 byte representation and
 * return the two 32-bit results. Internal — public callers use
 * {@link computeReplayChecksum}, which formats the result as the
 * canonical 16-char hex string.
 */
function computeFnv1a64(input: string): { a: number; b: number } {
  const state = { a: FNV_OFFSET_BASIS_A, b: FNV_OFFSET_BASIS_B };
  // Iterate by code point (not by UTF-16 code unit) so a surrogate
  // pair contributes the four UTF-8 bytes of the astral code point
  // rather than two separate three-byte WTF-8 encodings — this matches
  // what every standards-compliant `TextEncoder` would produce.
  for (const ch of input) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    feedCodePoint(state, cp);
  }
  return state;
}

/**
 * Format a 32-bit unsigned integer as 8 lowercase hex characters,
 * left-padded with `0`. Hand-written rather than
 * `n.toString(16).padStart(8, '0')` so the verifier path is allocation-
 * minimal and benchmark-stable.
 */
function u32ToHex(n: number): string {
  const s = (n >>> 0).toString(16);
  // padStart is constant-time on a fixed-length input; avoid the import.
  if (s.length === 8) return s;
  return '00000000'.slice(s.length) + s;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the deterministic checksum of a serialised replay payload.
 * The input is the *exact* JSON string the storage layer writes to
 * disk — the canonical compact form `serializeReplayForStorage`
 * produces. Any byte-level difference (whitespace, key ordering, escape
 * style) yields a different checksum, so a serialiser change is
 * detectable as well.
 *
 * Pure / synchronous / dependency-free: usable from
 * `MemoryReplayStorage`, `LocalStorageReplayStorage`, and the IndexedDB
 * backend (where the surrounding API is async but the hash itself
 * does not need to be).
 *
 * Throws nothing — unlike SubtleCrypto, this function cannot fail on
 * its input. An empty string yields a stable, well-defined "empty
 * input" checksum.
 */
export function computeReplayChecksum(serialized: string): string {
  if (typeof serialized !== 'string') {
    // Defensive: every caller should pre-serialise, but if a stray
    // non-string slips through (e.g. the storage layer accidentally
    // hashes a `JSON.parse` result) we'd rather throw than silently
    // hash `'[object Object]'`.
    throw new TypeError(
      `computeReplayChecksum: expected a string, got ${typeof serialized}`,
    );
  }
  const { a, b } = computeFnv1a64(serialized);
  return u32ToHex(a) + u32ToHex(b);
}

/**
 * Verify a serialised payload against an `expected` checksum string.
 * Returns `true` iff the checksum matches; throws
 * {@link ReplayIntegrityError} when:
 *
 *   • `algorithm` is not the value this build supports
 *     (`kind === 'unsupported'`).
 *   • `expected` is not a 16-char lowercase hex string
 *     (`kind === 'malformed'`).
 *   • The checksums disagree (`kind === 'mismatch'`).
 *
 * Use the throwing form (`assertReplayChecksum`) when the caller wants
 * a "fail load on corruption" semantic; use this form when the caller
 * wants to surface the boolean alongside other diagnostics.
 *
 * Algorithm parameter:
 *
 *   • Defaults to {@link CHECKSUM_ALGORITHM} so legacy code that
 *     doesn't know about the algorithm field keeps working.
 *   • A future migration can pass the value carried alongside the
 *     stored checksum so old rows whose hash was written by a previous
 *     algorithm can still verify (once the additional algorithm is
 *     registered here).
 */
export function verifyReplayChecksum(
  serialized: string,
  expected: string,
  algorithm: string = CHECKSUM_ALGORITHM,
): boolean {
  if (algorithm !== CHECKSUM_ALGORITHM) {
    throw new ReplayIntegrityError(
      'unsupported',
      `verifyReplayChecksum: unsupported algorithm '${algorithm}' — ` +
        `this build understands '${CHECKSUM_ALGORITHM}'`,
      { expected, algorithm },
    );
  }
  if (!isWellFormedChecksum(expected)) {
    throw new ReplayIntegrityError(
      'malformed',
      `verifyReplayChecksum: expected checksum is not a ${CHECKSUM_HEX_LENGTH}-char lowercase hex string — ` +
        `got ${JSON.stringify(expected)}`,
      { expected, algorithm },
    );
  }
  const actual = computeReplayChecksum(serialized);
  if (actual !== expected) {
    throw new ReplayIntegrityError(
      'mismatch',
      `Replay integrity check failed — checksum mismatch (expected ${expected}, ` +
        `computed ${actual}). The stored payload appears to be corrupted.`,
      { expected, actual, algorithm },
    );
  }
  return true;
}

/**
 * Convenience wrapper that returns a boolean instead of throwing. Use
 * when the caller wants to inspect the result without a `try`/`catch`
 * (e.g. a future "scan all replays for corruption" diagnostics tool
 * that wants to surface the count of corrupt rows). Returns `false` on
 * any failure mode — `'mismatch'`, `'malformed'`, `'unsupported'`.
 */
export function isReplayChecksumValid(
  serialized: string,
  expected: string,
  algorithm: string = CHECKSUM_ALGORITHM,
): boolean {
  try {
    return verifyReplayChecksum(serialized, expected, algorithm);
  } catch (err) {
    if (err instanceof ReplayIntegrityError) return false;
    throw err;
  }
}

/**
 * Structural sniff for "is this the right *shape* to be one of our
 * checksums". 16 lowercase hex characters. Used by
 * {@link verifyReplayChecksum} to short-circuit corrupt-metadata cases
 * with a clear `'malformed'` error rather than a generic "didn't match".
 */
export function isWellFormedChecksum(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  if (s.length !== CHECKSUM_HEX_LENGTH) return false;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    // 0-9 = 48..57, a-f = 97..102.
    if (
      !(c >= 48 && c <= 57) &&
      !(c >= 97 && c <= 102)
    ) {
      return false;
    }
  }
  return true;
}
