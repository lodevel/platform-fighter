/**
 * Camera module.
 *
 * Implements Sub-AC 2.3: bounds clamped to the active stage's blast
 * zone, multi-target follow with smooth lerp, and a configurable
 * viewport rectangle. The controller is a thin wrapper around
 * `scene.cameras.main` — replays and the stage-builder preview can
 * reuse it without dragging gameplay state along.
 */

export {
  CameraController,
  type CameraTarget,
  type CameraBounds,
  type CameraViewport,
  type CameraControllerOptions,
} from './CameraController';
