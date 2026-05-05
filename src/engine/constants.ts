/**
 * Pure gameplay/engine constants.
 *
 * Lives separately from `GameConfig.ts` so engine-core modules
 * (GameLoop, PhysicsEngine, AI, replay) can import these values
 * without pulling Phaser into their dependency graph. That keeps the
 * engine unit-testable under plain Node (vitest) and keeps the import
 * surface small for replay/headless tooling.
 *
 * `GameConfig.ts` re-exports `GAME_CONFIG` (which is built from these
 * constants) and additionally owns the Phaser game-config factory.
 */

export interface GameConstants {
  readonly width: number;
  readonly height: number;
  readonly targetFps: number;
  readonly fixedTimestepMs: number;
  /** Matter.js gravity scale (positive Y = downward). */
  readonly gravity: number;
  readonly maxPlayers: number;
  readonly debugPhysics: boolean;
  /** Replay state-snapshot cadence (frames between full snapshots). */
  readonly snapshotIntervalFrames: number;
  /** Default deterministic RNG seed for AI / gameplay. */
  readonly defaultRngSeed: number;
  /** DOM element id Phaser mounts its canvas into. */
  readonly parentElementId: string;
  /** Background colour shown before any scene draws. */
  readonly backgroundColor: string;
}

export const GAME_CONFIG: GameConstants = {
  width: 1920,
  height: 1080,
  targetFps: 60,
  fixedTimestepMs: 1000 / 60,
  gravity: 1.0,
  maxPlayers: 4,
  debugPhysics: false,
  snapshotIntervalFrames: 300,
  defaultRngSeed: 0xc0ffee,
  parentElementId: 'game-root',
  backgroundColor: '#0a0a12',
};
