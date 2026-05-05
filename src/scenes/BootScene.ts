import Phaser from 'phaser';
import { GAME_CONFIG } from '../engine/constants';
import { Rng } from '../utils/Rng';
import { createBootedLifecycle } from '../input/BindingsPersistenceLifecycle';
import { BOOT_REGISTRY_KEYS, type BootFeatureFlags } from './bootKeys';

// Re-export so existing imports from BootScene keep working.
export { BOOT_REGISTRY_KEYS };
export type { BootFeatureFlags };

/**
 * BootScene runs once at startup. It owns three responsibilities:
 *
 *   1. Preload **core assets** — UI primitives (1x1 white pixel, loader
 *      dot) generated procedurally so PreloadScene can draw a real
 *      progress bar and the main menu can tint rectangles without
 *      depending on the heavier asset pack that PreloadScene loads later.
 *
 *   2. Initialise **engine systems** — freeze the engine constants, build
 *      a deterministic shared {@link Rng} seeded from
 *      `GAME_CONFIG.defaultRngSeed`, capture browser feature flags, and
 *      expose all of it via `this.registry` so any downstream scene can
 *      read it with one lookup.
 *
 *   3. Transition to the next scene (`PreloadScene`).
 *
 * Determinism note: nothing this scene puts in the registry uses
 * `Math.random()`. The RNG here is a Mulberry32 seeded from a fixed
 * constant, which is what AI / hazards / particle jitter must read from.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  // ---------------------------------------------------------------------
  // Phaser lifecycle
  // ---------------------------------------------------------------------

  preload(): void {
    this.generateCoreTextures();
  }

  create(): void {
    this.initialiseEngineSystems();
    this.transitionToNext();
  }

  // ---------------------------------------------------------------------
  // 1. Core assets
  // ---------------------------------------------------------------------

  /**
   * Generate the tiny set of textures every scene relies on, even before
   * PreloadScene has fetched its asset pack.
   *
   * - `whitePixelKey`: a 1×1 pure-white texture that the engine tints to
   *   draw flat-colour rectangles, hitbox debug overlays, and screen
   *   flashes without spawning a new Graphics object every frame.
   * - `loaderDotKey`: a 12 px filled circle used by PreloadScene's
   *   progress indicator.
   *
   * Generating these in BootScene means every other scene can assume they
   * exist at `create()` time. They are intentionally procedural so the
   * scaffold has no external file dependency before the asset pipeline
   * lands in a later milestone.
   */
  // procedural fallback — UI-primitive textures synthesised at boot via
  // Phaser Graphics + generateTexture (Seed v1 art-priority rule §FALLBACK).
  // No real sprite frames ship for these primitives because they are
  // tinted/scaled on demand at the call site (HUD flashes, hitbox debug
  // overlays, the loader dot). Replace by registering matching textures
  // in `assets/manifest.ts` and removing the generators here.
  private generateCoreTextures(): void {
    const tm = this.textures;

    if (!tm.exists(BOOT_REGISTRY_KEYS.whitePixelKey)) {
      // procedural fallback — 1×1 white pixel synthesised in code.
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0xffffff, 1);
      g.fillRect(0, 0, 1, 1);
      g.generateTexture(BOOT_REGISTRY_KEYS.whitePixelKey, 1, 1);
      g.destroy();
    }

    if (!tm.exists(BOOT_REGISTRY_KEYS.loaderDotKey)) {
      // procedural fallback — 12 px filled circle synthesised in code.
      const size = 12;
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0x6cf0c2, 1);
      g.fillCircle(size / 2, size / 2, size / 2);
      g.generateTexture(BOOT_REGISTRY_KEYS.loaderDotKey, size, size);
      g.destroy();
    }
  }

  // ---------------------------------------------------------------------
  // 2. Engine systems
  // ---------------------------------------------------------------------

  /**
   * Wire up the engine-level state that every gameplay scene depends on:
   *
   * - Freeze a copy of `GAME_CONFIG` into the registry so accidental
   *   mutation would be loud (frozen → throws in strict mode).
   * - Construct the shared deterministic RNG from `defaultRngSeed`.
   * - Detect WebGL / Gamepad API / Web Audio support.
   * - Pre-capture common gameplay keys so the browser never steals e.g.
   *   Space/Arrow keys via its default scrolling behaviour.
   */
  private initialiseEngineSystems(): void {
    // ---- engine config snapshot ---------------------------------------
    const engineConfig = Object.freeze({ ...GAME_CONFIG });
    this.registry.set(BOOT_REGISTRY_KEYS.engineConfig, engineConfig);

    // ---- deterministic shared RNG -------------------------------------
    // Seeded from a constant so a fresh boot always produces the same
    // pseudo-random stream — required by the replay system.
    const seed = GAME_CONFIG.defaultRngSeed;
    this.registry.set(BOOT_REGISTRY_KEYS.rngSeed, seed);
    this.registry.set(BOOT_REGISTRY_KEYS.rng, new Rng(seed));

    // ---- feature detection --------------------------------------------
    const features: BootFeatureFlags = Object.freeze({
      webgl: this.detectWebGl(),
      gamepadApi: typeof navigator !== 'undefined' && 'getGamepads' in navigator,
      webAudio:
        typeof window !== 'undefined' &&
        ('AudioContext' in window ||
          'webkitAudioContext' in (window as unknown as Record<string, unknown>)),
      highResTimer: typeof performance !== 'undefined' && typeof performance.now === 'function',
    });
    this.registry.set(BOOT_REGISTRY_KEYS.features, features);

    // ---- input pre-capture --------------------------------------------
    // Stops the browser scrolling the page when gameplay keys are held.
    // Doing this once here saves every gameplay scene from re-registering
    // the same captures and keeps the input layer authoritative over
    // Space / Arrow keys before the menu even loads.
    const kb = this.input.keyboard;
    if (kb) {
      kb.addCapture([
        Phaser.Input.Keyboard.KeyCodes.SPACE,
        Phaser.Input.Keyboard.KeyCodes.UP,
        Phaser.Input.Keyboard.KeyCodes.DOWN,
        Phaser.Input.Keyboard.KeyCodes.LEFT,
        Phaser.Input.Keyboard.KeyCodes.RIGHT,
        Phaser.Input.Keyboard.KeyCodes.W,
        Phaser.Input.Keyboard.KeyCodes.A,
        Phaser.Input.Keyboard.KeyCodes.S,
        Phaser.Input.Keyboard.KeyCodes.D,
        Phaser.Input.Keyboard.KeyCodes.ENTER,
        Phaser.Input.Keyboard.KeyCodes.ESC,
        Phaser.Input.Keyboard.KeyCodes.TAB,
      ]);
    }

    // ---- input-bindings persistence lifecycle (AC 40301 Sub-AC 1) -----
    //
    // Build the unified lifecycle that owns hydrate-on-boot,
    // auto-save-on-change, schema versioning, and migration fallback for
    // invalid / legacy data. The `bootOnConstruct` flag (via the
    // `createBootedLifecycle` factory) reads any saved blob off
    // `localStorage` and seeds the inner store *before* any downstream
    // scene constructs its own — exactly as the prior `createHydratedBindingsStore`
    // helper did, but now the same handle also exposes `setBinding` /
    // `setAction` / `reset` / `clear` with auto-save baked in, so the
    // rebinding UI no longer has to remember to call `saveAll()` after
    // each commit.
    //
    // Both registry keys are populated:
    //   • `bindingsLifecycle` — the AC-40301 lifecycle facade (new code
    //     should prefer this entry).
    //   • `inputBindingsStore` — the underlying `InputBindingsStore` so
    //     existing scenes that hold the legacy direct-store API
    //     (the device input dispatcher, the M1 keyboard handler) keep
    //     working unchanged.
    const { lifecycle, hydrate: bindingsHydrate } = createBootedLifecycle();
    this.registry.set(BOOT_REGISTRY_KEYS.bindingsLifecycle, lifecycle);
    this.registry.set(BOOT_REGISTRY_KEYS.inputBindingsStore, lifecycle.getStore());

    // ---- boot-complete flags ------------------------------------------
    this.registry.set(BOOT_REGISTRY_KEYS.booted, true);
    this.registry.set(BOOT_REGISTRY_KEYS.startedAt, performance.now());

    // One-line console banner — useful when triaging a Chrome session.
    // Intentionally a single line so it doesn't clutter the dev console
    // during hot-reloads.
    // eslint-disable-next-line no-console
    console.info(
      `[boot] engine ready • seed=${seed.toString(16)} • ${engineConfig.targetFps}fps • ` +
        `webgl=${features.webgl} gamepad=${features.gamepadApi} audio=${features.webAudio} ` +
        `bindings=${bindingsHydrate.source}`,
    );
  }

  /**
   * Tiny WebGL probe. Used at boot only so the rest of the engine can
   * branch on `features.webgl` without poking the DOM later.
   */
  private detectWebGl(): boolean {
    try {
      const canvas = document.createElement('canvas');
      const ctx =
        canvas.getContext('webgl2') ||
        canvas.getContext('webgl') ||
        canvas.getContext('experimental-webgl');
      return !!ctx;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------
  // 3. Transition
  // ---------------------------------------------------------------------

  private transitionToNext(): void {
    this.scene.start('PreloadScene');
  }
}
