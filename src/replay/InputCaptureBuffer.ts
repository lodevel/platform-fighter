/**
 * Per-frame input capture buffer — AC 30002 Sub-AC 2.
 *
 * The deterministic core of the M4 hybrid replay system: while a match
 * is being played, the buffer records the `CharacterInput` snapshot of
 * every active player every fixed physics frame, keyed by frame number.
 * Replaying the buffer back into the match scene's input pipeline is
 * what reproduces a fight bit-for-bit.
 *
 * Architecture
 * ------------
 *
 * The buffer sits between the live input handler (keyboard / gamepad /
 * AI) and the gameplay scene's per-frame `Character.applyInput` call.
 * Each fixed step the scene:
 *
 *   1. Sample the live input source for every active player —
 *      producing a `CharacterInput` per slot.
 *   2. Hand that snapshot to `buffer.captureFrame(frame, [...])` so it
 *      is recorded keyed by frame number.
 *   3. Forward the captured snapshot to `Character.applyInput` exactly
 *      as before — the buffer is read-through, not rewriting inputs.
 *
 * The replay player (M4) flips the data direction: it constructs a
 * buffer from a saved log and calls `getFrame(frame)` to push those
 * recorded inputs back into the live `Character.applyInput` calls.
 *
 * The buffer is intentionally agnostic about *how* a player's input
 * was produced — keyboard, gamepad, AI, or replay — because every
 * source produces the same `CharacterInput` shape. That symmetry is
 * what allows AI-vs-AI matches to be recorded the same way as
 * human-vs-human.
 *
 * Determinism guarantees
 * ----------------------
 *
 *   • Frames are passed in by the caller (typically
 *     `physicsEngine.getFrame()`) so the buffer doesn't own its own
 *     clock. No wall-clock reads, no `Math.random()`, no `Date.now()`.
 *
 *   • Inputs are stored as **defensive deep copies** of the supplied
 *     `CharacterInput`, normalised to a closed shape — every field
 *     present, optional fields collapsed to deterministic defaults.
 *     This means a caller mutating its own `CharacterInput` after
 *     capture cannot corrupt the recorded log, and a replay produced
 *     from the buffer always sees the exact same boolean for
 *     `attack`, `dropThrough`, etc. (no `undefined` aliasing `false`).
 *
 *   • The buffer is **append-only by frame** — `captureFrame` rejects
 *     non-monotonic / duplicate frames so a misbehaving caller can't
 *     silently corrupt the log. The replay system relies on the
 *     "exactly one entry per simulated frame" invariant for byte-level
 *     reproducibility.
 *
 *   • Compaction-friendly. `getEntries()` yields a flat array of
 *     `{ frame, inputs }` records the (later-AC) replay serialiser can
 *     run-length-encode without further normalisation.
 *
 * Phaser-free
 * -----------
 *
 * No Phaser, Matter, or DOM imports. The vitest suite under
 * `InputCaptureBuffer.test.ts` covers every transition under plain
 * Node — no jsdom, no scene fixture, no game window.
 */

import type { CharacterInput } from '../characters/Character';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Player slot identifier — the same 0..3 index used by `StockTracker`,
 * `BlastZoneWatcher`, and the rest of the match-state engine. The
 * buffer accepts up to four slots per the Seed's "local multiplayer
 * for up to 4 players" constraint.
 */
export type PlayerIndex = 0 | 1 | 2 | 3;

/**
 * Normalised, fully-closed per-frame input record. The buffer stores
 * this shape (not the loose `CharacterInput` whose `attack` /
 * `dropThrough` are optional) so every persisted entry is
 * byte-comparable across captures and replays.
 *
 * The fields mirror `CharacterInput` exactly so downstream code can
 * pass a `RecordedCharacterInput` straight into
 * `Character.applyInput` without an adapter step.
 */
export interface RecordedCharacterInput {
  /**
   * Horizontal stick. -1 = full left, 0 = neutral, 1 = full right.
   * Analog values in [-1, 1] are preserved (the buffer never quantises
   * gamepad axes — that's a serialiser concern).
   */
  readonly moveX: number;
  /** Jump button held this frame. */
  readonly jump: boolean;
  /** Attack button held this frame. */
  readonly attack: boolean;
  /** Drop-through-platform intent (typically `down && jump`). */
  readonly dropThrough: boolean;
}

/**
 * One frame of the capture log. The `inputs` array is keyed by player
 * index — `inputs[0]` is P1, `inputs[1]` is P2, etc. — and is exactly
 * `playerCount` long. Eliminated / inactive players still occupy a
 * slot; the scene passes them a neutral input so the array shape stays
 * stable across the whole match (the replay system depends on this for
 * efficient run-length encoding).
 */
export interface CapturedFrame {
  /** Deterministic 60 Hz frame index, monotonically increasing. */
  readonly frame: number;
  /**
   * Per-player input for this frame. Length is `playerCount`. Entries
   * are deep-copied at capture time so the caller can re-use its own
   * snapshot buffer without corrupting the log.
   */
  readonly inputs: ReadonlyArray<RecordedCharacterInput>;
}

/** Constructor options. */
export interface InputCaptureBufferOptions {
  /**
   * Number of player slots tracked. Must be between 1 and 4 inclusive
   * to match the Seed's local-multiplayer cap. The scene passes the
   * same number it gives `StockTracker`.
   */
  readonly playerCount: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Neutral input — every field at its "no input" value. Used as the
 * fallback for a player slot whose live source returned `undefined`
 * (e.g. an eliminated fighter the scene chose to skip sampling for)
 * and as the canonical "do nothing" replay input.
 */
export const NEUTRAL_INPUT: RecordedCharacterInput = Object.freeze({
  moveX: 0,
  jump: false,
  attack: false,
  dropThrough: false,
});

// ---------------------------------------------------------------------------
// InputCaptureBuffer
// ---------------------------------------------------------------------------

/**
 * Append-only frame-keyed input log. One per match.
 *
 * Lifecycle:
 *
 *   const buffer = new InputCaptureBuffer({ playerCount: 2 });
 *   // every fixed step, after sampling each player's CharacterInput:
 *   buffer.captureFrame(physicsEngine.getFrame(), [p1Input, p2Input]);
 *   // …
 *   // at match end (or every 300 frames for snapshot resync), persist:
 *   const log = buffer.getEntries();
 */
export class InputCaptureBuffer {
  private readonly playerCount: number;
  /**
   * Frame → inputs map. We use a flat array of `CapturedFrame` rather
   * than a `Map<number, …>` because:
   *   • The frames are dense, monotonic, and capped by match length
   *     (~10 minutes @ 60 Hz = 36 000 entries — fine for an array).
   *   • A flat array serialises to JSON / a Uint8Array trivially.
   *   • `getEntries()` is O(1) — no Map → array conversion.
   */
  private readonly entries: CapturedFrame[];
  /**
   * Last frame number captured, or `null` if the buffer is empty. Kept
   * as its own field so `captureFrame` can validate monotonicity in
   * O(1) without indexing into `entries` (which would also work but
   * would require a length check first).
   */
  private lastFrame: number | null;

  constructor(options: InputCaptureBufferOptions) {
    if (!Number.isInteger(options.playerCount)) {
      throw new Error(
        `InputCaptureBuffer: playerCount must be an integer, got ${String(
          options.playerCount,
        )}`,
      );
    }
    if (options.playerCount < 1 || options.playerCount > 4) {
      throw new Error(
        `InputCaptureBuffer: playerCount must be 1..4, got ${options.playerCount}`,
      );
    }
    this.playerCount = options.playerCount;
    this.entries = [];
    this.lastFrame = null;
  }

  /** Number of player slots this buffer captures per frame. */
  getPlayerCount(): number {
    return this.playerCount;
  }

  /** Total number of captured frames. */
  size(): number {
    return this.entries.length;
  }

  /** True iff no frames have been captured yet. */
  isEmpty(): boolean {
    return this.entries.length === 0;
  }

  /** The most recent captured frame number, or `null` if empty. */
  getLastFrame(): number | null {
    return this.lastFrame;
  }

  /**
   * Record one frame's worth of inputs. Performs:
   *
   *   1. Frame-number validation — must be a non-negative integer and
   *      strictly greater than the last captured frame. Strict
   *      monotonicity prevents two physics steps from accidentally
   *      writing to the same frame slot, which would silently break
   *      replay determinism (the second write would shadow the first).
   *
   *   2. Player-count validation — the supplied array must be exactly
   *      `playerCount` long. A short array would mean a missing
   *      player; a long one would mean a phantom player. Either is a
   *      bug worth crashing on.
   *
   *   3. Defensive deep-copy + normalisation — each `CharacterInput`
   *      is canonicalised into a frozen `RecordedCharacterInput`. This
   *      is what makes the log immune to caller-side mutation.
   *
   * @param frame   Deterministic 60 Hz frame index — usually
   *                `physicsEngine.getFrame()`.
   * @param inputs  Per-player input snapshot for this frame, in slot
   *                order (`inputs[0]` is P1, `inputs[1]` is P2, …).
   *                Entries may be `undefined` to mean "treat as
   *                neutral" — useful for eliminated fighters whose
   *                slot the scene chose not to sample.
   */
  captureFrame(
    frame: number,
    inputs: ReadonlyArray<CharacterInput | undefined>,
  ): void {
    if (!Number.isInteger(frame) || frame < 0) {
      throw new Error(
        `InputCaptureBuffer.captureFrame: frame must be a non-negative ` +
          `integer, got ${String(frame)}`,
      );
    }
    if (this.lastFrame !== null && frame <= this.lastFrame) {
      throw new Error(
        `InputCaptureBuffer.captureFrame: frame ${frame} is not strictly ` +
          `greater than last captured frame ${this.lastFrame} — frames must ` +
          `be monotonic to preserve replay determinism`,
      );
    }
    if (inputs.length !== this.playerCount) {
      throw new Error(
        `InputCaptureBuffer.captureFrame: expected ${this.playerCount} ` +
          `player inputs, got ${inputs.length}`,
      );
    }

    const recorded: RecordedCharacterInput[] = new Array(this.playerCount);
    for (let i = 0; i < this.playerCount; i += 1) {
      recorded[i] = normaliseInput(inputs[i]);
    }

    this.entries.push(
      Object.freeze({
        frame,
        inputs: Object.freeze(recorded),
      }) as CapturedFrame,
    );
    this.lastFrame = frame;
  }

  /**
   * Retrieve the captured input snapshot for a specific frame, or
   * `null` if that frame was never captured. O(log n) via binary
   * search on the (monotonic) frame index — the M4 replay player
   * calls this once per fixed step and benefits from sub-linear
   * lookup on long matches.
   */
  getFrame(frame: number): CapturedFrame | null {
    const idx = this.findFrameIndex(frame);
    return idx === -1 ? null : this.entries[idx]!;
  }

  /**
   * Retrieve the captured snapshot for a single player at a given
   * frame, or `null` if that frame was never captured. Convenience
   * wrapper around `getFrame` for replay code paths that only need
   * to push a single player's input back into `Character.applyInput`.
   */
  getPlayerInput(
    frame: number,
    playerIndex: PlayerIndex,
  ): RecordedCharacterInput | null {
    if (playerIndex >= this.playerCount) return null;
    const captured = this.getFrame(frame);
    return captured ? captured.inputs[playerIndex] ?? null : null;
  }

  /**
   * Read-only view of every captured frame, in capture order. The
   * returned array is the buffer's internal storage — callers MUST
   * NOT mutate it. The replay serialiser iterates this directly.
   */
  getEntries(): ReadonlyArray<CapturedFrame> {
    return this.entries;
  }

  /**
   * Drop the entire log. Intended for the scene's SHUTDOWN hook so a
   * subsequent match doesn't inherit the previous match's frames.
   */
  reset(): void {
    this.entries.length = 0;
    this.lastFrame = null;
  }

  /**
   * Binary search for an entry whose `frame` field equals the given
   * frame number. Returns the index in `entries`, or -1 if not found.
   * Relies on the strict-monotonic invariant enforced by
   * `captureFrame`.
   */
  private findFrameIndex(frame: number): number {
    let lo = 0;
    let hi = this.entries.length - 1;
    while (lo <= hi) {
      // Bias toward the high end — replay reads usually walk forward
      // through frames, so the most recent entries are queried most
      // often. The classic midpoint still works; we just don't bother
      // optimising the bias because the log is bounded.
      const mid = (lo + hi) >>> 1;
      const entry = this.entries[mid]!;
      if (entry.frame === frame) return mid;
      if (entry.frame < frame) {
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return -1;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Coerce a (possibly partial, possibly `undefined`) `CharacterInput`
 * into a frozen `RecordedCharacterInput` with every field present.
 * `undefined` collapses to {@link NEUTRAL_INPUT} so eliminated /
 * unsampled slots produce a deterministic neutral entry — never a
 * `null` or `undefined` that the replay player would have to special-
 * case.
 *
 * `moveX` is clamped to the documented [-1, 1] range. The buffer
 * never *invents* values, so callers that pass exactly `0`, `-1`, or
 * `+1` (the keyboard-only path) round-trip unchanged. The clamp only
 * catches gamepad drivers that overshoot, which would otherwise
 * propagate non-determinism through `Character.applyInput`.
 *
 * Non-finite `moveX` (NaN, ±Infinity) is treated as neutral. This is
 * a defensive choice: a `NaN` slipping through to physics would
 * poison the Matter body's velocity and the resulting state could
 * never be replayed.
 */
function normaliseInput(
  input: CharacterInput | undefined,
): RecordedCharacterInput {
  if (input === undefined) {
    return NEUTRAL_INPUT;
  }

  let moveX = input.moveX;
  if (typeof moveX !== 'number' || !Number.isFinite(moveX)) {
    moveX = 0;
  } else if (moveX < -1) {
    moveX = -1;
  } else if (moveX > 1) {
    moveX = 1;
  }

  return Object.freeze({
    moveX,
    jump: Boolean(input.jump),
    attack: Boolean(input.attack),
    dropThrough: Boolean(input.dropThrough),
  });
}
