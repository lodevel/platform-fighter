/**
 * MatchRng — the single deterministic source for all in-match randomness.
 *
 * AC 30001 Sub-AC 1: every match captures one seed at start, and every
 * gameplay subsystem that needs randomness (AI controller, hazard
 * cycle jitter, particle effects, visual flicker, taunt selection, …)
 * reads from this MatchRng via a named stream. Two subsystems can
 * therefore never share state and break replay determinism.
 *
 * Design notes
 * ============
 *
 * 1. **Captured at match start.** The seed is `>>> 0`-clamped to an
 *    unsigned 32-bit integer in the constructor and exposed via
 *    `getSeed()`. The replay system persists this number in the
 *    replay header so a future re-run reconstructs an identical
 *    MatchRng with `new MatchRng(replay.seed)`.
 *
 * 2. **Stream isolation.** Subsystems pull a child `Rng` via
 *    `match.rng.stream('ai')`. The child is seeded with a deterministic
 *    hash of `(matchSeed, label)`, so:
 *      - The AI's stream is independent of how many particle bursts
 *        the renderer played this frame.
 *      - Adding a new stream later (e.g. `taunt`) cannot shift any
 *        existing stream's sequence — old replays stay valid.
 *      - Two streams with different labels never collide on the same
 *        Mulberry32 state.
 *    Repeated `stream(label)` calls return the same instance, so any
 *    caller that holds the reference for the whole match keeps the
 *    sequence intact across frames.
 *
 * 3. **Snapshot/restore.** The hybrid replay system (M4) snapshots the
 *    full match state every 300 frames so a desync can resync without
 *    replaying from frame 0. `snapshotState()` captures the root PRNG
 *    state plus every materialised stream's PRNG state;
 *    `restoreState()` reinstates them. We refuse to restore a state
 *    whose seed differs from this match's — reseeding mid-match is the
 *    one operation that *would* break the "captured at match start"
 *    contract.
 *
 * 4. **Phaser-free.** This module imports nothing from Phaser/Matter,
 *    so it is unit-testable under plain Node (vitest) and reusable by
 *    headless replay tooling.
 */

import { Rng } from '../utils/Rng';

/**
 * Deterministic 32-bit hash of an integer seed plus a stream label.
 * Used to derive named substream seeds from a single match seed.
 *
 * Variant of FNV-1a folded with the integer seed and a final
 * Murmur-style mix so very short labels still spread bits well.
 *
 * Pure / branch-free / no allocations beyond the input string —
 * cheap enough to call once per stream materialisation (which only
 * happens when a subsystem first asks for its stream).
 */
export function hashSeedWithLabel(seed: number, label: string): number {
  let h = (seed >>> 0) ^ 0x811c9dc5;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // Final Murmur3 fmix32 so neighbouring labels ("ai" vs "ai2") and
  // tiny seeds (0, 1, 2) produce well-separated streams.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Serialisable PRNG state for the match-level snapshot system.
 * Plain data — JSON-safe — so the replay writer can persist it
 * verbatim.
 */
export interface MatchRngState {
  readonly seed: number;
  readonly root: number;
  readonly streams: Readonly<Record<string, number>>;
}

/**
 * Stream labels the engine reserves so subsystems agree on a single
 * spelling. Subsystems may also pass arbitrary strings — the type
 * widens to `string` everywhere it's accepted.
 */
export type MatchRngStreamLabel =
  | 'ai'
  | 'hazard'
  | 'visual'
  | 'particle'
  | 'taunt'
  | 'announcer'
  | (string & {});

export class MatchRng {
  private readonly seed: number;
  private readonly root: Rng;
  private readonly streams = new Map<string, Rng>();

  constructor(seed: number) {
    // Clamp to unsigned 32-bit so `new MatchRng(-1)` and
    // `new MatchRng(0xffffffff)` produce the same stream — same rule
    // the underlying `Rng` enforces, surfaced here so we never re-hash
    // a negative seed via `hashSeedWithLabel` differently than `Rng`
    // would interpret it.
    this.seed = seed >>> 0;
    this.root = new Rng(this.seed);
  }

  /**
   * The seed captured at match start. Persist this in replay metadata
   * so the same match can be reconstructed bit-identically.
   */
  getSeed(): number {
    return this.seed;
  }

  /**
   * Returns the deterministic child RNG for `label`. Repeated calls
   * with the same label return the same instance, so a subsystem that
   * holds the reference keeps a single PRNG sequence across frames
   * (which is what determinism requires).
   */
  stream(label: MatchRngStreamLabel): Rng {
    let rng = this.streams.get(label);
    if (!rng) {
      rng = new Rng(hashSeedWithLabel(this.seed, label));
      this.streams.set(label, rng);
    }
    return rng;
  }

  /**
   * `true` once `stream(label)` has been called at least once. Useful
   * for assertions in tests and for the snapshot writer to skip
   * persisting streams nothing has touched yet.
   */
  hasStream(label: string): boolean {
    return this.streams.has(label);
  }

  /**
   * The set of stream labels that have been materialised so far.
   * Returned in insertion order so snapshot diffs read cleanly.
   */
  listStreams(): readonly string[] {
    return Array.from(this.streams.keys());
  }

  /**
   * Convenience pass-through for one-off pulls that don't logically
   * belong to a named stream (e.g. tie-break coin flips at match
   * start). Subsystems with persistent state should prefer `stream()`.
   */
  next(): number {
    return this.root.next();
  }

  /** Convenience pass-through for one-off integer pulls. */
  range(min: number, max: number): number {
    return this.root.range(min, max);
  }

  /**
   * Capture the current PRNG state of the root and every materialised
   * stream. Call this on the snapshot frame; pair with
   * `restoreState()` on a desync resync.
   */
  snapshotState(): MatchRngState {
    const streams: Record<string, number> = {};
    for (const [label, rng] of this.streams) {
      streams[label] = rng.getState();
    }
    return { seed: this.seed, root: this.root.getState(), streams };
  }

  /**
   * Restore from a previously captured state. The seed must match —
   * we don't support reseeding mid-match because that would break
   * the "captured at match start" determinism contract.
   *
   * Streams not in the snapshot are left at whatever state they
   * already had; streams in the snapshot but not yet materialised on
   * this MatchRng are created on the fly so the post-restore
   * behaviour matches the snapshot exactly.
   */
  restoreState(state: MatchRngState): void {
    if ((state.seed >>> 0) !== this.seed) {
      throw new Error(
        `MatchRng.restoreState: seed mismatch (got ${state.seed >>> 0}, ` +
          `match was started with ${this.seed})`,
      );
    }
    this.root.setState(state.root);
    for (const [label, sub] of Object.entries(state.streams)) {
      this.stream(label).setState(sub);
    }
  }
}
