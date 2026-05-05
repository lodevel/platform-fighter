/**
 * Match-state checksum — AC 30202 Sub-AC 2.
 *
 * What this module is
 * ===================
 *
 * The deterministic *state*-level hash the M4 hybrid replay system uses
 * to detect desync between a recorded match and its played-back
 * simulation. Where {@link ./replayChecksum} hashes the on-disk
 * `.replay.json` *file* for storage-corruption detection, this module
 * hashes the **live in-memory simulation state** at the snapshot pins
 * the recorder lays down every 300 frames (per the Seed's hybrid replay
 * architecture).
 *
 * Two checksums coexist by design:
 *
 *   • {@link computeReplayChecksum} (the "file" checksum) catches
 *     `localStorage` writes torn by a quota extension, IndexedDB rows
 *     truncated by a power loss, manual edits to a saved replay, etc.
 *     It runs over a JSON byte stream.
 *
 *   • {@link computeStateChecksum} (this module — the "state" checksum)
 *     catches divergences that would still produce a bit-identical file
 *     on disk but a different match when re-simulated: an engine bump
 *     that quietly changed a constant, a stray `Math.random()` slip,
 *     a Matter.js patch with different rounding, a hand-edited timeline
 *     where the cursor moves through inputs but the recorded state pins
 *     no longer line up. It runs over an in-memory state snapshot.
 *
 * Where it sits in the replay architecture
 * ----------------------------------------
 *
 *     ┌────────────────────────────────────────────────────────────────┐
 *     │ Recording session                                              │
 *     │                                                                │
 *     │  every fixed step:                                             │
 *     │    InputCaptureBuffer.captureFrame(frame, inputs)              │
 *     │                                                                │
 *     │  every 300th frame (snapshot pin):                             │
 *     │    record = { frame, checksum: computeStateChecksum(snapshot) }│
 *     │    stateChecksums.push(record)                                 │
 *     │                                                                │
 *     │  on save:                                                      │
 *     │    serializeReplay({ ..., stateChecksums })                    │
 *     └────────────────────────────────────────────────────────────────┘
 *                                  │
 *                                  ▼
 *     ┌────────────────────────────────────────────────────────────────┐
 *     │ Playback session                                               │
 *     │                                                                │
 *     │  on load:                                                      │
 *     │    verifier = new PlaybackChecksumVerifier({ records })        │
 *     │                                                                │
 *     │  every fixed step:                                             │
 *     │    verifier.verifyFrame(frame, currentSnapshot)                │
 *     │      → 'no-pin' | 'match' | 'mismatch'                         │
 *     │      → divergences logged frame-by-frame to                    │
 *     │        verifier.getDivergenceLog()                             │
 *     └────────────────────────────────────────────────────────────────┘
 *
 * Algorithm
 * ---------
 *
 * The hash is the same FNV-1a-64 (two parallel 32-bit passes) used by
 * `./replayChecksum` — a single hash family means consumers learn one
 * format and the verifier code path is shared. The state snapshot is
 * first walked into a deterministic UTF-8 byte stream by
 * {@link serializeStateForChecksum}, then fed to
 * {@link computeReplayChecksum}.
 *
 * Why the canonical-string hop instead of hashing fields directly:
 *
 *   • The state snapshot has `number`s (positions, velocities) whose
 *     binary representation depends on whether the runtime promoted
 *     them through `Float32Array` or kept them in V8's smi/double
 *     unboxed form. Stringifying first (via `Number.prototype.toString`,
 *     which IEEE-754 round-trip-encodes every distinct float as a
 *     distinct shortest-decimal) gives us a stable, runtime-agnostic
 *     byte stream.
 *   • A canonical-string serialiser is also trivially debuggable — when
 *     a divergence fires, the verifier can re-emit the two strings
 *     side-by-side to show *exactly* which field changed (the M4 replay
 *     menu's "diagnose desync" view consumes this).
 *   • Future state additions (a new tracked field, an extra fighter
 *     attribute) can be appended to the serialiser without breaking
 *     existing pinned checksums — the algorithm identifier
 *     {@link STATE_CHECKSUM_ALGORITHM} bumps when the format changes,
 *     and the verifier rejects mismatched algorithm strings.
 *
 * Determinism contract
 * --------------------
 *
 *   • {@link computeStateChecksum} is a pure function of its input
 *     snapshot. No globals, no closures, no wall-clock reads, no RNG.
 *   • The serialiser walks fields in a fixed order — neither
 *     `Object.keys` nor any iteration order from V8/SpiderMonkey is
 *     trusted.
 *   • Float fields are serialised via `Number.prototype.toString` so
 *     `0` round-trips as `"0"`, `-0` round-trips as `"0"` (we
 *     normalise the IEEE sign bit so `-0 === +0` in the checksum), and
 *     every other distinct float gets a distinct shortest-decimal
 *     form. NaN is forbidden in deterministic match state — the
 *     simulator never produces it; we throw if asked to checksum a NaN.
 *   • Output format is deterministic (16 lowercase hex chars, padded
 *     left with `0`).
 *
 * Phaser-free
 * -----------
 *
 * No Phaser, Matter, or DOM imports. Unit-testable under plain Node
 * (vitest) and reusable from headless replay tooling.
 */

import {
  CHECKSUM_HEX_LENGTH,
  computeReplayChecksum,
  isWellFormedChecksum,
} from './replayChecksum';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Algorithm identifier carried alongside every recorded state checksum.
 * Bumps when the serialiser's field order, the float-formatting policy,
 * or the underlying hash family changes — the verifier refuses to
 * compare records whose algorithm string doesn't match what this build
 * emits. Stable forever for the current format; future formats register
 * a new identifier rather than mutating this one.
 *
 * The leading `state-` prefix discriminates these from the file-level
 * `'fnv1a-64-v1'` algorithm so a misrouted checksum (e.g. a state
 * record fed to a file verifier or vice versa) surfaces as an
 * algorithm-mismatch rather than a silent collision.
 */
export const STATE_CHECKSUM_ALGORITHM = 'state-fnv1a-64-v1' as const;

/**
 * Type alias for the algorithm identifier. Modelled as a discriminated
 * literal so a future migration can widen the union and the verifier
 * keeps narrowing correctly.
 */
export type StateChecksumAlgorithm = typeof STATE_CHECKSUM_ALGORITHM;

/**
 * Exact hex length of every state checksum string. Mirrors the file
 * checksum length ({@link CHECKSUM_HEX_LENGTH} = 16) since the hash
 * family is the same — the prefix in {@link STATE_CHECKSUM_ALGORITHM}
 * is what tells the two apart, not the string length.
 */
export const STATE_CHECKSUM_HEX_LENGTH = CHECKSUM_HEX_LENGTH;

/**
 * Canonical sentinel separator characters used by the serialiser.
 * Picked so they cannot appear inside any of the field values we emit:
 *
 *   • Player slots are joined with `|` — `characterId` is a closed
 *     enum (`'wolf' | 'cat' | 'owl' | 'bear'`) that never contains
 *     `|`.
 *   • Fields inside a slot are joined with `;` — none of our numeric
 *     formats produce `;`.
 *   • The match-level prefix and the slots are separated with `#`.
 *
 * Exposing these as named constants (rather than inlining the literals)
 * makes the wire format self-documenting and lets a hypothetical
 * future binary encoder reuse the same field-walk in a different
 * concatenation strategy.
 */
const SLOT_SEPARATOR = '|';
const FIELD_SEPARATOR = ';';
const HEADER_SEPARATOR = '#';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The minimum subset of `FighterStateSnapshot` (from
 * `../entities/Fighter`) the state checksum needs in order to detect
 * a deterministic divergence. This module deliberately declares its
 * own structural type (rather than importing
 * `FighterStateSnapshot` directly) so:
 *
 *   • The replay determinism layer doesn't take a dependency on the
 *     entity-layer's class shape — a refactor of `FighterStateSnapshot`
 *     that adds a non-deterministic field (e.g. a render-only colour
 *     tint) doesn't silently invalidate every stored checksum.
 *
 *   • Headless tooling and unit tests can synthesise minimal snapshots
 *     without standing up a Phaser scene.
 *
 *   • Callers passing a real `FighterStateSnapshot` get
 *     structural-subtype compatibility for free — every field we
 *     declare here is present on `FighterStateSnapshot` with the same
 *     type.
 *
 * Field selection rationale: every field below is part of the
 * *deterministic* match state — driven only by inputs, RNG seed, and
 * fixed-step physics. Render-only attributes (palette index colours,
 * hitbox debug flags, animation frame counters) are deliberately
 * excluded so a cosmetic change between record and playback doesn't
 * raise a false desync.
 */
export interface StateFighterSnapshot {
  /** Player slot index (0..3). */
  readonly playerIndex: number;
  /** Character roster id (`'wolf'` etc.). */
  readonly characterId: string;
  /** Palette index — included because it discriminates 8 distinct skin tones (purely visual but stable per match). */
  readonly paletteIndex: number;
  /** Stocks remaining. */
  readonly stocks: number;
  /** Stocks lost so far. Mirrors `stocks` for cross-checking. */
  readonly stocksLost: number;
  /** KOs scored so far. */
  readonly kos: number;
  /** Damage percent (float, e.g. 42.5). */
  readonly damagePercent: number;
  /** World-space position. Both axes hashed. */
  readonly position: { readonly x: number; readonly y: number };
  /** Velocity in matter px-per-step. Both axes hashed. */
  readonly velocity: { readonly x: number; readonly y: number };
  /** Last input-driven facing direction (1 = right, -1 = left). */
  readonly facing: number;
  /** True iff the fighter has at least one ground contact. */
  readonly grounded: boolean;
  /** Air jumps consumed since the last landing. */
  readonly jumpsUsed: number;
  /** True iff currently locked out by hitstun. */
  readonly inHitstun: boolean;
  /** True iff invincible (post-respawn frames). */
  readonly invincible: boolean;
  /** True iff stocks <= 0 (eliminated for the match). */
  readonly eliminated: boolean;
}

/**
 * One snapshot of the deterministic match state at a fixed frame —
 * the input to {@link computeStateChecksum}. The hybrid replay
 * architecture stores one of these every 300 frames during recording.
 */
export interface MatchStateSnapshot {
  /** Deterministic 60 Hz frame index this snapshot was sampled at. */
  readonly frame: number;
  /**
   * Per-player snapshots in slot order. Length must equal the match's
   * player count (1..4). Order matters — `fighters[0]` is P1.
   */
  readonly fighters: ReadonlyArray<StateFighterSnapshot>;
}

/**
 * One persisted `(frame, checksum)` pair — the on-disk shape stored
 * inside a `ReplayFile`'s state-checksum log (when the replay carries
 * one) and the input shape to `PlaybackChecksumVerifier`.
 *
 * `algorithm` is carried per-record (rather than per-file) so a future
 * mixed-format file (e.g. a long match recorded across an engine
 * upgrade) can co-exist different algorithms in the same log — the
 * verifier branches on this string for each pin.
 */
export interface StateChecksumRecord {
  /** Frame the checksum was sampled at. Matches the snapshot's `frame`. */
  readonly frame: number;
  /** 16-char lowercase hex digest produced by {@link computeStateChecksum}. */
  readonly checksum: string;
  /** Algorithm identifier — typically {@link STATE_CHECKSUM_ALGORITHM}. */
  readonly algorithm: StateChecksumAlgorithm;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown by {@link computeStateChecksum} when the input snapshot is
 * structurally invalid (missing player array, NaN field, wrong type).
 * Distinct subclass so a caller can `catch (e) { if (e instanceof
 * StateChecksumError) ... }` to discriminate "bad input" from a
 * mismatch detected by the verifier.
 *
 * The verifier itself does NOT throw on a checksum mismatch — it logs
 * the divergence and continues, because the M4 replay menu wants to
 * surface "this replay desyncs at frame N" as a diagnostic, not as a
 * fatal error.
 */
export class StateChecksumError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StateChecksumError';
  }
}

// ---------------------------------------------------------------------------
// Serialisation — canonical string form fed to the FNV-1a hash
// ---------------------------------------------------------------------------

/**
 * Format a `number` for the canonical state byte stream. Rules:
 *
 *   • `NaN` is forbidden and throws — deterministic match physics never
 *     produces NaN, so its appearance is the bug we want to surface
 *     loudly rather than silently fold into a hash.
 *   • `+0` and `-0` collapse to `'0'`. IEEE-754 distinguishes them but
 *     gameplay does not (a fighter at velocity `-0` is at velocity
 *     `+0` for every observable purpose), and `Number.prototype.toString`
 *     already collapses both to `'0'` — we just document the contract.
 *   • `Infinity` / `-Infinity` are also forbidden (same reasoning as
 *     NaN — bugs, not legitimate match state).
 *   • Everything else uses `Number.prototype.toString` for the
 *     shortest-decimal IEEE-754 round-trip form. This is the same
 *     canonical form `JSON.stringify` produces, but inlining it lets
 *     us throw with a clear message on the forbidden values rather
 *     than serialising them as `null` (which is what `JSON.stringify`
 *     does silently — exactly the kind of silent corruption a
 *     determinism layer must reject).
 */
function formatNumberForChecksum(n: number, fieldName: string): string {
  if (typeof n !== 'number') {
    throw new StateChecksumError(
      `computeStateChecksum: ${fieldName} must be a number, got ${typeof n}`,
    );
  }
  if (Number.isNaN(n)) {
    throw new StateChecksumError(
      `computeStateChecksum: ${fieldName} is NaN — deterministic state must ` +
        `never contain NaN`,
    );
  }
  if (!Number.isFinite(n)) {
    throw new StateChecksumError(
      `computeStateChecksum: ${fieldName} is non-finite (${n}) — ` +
        `deterministic state must never contain Infinity`,
    );
  }
  // `Number.prototype.toString()` collapses -0 to '0' already, but be
  // explicit so a future refactor that pre-formats via `String(n)` or
  // template strings keeps the same contract.
  return n === 0 ? '0' : n.toString();
}

/**
 * Format a `boolean` as the single character `'1'` (true) or `'0'`
 * (false). One-character encoding keeps the canonical string compact
 * — a 4-player snapshot has ~50 fields, every saved byte adds up
 * across 100+ pinned checksums per match.
 */
function formatBooleanForChecksum(b: boolean, fieldName: string): string {
  if (typeof b !== 'boolean') {
    throw new StateChecksumError(
      `computeStateChecksum: ${fieldName} must be a boolean, got ${typeof b}`,
    );
  }
  return b ? '1' : '0';
}

/**
 * Format a `string` for the canonical byte stream. Rejects strings
 * containing the separator characters so we can avoid building a
 * full escape mechanism — every legitimate value the engine produces
 * (character ids, etc.) is a closed enum that never contains
 * `|` / `;` / `#`.
 */
function formatStringForChecksum(s: string, fieldName: string): string {
  if (typeof s !== 'string') {
    throw new StateChecksumError(
      `computeStateChecksum: ${fieldName} must be a string, got ${typeof s}`,
    );
  }
  if (
    s.indexOf(SLOT_SEPARATOR) !== -1 ||
    s.indexOf(FIELD_SEPARATOR) !== -1 ||
    s.indexOf(HEADER_SEPARATOR) !== -1
  ) {
    throw new StateChecksumError(
      `computeStateChecksum: ${fieldName} contains a reserved separator ` +
        `character — value ${JSON.stringify(s)} cannot be checksummed`,
    );
  }
  return s;
}

/**
 * Walk one fighter slot into its canonical sub-string. Field order is
 * frozen — adding a new field appends to the end so existing pinned
 * checksums stay decodable, and the algorithm identifier bumps so the
 * verifier rejects pins from older formats.
 *
 * Each field uses a short two-letter prefix so a divergence diagnostic
 * can show the canonical strings side-by-side and a developer can spot
 * which field changed without consulting a schema.
 */
function serializeFighter(snap: StateFighterSnapshot, slotIdx: number): string {
  if (snap === null || typeof snap !== 'object') {
    throw new StateChecksumError(
      `computeStateChecksum: fighters[${slotIdx}] must be an object`,
    );
  }
  if (snap.position === null || typeof snap.position !== 'object') {
    throw new StateChecksumError(
      `computeStateChecksum: fighters[${slotIdx}].position must be an object`,
    );
  }
  if (snap.velocity === null || typeof snap.velocity !== 'object') {
    throw new StateChecksumError(
      `computeStateChecksum: fighters[${slotIdx}].velocity must be an object`,
    );
  }

  // Field order is contractually frozen — the algorithm string bumps
  // when this list changes. Two-letter prefixes are mnemonics:
  //
  //   pi = playerIndex   ci = characterId   pl = paletteIndex
  //   st = stocks        sl = stocksLost    ko = kos
  //   dm = damagePercent px = position.x    py = position.y
  //   vx = velocity.x    vy = velocity.y    fc = facing
  //   gd = grounded      ju = jumpsUsed     hs = inHitstun
  //   iv = invincible    el = eliminated
  return [
    'pi=' + formatNumberForChecksum(snap.playerIndex, `fighters[${slotIdx}].playerIndex`),
    'ci=' + formatStringForChecksum(snap.characterId, `fighters[${slotIdx}].characterId`),
    'pl=' + formatNumberForChecksum(snap.paletteIndex, `fighters[${slotIdx}].paletteIndex`),
    'st=' + formatNumberForChecksum(snap.stocks, `fighters[${slotIdx}].stocks`),
    'sl=' + formatNumberForChecksum(snap.stocksLost, `fighters[${slotIdx}].stocksLost`),
    'ko=' + formatNumberForChecksum(snap.kos, `fighters[${slotIdx}].kos`),
    'dm=' + formatNumberForChecksum(snap.damagePercent, `fighters[${slotIdx}].damagePercent`),
    'px=' + formatNumberForChecksum(snap.position.x, `fighters[${slotIdx}].position.x`),
    'py=' + formatNumberForChecksum(snap.position.y, `fighters[${slotIdx}].position.y`),
    'vx=' + formatNumberForChecksum(snap.velocity.x, `fighters[${slotIdx}].velocity.x`),
    'vy=' + formatNumberForChecksum(snap.velocity.y, `fighters[${slotIdx}].velocity.y`),
    'fc=' + formatNumberForChecksum(snap.facing, `fighters[${slotIdx}].facing`),
    'gd=' + formatBooleanForChecksum(snap.grounded, `fighters[${slotIdx}].grounded`),
    'ju=' + formatNumberForChecksum(snap.jumpsUsed, `fighters[${slotIdx}].jumpsUsed`),
    'hs=' + formatBooleanForChecksum(snap.inHitstun, `fighters[${slotIdx}].inHitstun`),
    'iv=' + formatBooleanForChecksum(snap.invincible, `fighters[${slotIdx}].invincible`),
    'el=' + formatBooleanForChecksum(snap.eliminated, `fighters[${slotIdx}].eliminated`),
  ].join(FIELD_SEPARATOR);
}

/**
 * Deterministic canonical-string form of a {@link MatchStateSnapshot}.
 * Public so:
 *
 *   • The M4 replay menu's "diagnose desync" view can render the two
 *     strings side-by-side when a divergence fires — letting a player
 *     see *which* field actually changed (positions? damage? stocks?)
 *     without having to open the JSON.
 *   • Tests can pin the canonical encoding of a known-good snapshot
 *     and lock down the wire format independently of the hash.
 *
 * The output is a single-line ASCII string (no embedded newlines), so
 * it can be safely emitted to any logger.
 */
export function serializeStateForChecksum(snapshot: MatchStateSnapshot): string {
  if (snapshot === null || typeof snapshot !== 'object') {
    throw new StateChecksumError(
      `computeStateChecksum: snapshot must be a non-null object`,
    );
  }
  if (!Array.isArray(snapshot.fighters)) {
    throw new StateChecksumError(
      `computeStateChecksum: snapshot.fighters must be an array`,
    );
  }
  if (snapshot.fighters.length < 1 || snapshot.fighters.length > 4) {
    throw new StateChecksumError(
      `computeStateChecksum: snapshot.fighters must have 1..4 entries, got ` +
        `${snapshot.fighters.length}`,
    );
  }

  const header =
    'f=' + formatNumberForChecksum(snapshot.frame, 'snapshot.frame') +
    FIELD_SEPARATOR +
    'n=' + snapshot.fighters.length;

  const slots = snapshot.fighters
    .map((f, i) => serializeFighter(f, i))
    .join(SLOT_SEPARATOR);

  return STATE_CHECKSUM_ALGORITHM + HEADER_SEPARATOR + header + HEADER_SEPARATOR + slots;
}

// ---------------------------------------------------------------------------
// Public API — hash + record builder
// ---------------------------------------------------------------------------

/**
 * Compute the deterministic 64-bit checksum of a match state snapshot.
 * The output is a 16-character lowercase hex string — the same shape
 * as {@link computeReplayChecksum}, so consumers (the verifier, the
 * M4 menu, headless tooling) can format both checksums uniformly.
 *
 * Pure / synchronous / dependency-free. Throws
 * {@link StateChecksumError} on a structurally invalid snapshot —
 * NaN, missing player array, wrong types — because those represent
 * bugs in the simulator that determinism tooling should reject loudly
 * rather than silently fold into a hash.
 */
export function computeStateChecksum(snapshot: MatchStateSnapshot): string {
  const canonical = serializeStateForChecksum(snapshot);
  return computeReplayChecksum(canonical);
}

/**
 * Build a {@link StateChecksumRecord} from a snapshot at the snapshot's
 * own frame. Convenience for the (Sub-AC 1) recorder pin path:
 *
 *   const record = buildStateChecksumRecord(currentSnapshot);
 *   stateChecksums.push(record);
 *
 * Equivalent to:
 *
 *   { frame: snapshot.frame,
 *     checksum: computeStateChecksum(snapshot),
 *     algorithm: STATE_CHECKSUM_ALGORITHM }
 */
export function buildStateChecksumRecord(
  snapshot: MatchStateSnapshot,
): StateChecksumRecord {
  return Object.freeze({
    frame: snapshot.frame,
    checksum: computeStateChecksum(snapshot),
    algorithm: STATE_CHECKSUM_ALGORITHM,
  });
}

/**
 * Structural sniff for a `StateChecksumRecord`. Used by the verifier to
 * surface "this stored pin is malformed" with a clear error rather
 * than throwing somewhere deep inside the comparison.
 */
export function isWellFormedStateChecksumRecord(
  v: unknown,
): v is StateChecksumRecord {
  if (v === null || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  if (typeof r['frame'] !== 'number') return false;
  if (!Number.isInteger(r['frame']) || (r['frame'] as number) < 0) return false;
  if (!isWellFormedChecksum(r['checksum'])) return false;
  if (r['algorithm'] !== STATE_CHECKSUM_ALGORITHM) return false;
  return true;
}
