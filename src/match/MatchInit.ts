/**
 * Match-init helpers — the bridge between the per-match `MatchConfig`
 * (chosen at the menu / passed by the replay player) and the
 * deterministic gameplay subsystems that need to know the match seed
 * before the first physics step runs.
 *
 * AC 30001 Sub-AC 1: "all randomness flows through a single
 * deterministic source captured at match start." This module is where
 * the capture happens. A gameplay scene calls `initialiseMatchRng()`
 * once during `create()`, before any AI / hazard / particle subsystem
 * is constructed, and stashes the returned `{ seed, rng }` on the
 * scene + registry so every subsystem can read the same MatchRng.
 *
 * Phaser-free on purpose so the same factory is reusable by:
 *   • The Phaser-driven `MatchScene` (M1+).
 *   • Headless replay tooling (M4) that reconstructs a match from a
 *     replay header without booting Phaser.
 *   • Unit tests that exercise match-init wiring under plain Node.
 */

import type { MatchConfig } from '../types';
import { MatchRng } from './MatchRng';

/**
 * Inputs to `initialiseMatchRng`. We accept a *resolved* fallback seed
 * rather than reading `GAME_CONFIG.defaultRngSeed` here so the boot
 * layer remains the single owner of "what is the engine-default seed."
 */
export interface MatchRngInitOptions {
  /**
   * Optional explicit per-match seed. When the menu/replay layer
   * forwards a `MatchConfig.rngSeed`, this is that number. When the
   * caller has no MatchConfig (e.g. dev-mode "press ENTER to fight")
   * leave this `undefined` and the fallback is used.
   *
   * Non-finite values (`NaN`, `Infinity`, `-Infinity`) are treated as
   * "no seed supplied" so a corrupt MatchConfig can't silently produce
   * an unreproducible match.
   */
  readonly configSeed?: number;
  /**
   * Engine-default seed used when no explicit per-match seed was
   * supplied. Typically `GAME_CONFIG.defaultRngSeed` or the seed
   * BootScene already seeded the registry RNG with.
   */
  readonly fallbackSeed: number;
}

/**
 * The capture: the resolved seed plus the live MatchRng built from it.
 * Callers persist `seed` in replay metadata and pass `rng` (or a child
 * stream) to every subsystem that needs randomness.
 */
export interface MatchRngInitResult {
  readonly seed: number;
  readonly rng: MatchRng;
}

/**
 * Capture the deterministic match seed at match start and build the
 * single `MatchRng` instance every gameplay subsystem reads from for
 * the rest of the match.
 *
 * Resolution order:
 *   1. If a finite `configSeed` is supplied — i.e. the menu / replay
 *      player gave us an explicit `MatchConfig.rngSeed` — it wins.
 *      This is the seed the player or replay author chose.
 *   2. Otherwise we fall back to the engine-level `fallbackSeed`
 *      (typically the boot RNG seed) so a fresh-from-menu match still
 *      gets a deterministic seed without forcing every menu path to
 *      synthesize one.
 *
 * The returned seed is always `>>> 0`-clamped to an unsigned 32-bit
 * integer so it round-trips through replay JSON without precision
 * loss.
 */
export function initialiseMatchRng(
  options: MatchRngInitOptions,
): MatchRngInitResult {
  const seed = pickMatchSeed(options);
  return { seed, rng: new MatchRng(seed) };
}

/**
 * Convenience for callers holding a fully-formed `MatchConfig`.
 *
 * Doing this in one call site lets `MatchScene.create()` say
 * `initialiseMatchRngFromConfig(matchConfig, bootSeed)` and not have
 * to remember which field on `MatchConfig` carries the seed.
 */
export function initialiseMatchRngFromConfig(
  config: Pick<MatchConfig, 'rngSeed'> | null | undefined,
  fallbackSeed: number,
): MatchRngInitResult {
  return initialiseMatchRng({
    configSeed: config?.rngSeed,
    fallbackSeed,
  });
}

/**
 * Resolves the seed without constructing the `MatchRng`. Exposed for
 * the replay header writer (which captures the seed before the live
 * RNG is constructed).
 */
export function pickMatchSeed(options: MatchRngInitOptions): number {
  const c = options.configSeed;
  if (typeof c === 'number' && Number.isFinite(c)) return c >>> 0;
  return options.fallbackSeed >>> 0;
}
