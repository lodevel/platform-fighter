import { GAME_CONFIG } from './constants';
import { GameLoop, type RenderFn } from './GameLoop';

/**
 * Wrapper around Matter.js that enforces a fixed-timestep simulation
 * for deterministic replays.
 *
 * The fixed-timestep mechanics live in {@link GameLoop} (engine core).
 * `PhysicsEngine` composes a `GameLoop` and adds the physics-specific
 * concern: driving the Matter.js world via a `step()` callback at a
 * deterministic 16.67 ms cadence while letting the renderer interpolate
 * for smooth motion.
 *
 * Phaser's matter plugin will be driven via this engine from the
 * gameplay scene's update loop. AC 2 wires Matter.Engine.update; AC 3
 * (this AC) implements the deterministic loop the world is stepped on.
 */
export class PhysicsEngine {
  readonly fixedTimestepMs: number = GAME_CONFIG.fixedTimestepMs;

  private readonly loop: GameLoop;

  constructor(loop: GameLoop = new GameLoop({ fixedTimestepMs: GAME_CONFIG.fixedTimestepMs })) {
    this.loop = loop;
  }

  /**
   * Advance the simulation in fixed steps using a wall-clock delta.
   *
   * `step` runs once per fixed timestep — it should call into Matter.js
   * (e.g. `Matter.Engine.update(world, fixedTimestepMs)`) plus any
   * gameplay logic that must remain frame-deterministic.
   *
   * `render` runs once per outer tick with an interpolation alpha so
   * sprite transforms can lerp between physics steps for smooth motion.
   */
  advance(deltaMs: number, step: () => void, render?: RenderFn): number {
    return this.loop.tick(deltaMs, () => step(), render);
  }

  /** Current physics frame index (monotonic, 60 Hz). */
  getFrame(): number {
    return this.loop.getFrame();
  }

  /** Latest render-interpolation alpha in [0, 1). */
  getAlpha(): number {
    return this.loop.getAlpha();
  }

  /** Underlying engine-core loop, exposed for tests and replay tooling. */
  getLoop(): GameLoop {
    return this.loop;
  }

  pause(): void {
    this.loop.pause();
  }

  resume(): void {
    this.loop.resume();
  }

  isPaused(): boolean {
    return this.loop.isPaused();
  }

  reset(): void {
    this.loop.reset();
  }

  /** Restore a deterministic frame index (used by replay snapshot resync). */
  setFrame(frame: number): void {
    this.loop.setFrame(frame);
  }
}
