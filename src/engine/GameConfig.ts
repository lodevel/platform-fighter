/**
 * Main Phaser game configuration file.
 *
 * Centralises:
 *   - Re-exports of pure gameplay constants from `./constants`
 *   - The Phaser 3 + Matter.js engine config object used to boot the game
 *   - Scene registration order
 *
 * The simulation runs at a fixed 60 Hz step. All gameplay timing is
 * expressed in frames (1 frame = 1/60 s) to keep replays deterministic
 * across machines. Phaser's render loop is locked to 60 FPS via the
 * `fps` block, while the deterministic gameplay step is driven by
 * `PhysicsEngine.advance()` (which uses `GameLoop`) from the active
 * gameplay scene.
 *
 * NOTE: Engine-core modules import constants from `./constants` directly
 * so they don't transitively pull in Phaser. This file is for the boot
 * path only.
 */

import Phaser from 'phaser';
import { BootScene } from '../scenes/BootScene';
import { PreloadScene } from '../scenes/PreloadScene';
import { PasswordGateScene } from '../scenes/PasswordGateScene';
import { MainMenuScene } from '../scenes/MainMenuScene';
import { LobbyScene } from '../scenes/LobbyScene';
import { ModeSelectScene } from '../scenes/ModeSelectScene';
import { StageSelectScene } from '../scenes/StageSelectScene';
import { CharacterSelectScene } from '../scenes/CharacterSelectScene';
import { MatchScene } from '../scenes/MatchScene';
import { PauseMenuScene } from '../scenes/PauseMenuScene';
import { ResultsScene } from '../scenes/ResultsScene';
import { RebindingScene } from '../scenes/RebindingScene';
import { StageBuilderScene } from '../scenes/StageBuilderScene';
import { CustomStageScene } from '../scenes/CustomStageScene';
import { CharacterEditorScene } from '../scenes/CharacterEditorScene';
import { GAME_CONFIG } from './constants';

export { GAME_CONFIG };
export type { GameConstants } from './constants';

// ---------------------------------------------------------------------------
// Scene registration
// ---------------------------------------------------------------------------

/**
 * Ordered list of all scenes Phaser knows about. The first entry is the
 * scene Phaser auto-starts on boot. Adding a scene here is the only place
 * needed to wire it into the game.
 */
export const SCENES: ReadonlyArray<new () => Phaser.Scene> = [
  BootScene,
  PreloadScene,
  PasswordGateScene,
  MainMenuScene,
  LobbyScene,
  ModeSelectScene,
  StageSelectScene,
  CharacterSelectScene,
  MatchScene,
  // M2 pause overlay — `scene.launch`ed on top of the frozen MatchScene.
  PauseMenuScene,
  ResultsScene,
  RebindingScene,
  StageBuilderScene,
  CustomStageScene,
  CharacterEditorScene,
];

// ---------------------------------------------------------------------------
// Phaser game config factory
// ---------------------------------------------------------------------------

/**
 * Build the Phaser 3 game config object.
 *
 * Pulled out of `main.ts` so the config has a single, importable home and
 * can be unit-tested or reused (e.g. by a stage-builder preview window)
 * without duplicating renderer/physics flags.
 */
export function createPhaserGameConfig(): Phaser.Types.Core.GameConfig {
  return {
    // Renderer ------------------------------------------------------------
    type: Phaser.AUTO, // Prefer WebGL, fall back to Canvas.
    parent: GAME_CONFIG.parentElementId,
    backgroundColor: GAME_CONFIG.backgroundColor,

    // Canvas / scaling ----------------------------------------------------
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: GAME_CONFIG.width,
      height: GAME_CONFIG.height,
      // Allow the canvas to follow the browser size (responsive fullscreen).
      expandParent: true,
    },

    // 60 FPS lock ---------------------------------------------------------
    fps: {
      target: GAME_CONFIG.targetFps,
      min: GAME_CONFIG.targetFps,
      // Use rAF (forceSetTimeOut: false) for the 60 Hz render loop.
      forceSetTimeOut: false,
      // Disable Phaser's internal smoothing — gameplay uses a fixed-step
      // accumulator in PhysicsEngine for deterministic replays.
      smoothStep: false,
    },

    // Matter.js physics ---------------------------------------------------
    physics: {
      default: 'matter',
      matter: {
        gravity: { x: 0, y: GAME_CONFIG.gravity },
        // Sleeping bodies break determinism; keep everything awake.
        enableSleeping: false,
        // Debug overlay is toggled via GAME_CONFIG.debugPhysics.
        debug: GAME_CONFIG.debugPhysics,
        // Note: the actual fixed-timestep stepping is enforced by
        // src/engine/PhysicsEngine.ts (which composes GameLoop) driving
        // the Matter world from the gameplay scene's update loop.
      },
    },

    // Renderer flags ------------------------------------------------------
    render: {
      pixelArt: false,
      antialias: true,
      antialiasGL: true,
      roundPixels: false,
      // Power preference helps laptops pick the discrete GPU when present.
      powerPreference: 'high-performance',
    },

    // Input ---------------------------------------------------------------
    input: {
      keyboard: true,
      gamepad: true,
      // Smash-style fighters are mouse-free; disable to avoid stray input.
      mouse: false,
      touch: false,
    },

    // Determinism / quality ---------------------------------------------
    disableContextMenu: true,
    banner: false,
    autoFocus: true,

    // Scene registration --------------------------------------------------
    scene: SCENES as unknown as Phaser.Types.Scenes.SceneType[],
  };
}
