import Phaser from 'phaser';
import {
  ASSET_MANIFEST,
  type AssetEntry,
  type AssetManifest,
} from '../assets/manifest';

/**
 * PreloadScene is responsible for loading every static asset the
 * game needs before gameplay starts (character spritesheets, stage
 * tile atlases, SFX, music). It walks the central
 * {@link ASSET_MANIFEST} so cache keys and file paths live in one
 * place — see `src/assets/manifest.ts` for the contract.
 *
 * The progress bar is rendered with a {@link Phaser.GameObjects.Graphics}
 * primitive (per AC 10103 Sub-AC 3) so it has zero texture dependencies
 * and can be redrawn cheaply every time the loader fires `progress`.
 */
export class PreloadScene extends Phaser.Scene {
  /** Track size + position so the `progress` handler can repaint without recomputing. */
  private static readonly BAR_HEIGHT = 8;
  private static readonly BAR_TRACK_COLOR = 0x2a2a3c;
  private static readonly BAR_FILL_COLOR = 0x6cf0c2;

  /**
   * Scene key the create() handoff jumps to once the loader fires
   * `complete`. Pulled out as a named constant so the boot chain
   * (Boot → Preload → MainMenu) is greppable from one place — if
   * MainMenuScene is ever renamed, this is the only edit that has
   * to follow.
   */
  private static readonly NEXT_SCENE_KEY = 'MainMenuScene';

  /**
   * Live references to the two progress-bar graphics so `create()` can
   * tear them down deterministically before transitioning. The `complete`
   * event fires before `create()` so these are normally already destroyed
   * by then — we keep the handles to make cleanup idempotent and to give
   * `create()` an authoritative "no leaked draw-list nodes" guarantee.
   */
  private progressTrack: Phaser.GameObjects.Graphics | null = null;
  private progressFill: Phaser.GameObjects.Graphics | null = null;

  constructor() {
    super({ key: 'PreloadScene' });
  }

  preload(): void {
    this.drawProgressBar();
    this.queueManifest(ASSET_MANIFEST);
  }

  /**
   * Phaser invokes `create()` after every queued asset has loaded
   * (the loader fires `complete` immediately before this runs). At
   * this point the responsibilities are, in order:
   *
   *   1. Tear down the progress bar so the next scene's draw list
   *      starts clean — the bar's `complete` listener already runs
   *      on the same tick, but we re-call it here so cleanup is
   *      idempotent and survives any future refactor that moves
   *      the bar's lifetime out from under the loader event.
   *   2. Verify the next-scene key is registered (catch typos /
   *      missing entries in `SCENES` eagerly instead of leaving
   *      the player on a frozen loader screen).
   *   3. Hand off to `MainMenuScene` via `this.scene.start(...)`.
   *      The literal scene key is kept inline (rather than hidden
   *      behind a constant) so the boot chain is greppable from
   *      one place.
   */
  create(): void {
    this.destroyProgressBar();

    // Sanity-check that the next scene is registered. If someone removed
    // MainMenuScene from `SCENES` in `GameConfig.ts` we want a loud
    // console error, not a silent freeze on the loader screen.
    if (!this.scene.manager.keys[PreloadScene.NEXT_SCENE_KEY]) {
      // eslint-disable-next-line no-console
      console.error(
        `[PreloadScene] next scene "${PreloadScene.NEXT_SCENE_KEY}" is not ` +
          `registered — check SCENES in src/engine/GameConfig.ts`,
      );
      return;
    }

    this.scene.start('MainMenuScene');
  }

  // -------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------

  /**
   * Render a graphics-based progress bar that tracks the Phaser loader.
   *
   * Implementation notes:
   *   - Uses `this.add.graphics()` (a `Phaser.GameObjects.Graphics`
   *     primitive) so the scaffold has no texture dependency.
   *   - The static dark "track" is drawn once. The bright "fill" is
   *     redrawn on every `progress` event by clearing the fill graphics
   *     and re-issuing a `fillRect` proportional to `value ∈ [0, 1]`.
   *   - The handles are stashed on `this.progressTrack` / `this.progressFill`
   *     so `create()` can tear them down deterministically. The `complete`
   *     event listener also calls `destroyProgressBar()` to keep behaviour
   *     identical for callers that observe the bar's lifetime via the
   *     loader event rather than the scene lifecycle.
   */
  // procedural fallback — loader progress bar synthesised at runtime via
  // Phaser Graphics primitives (no sprite frames). Bar exists before
  // PreloadScene has finished loading any external textures, so it MUST
  // remain procedural; do not migrate to a texture-backed implementation.
  private drawProgressBar(): void {
    const { width, height } = this.scale.gameSize;
    const barWidth = Math.min(640, width * 0.5);
    const barHeight = PreloadScene.BAR_HEIGHT;
    const cx = width / 2;
    const cy = height / 2;
    const left = cx - barWidth / 2;
    const top = cy - barHeight / 2;

    // Track — drawn once, never updated.
    const track = this.add.graphics();
    track.fillStyle(PreloadScene.BAR_TRACK_COLOR, 1);
    track.fillRect(left, top, barWidth, barHeight);
    this.progressTrack = track;

    // Fill — repainted on every `progress` event.
    const fill = this.add.graphics();
    this.progressFill = fill;

    this.load.on('progress', (value: number) => {
      // `value` is 0..1; clamp defensively in case Phaser ever overshoots.
      const clamped = Math.max(0, Math.min(1, value));
      fill.clear();
      fill.fillStyle(PreloadScene.BAR_FILL_COLOR, 1);
      fill.fillRect(left, top, barWidth * clamped, barHeight);
    });

    this.load.on('complete', () => {
      this.destroyProgressBar();
    });

    // Surface per-file loader errors so silent failures (404, decode
    // error, MIME mismatch) don't disappear into the console.  Without
    // this, a missing or corrupt asset only manifests downstream as
    // "asset key not in cache" — which makes diagnosis miserable.
    this.load.on(
      'loaderror',
      (file: { key?: string; src?: string; type?: string }) => {
        // eslint-disable-next-line no-console
        console.error(
          `[PreloadScene] loaderror — key='${file.key ?? '?'}' type='${file.type ?? '?'}' src='${file.src ?? '?'}'`,
        );
      },
    );
  }

  /**
   * Destroy both progress-bar graphics objects and null the references.
   * Idempotent — safe to call from both the loader's `complete` event
   * and again from `create()` (Sub-AC 4 cleanup contract).
   */
  private destroyProgressBar(): void {
    if (this.progressFill) {
      this.progressFill.destroy();
      this.progressFill = null;
    }
    if (this.progressTrack) {
      this.progressTrack.destroy();
      this.progressTrack = null;
    }
  }

  /**
   * Walk the manifest and dispatch each entry to the matching Phaser
   * loader call. The dispatch is exhaustive on {@link AssetEntry}'s
   * discriminant so adding a new {@link AssetKind} is a TS compile
   * error here until it's wired up.
   */
  private queueManifest(manifest: AssetManifest): void {
    const all: readonly AssetEntry[] = [
      ...manifest.images,
      ...manifest.spritesheets,
      ...manifest.atlases,
      ...manifest.audio,
      ...manifest.music,
    ];

    for (const entry of all) {
      // Phaser's loader is idempotent on duplicate keys (it warns and
      // skips), but we guard against re-queueing on hot-reload anyway —
      // PreloadScene runs once but Vite HMR can re-enter it during dev.
      if (this.textures.exists(entry.key) || this.cache.audio.exists(entry.key)) {
        continue;
      }

      switch (entry.kind) {
        case 'image':
          this.load.image(entry.key, entry.url);
          break;
        case 'spritesheet':
          this.load.spritesheet(entry.key, entry.url, {
            frameWidth: entry.frameWidth,
            frameHeight: entry.frameHeight,
            ...(entry.margin !== undefined ? { margin: entry.margin } : {}),
            ...(entry.spacing !== undefined ? { spacing: entry.spacing } : {}),
          });
          break;
        case 'atlas':
          this.load.atlas(entry.key, entry.textureUrl, entry.jsonUrl);
          break;
        case 'audio':
        case 'music':
          // Phaser accepts a string[] for fallback formats.
          this.load.audio(entry.key, [...entry.urls]);
          break;
      }
    }
  }
}
