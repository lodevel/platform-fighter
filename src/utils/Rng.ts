/**
 * Deterministic seeded PRNG (Mulberry32).
 *
 * The entire game uses this generator instead of Math.random() so that
 * matches replay identically given the same seed and input log. AI
 * decisions, particle jitter, and any "random" hazard behavior must
 * pull from an instance of this class.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // Force unsigned 32-bit and avoid 0 state.
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  /** Returns a float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns an integer in [min, max] inclusive. */
  range(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Snapshot internal state for deterministic save/restore. */
  getState(): number {
    return this.state;
  }

  setState(state: number): void {
    this.state = state >>> 0;
  }
}
