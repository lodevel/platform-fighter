/**
 * Runtime palette-swap renderer — AC 20302 Sub-AC 2.
 *
 * --------------------------------------------------------------------
 * What this module does
 * --------------------------------------------------------------------
 *
 * The Seed promises "8 manual palette swaps per character via hue-shift
 * batch script" plus "Same-character selection allowed with palette
 * swap differentiation". Two complementary modules already ship the
 * primitives:
 *
 *   • `PaletteSwapRenderer.ts` — builds the `(primary, accent, label)`
 *     colour record from a `(characterId, paletteIndex)` tuple and
 *     paints it onto a flat-colour `Phaser.GameObjects.Rectangle` /
 *     `Triangle` via `setFillStyle` / `setStrokeStyle`.
 *
 *   • `paletteSwapShader.ts` — generates the GLSL fragment shader,
 *     installs a Phaser WebGL pipeline, and exposes a
 *     `applyPaletteSwapToSprite()` helper that picks pipeline-vs-tint
 *     per sprite based on what methods the target exposes.
 *
 * What was missing — and what this module ships — is a single runtime
 * façade that scenes can drop in to "paint this fighter (or preview
 * tile) with the palette assigned to its slot" in **one** call,
 * regardless of whether the visuals are placeholder rectangles, real
 * sprites, or a mix of the two; whether the renderer is WebGL or
 * canvas; and whether the call site is the character-select preview
 * tile or the live in-match fighter.
 *
 * --------------------------------------------------------------------
 * Why a single façade
 * --------------------------------------------------------------------
 *
 *   1. **One call site, two contexts.** The character-select preview
 *      tile (`CharacterSelectScene`) and the in-match fighter
 *      (`MatchScene`) both want "apply slot N's palette to these visual
 *      objects right now." Without a façade each scene reaches into
 *      `PaletteSwapRenderer` and `paletteSwapShader` separately and the
 *      two paths drift — a palette tweak that lands in `palettes.ts`
 *      should ripple through both views without grepping for
 *      `applyPaletteSwap` and `applyPaletteSwapPipeline` in turn.
 *
 *   2. **Idempotent re-paint.** A fighter's palette never changes
 *      mid-match (selection-time concern, not runtime), so the live
 *      render hook called every frame should *not* re-upload uniforms
 *      / re-issue `setFillStyle` calls when nothing has changed since
 *      the last frame. The façade caches the last-painted swap per
 *      target group so the steady-state cost of the per-frame call is
 *      a single `paletteSwapEqual` compare.
 *
 *   3. **Lazy WebGL pipeline install.** The shader pipeline can only be
 *      installed once a Phaser game has a WebGL renderer — too early
 *      (in the boot path before WebGL exists) and the install no-ops;
 *      too late (per frame) and we burn CPU. The façade installs the
 *      pipeline exactly once on first use and remembers the result so
 *      subsequent paints can skip the check.
 *
 *   4. **Graceful canvas fallback.** When the renderer doesn't expose
 *      WebGL pipelines (canvas mode, headless tests), the façade
 *      automatically routes sprite targets through the `setTint`
 *      fallback in `paletteSwapShader.ts` — preview and in-match views
 *      degrade identically, so a player on a low-end laptop sees the
 *      same colour assignment as a player on a WebGL-capable rig.
 *
 * --------------------------------------------------------------------
 * Determinism contract
 * --------------------------------------------------------------------
 *
 * The façade is render-only — it never feeds back into the simulation.
 * Every public function is a pure projection of its inputs onto a
 * frozen output (the `RuntimePaletteRenderer` instance owns a tiny
 * memo cache that is itself deterministic given the input call
 * sequence). Replays produced before this module landed continue to
 * play back identically because the façade does not consume any
 * simulation state and does not advance any RNG.
 *
 * --------------------------------------------------------------------
 * What this module deliberately does NOT do
 * --------------------------------------------------------------------
 *
 *   • Pick the palette index for a slot. That's a selection-time
 *     concern handled in `characterSelect.ts` — by the time a slot
 *     reaches this façade, `paletteIndex` is final.
 *
 *   • Animate / tween between palettes. A single call paints the new
 *     palette instantaneously; if a future feature wants a "palette
 *     flicker" effect, it can wrap `paint()` with a tween.
 *
 *   • Compute palette colours from raw HSV. That's the `palettes.ts`
 *     table's job; this module reads pre-baked colour records.
 */

import type { PlayerSlot } from '../types';
import {
  applyPaletteSwap,
  paletteSwapEqual,
  paletteSwapForSlot,
  paletteSwapForCharacter,
  type ApplyPaletteSwapOptions,
  type FighterPaletteTargets,
  type PaletteSwap,
  type PaletteSwapTarget,
} from './PaletteSwapRenderer';
import {
  applyPaletteSwapPipeline,
  applyPaletteSwapTintFallback,
  buildPaletteRemap,
  installPaletteSwapPipeline,
  paletteRemapEqual,
  type PaletteShaderGame,
  type PaletteShaderTarget,
  type PaletteSwapRemap,
} from './paletteSwapShader';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Combined render-target struct the runtime renderer accepts.
 *
 * Mirrors `FighterPaletteTargets` (rectangle / facing-mark / aux
 * sprite) but adds an explicit `sprite` slot — the *primary* sprite
 * that the shader pipeline / tint fallback paints. Keeping the two
 * concepts distinct lets a scene wire BOTH (rect for the placeholder
 * + sprite for the atlas drop-in) without ambiguity:
 *
 *   • `body` / `facingMark` / `auxSprite` flow into the rectangle
 *     `applyPaletteSwap` call (flat-colour pipeline).
 *
 *   • `sprite` flows into the shader pipeline (or its tint fallback
 *     when WebGL is unavailable).
 *
 * Every field is optional — an "early M1" call site might pass only
 * `body` + `facingMark`; the M-future "atlas-only" path might pass only
 * `sprite`. The façade calls whichever helpers are appropriate for the
 * targets it sees.
 */
export interface RuntimePaletteTargets extends FighterPaletteTargets {
  /**
   * Primary sprite — drives the palette-swap shader pipeline (or its
   * tint fallback). This is the field a sprite-atlas drop-in fills in
   * once art is wired; absent for the placeholder-rectangle-only path.
   */
  readonly sprite?: PaletteShaderTarget;
}

/**
 * Tunables for a single paint call. Forwarded to the underlying
 * `applyPaletteSwap` helper for the rectangle pipeline; the shader
 * pipeline reads its tolerance from this struct as well so all paint
 * options live in one place.
 */
export interface RuntimePaletteOptions extends ApplyPaletteSwapOptions {
  /**
   * Per-channel float tolerance forwarded to `buildPaletteRemap`. Lets
   * the caller widen the colour-match band for an anti-aliased atlas;
   * defaults to `0` (exact match) which suits the flat-colour atlases
   * the M1.5 content pipeline ships.
   */
  readonly shaderTolerance?: number;
}

/**
 * Per-call tally returned by `paint` — useful for tests and debug
 * HUDs that want to assert exactly what the call did. The numbers
 * count *attempted* operations; a sprite that lacks `setPipeline`
 * still increments `tints` if the tint fallback fires, and the
 * rectangle pipeline's fill / stroke counts come straight from
 * `applyPaletteSwap`.
 */
export interface RuntimePaletteOpsCount {
  /** `setFillStyle` calls performed by the rectangle pipeline. */
  readonly fills: number;
  /** `setStrokeStyle` calls performed by the rectangle pipeline. */
  readonly strokes: number;
  /** `setTint` calls performed (rect aux sprites + shader-fallback). */
  readonly tints: number;
  /** `1` if the shader pipeline was applied this call, `0` otherwise. */
  readonly pipelineApplied: number;
  /** `1` if the call short-circuited because the cache matched, `0` otherwise. */
  readonly cacheHits: number;
}

/**
 * Result returned by `paint`. Echoes the swap that was painted and the
 * remap descriptor the shader path consumed (or would have consumed in
 * a tint-fallback scenario), plus the operation tally.
 */
export interface RuntimePaletteResult {
  readonly swap: PaletteSwap;
  readonly remap: PaletteSwapRemap;
  readonly ops: RuntimePaletteOpsCount;
  /**
   * Path the sprite (if any) took. `'none'` when no sprite was
   * provided OR the sprite exposes neither `setPipeline` nor
   * `setTint`.
   */
  readonly spritePath: 'pipeline' | 'tint' | 'none';
}

// ---------------------------------------------------------------------------
// RuntimePaletteRenderer
// ---------------------------------------------------------------------------

/**
 * Per-call cache key — opaque string identifying which "target group"
 * is being painted. The character-select preview's slot tiles use one
 * key per slot index (`'preview-1'` … `'preview-4'`); the match scene
 * uses one key per active fighter (`'fighter-1'` … `'fighter-4'`).
 * Callers are free to pick any string; the façade just compares
 * `paletteSwapEqual` against the last value stored under the key.
 */
export type RuntimePaletteCacheKey = string;

interface CacheEntry {
  readonly swap: PaletteSwap;
  readonly remap: PaletteSwapRemap;
}

/**
 * Pipeline-installation surface — a tiny interface naming exactly the
 * methods the runtime renderer needs to register the WebGL pipeline.
 * Mirrors the structural type already exported by `paletteSwapShader.ts`
 * so a Phaser `Game` flows in untyped via duck typing AND a unit-test
 * stub can fulfil the same shape with a hand-rolled mock.
 */
export type RuntimePaletteGame = PaletteShaderGame;

/**
 * Optional pipeline factory the renderer calls once on first use to
 * register the GLSL shader pipeline with Phaser. The default factory
 * (when `null` is passed) does nothing — sprite targets fall through
 * to the `setTint` fallback. Callers who want the real shader path
 * pass a factory that constructs a Phaser PostFX pipeline subclass.
 */
export type RuntimePalettePipelineFactory = (() => unknown) | null;

/**
 * Runtime palette renderer instance. Holds the lazy-install state,
 * the per-key memo cache, and the configured pipeline factory.
 *
 * Construction is cheap (no Phaser calls) so a scene can build one in
 * its `create()` method and keep it on `this`. Destruction is implicit
 * — the renderer holds no Phaser resources of its own; the pipeline
 * it registers stays attached to the game's renderer for the rest of
 * the session.
 *
 * Thread-safety: single-threaded by design (matches Phaser's main loop).
 * Determinism: see module-level "Determinism contract".
 */
export class RuntimePaletteRenderer {
  private readonly cache = new Map<RuntimePaletteCacheKey, CacheEntry>();

  private pipelineInstalled = false;

  private pipelineInstallAttempted = false;

  constructor(
    private readonly game: RuntimePaletteGame | null = null,
    private readonly pipelineFactory: RuntimePalettePipelineFactory = null,
  ) {}

  /**
   * Has the WebGL pipeline been installed (true) or did the lazy
   * install bail (false)? Useful for diagnostic panels and tests.
   */
  isPipelineInstalled(): boolean {
    return this.pipelineInstalled;
  }

  /**
   * Drop the per-key cache. Call this on scene-shutdown so a fresh
   * scene-start re-paints from scratch instead of short-circuiting on
   * a stale cache entry that points at a destroyed Phaser GameObject.
   */
  resetCache(): void {
    this.cache.clear();
  }

  /**
   * Drop just one cache key. Useful when a single slot is rebuilt
   * (e.g. respawn replacing the fighter sprite) without invalidating
   * the other slots' cache entries.
   */
  invalidateCacheKey(key: RuntimePaletteCacheKey): void {
    this.cache.delete(key);
  }

  /**
   * Paint a player slot's palette onto a target group.
   *
   *   1. Resolve the swap from `(characterId, paletteIndex)`.
   *   2. Build the shader remap descriptor (cheap; cached against
   *      the swap so the next call with the same slot reuses it).
   *   3. Lazy-install the WebGL pipeline on first use.
   *   4. Compare against the cache for `cacheKey`; bail with a no-op
   *      when the same swap was painted last time.
   *   5. Otherwise: paint rectangle targets via `applyPaletteSwap`,
   *      paint the sprite target via shader pipeline (or tint
   *      fallback), update the cache.
   *
   * Returns a result struct describing what was painted; ignored by
   * the live render hook but consumed by tests and the debug HUD.
   */
  paint(
    cacheKey: RuntimePaletteCacheKey,
    targets: RuntimePaletteTargets,
    slot:
      | PlayerSlot
      | {
          readonly index: 1 | 2 | 3 | 4;
          readonly characterId: PlayerSlot['characterId'];
          readonly paletteIndex: number;
        },
    options: RuntimePaletteOptions = {},
  ): RuntimePaletteResult {
    const swap = isPlayerSlot(slot)
      ? paletteSwapForSlot(slot)
      : paletteSwapForCharacter(slot.index, slot.characterId, slot.paletteIndex);
    const remap = buildPaletteRemap(swap, {
      tolerance: options.shaderTolerance ?? 0,
    });

    // ---- Cache short-circuit ------------------------------------------
    const cached = this.cache.get(cacheKey);
    if (
      cached !== undefined &&
      paletteSwapEqual(cached.swap, swap) &&
      paletteRemapEqual(cached.remap, remap)
    ) {
      return Object.freeze({
        swap,
        remap,
        ops: Object.freeze({
          fills: 0,
          strokes: 0,
          tints: 0,
          pipelineApplied: 0,
          cacheHits: 1,
        }),
        spritePath: 'none' as const,
      });
    }

    // ---- Lazy pipeline install ----------------------------------------
    this.ensurePipelineInstalled();

    // ---- Rectangle pipeline -------------------------------------------
    // `applyPaletteSwap` is a no-op when none of `body` / `facingMark` /
    // `auxSprite` are present — calling it unconditionally keeps the
    // call-site simple and the cost is one method-presence check.
    const rectOps = applyPaletteSwap(
      {
        body: targets.body,
        facingMark: targets.facingMark,
        auxSprite: targets.auxSprite,
      },
      swap,
      options,
    );

    // ---- Shader / tint pipeline ---------------------------------------
    let spritePath: 'pipeline' | 'tint' | 'none' = 'none';
    let pipelineApplied = 0;
    let shaderTints = 0;
    if (targets.sprite) {
      if (this.pipelineInstalled && applyPaletteSwapPipeline(targets.sprite, remap)) {
        spritePath = 'pipeline';
        pipelineApplied = 1;
      } else if (applyPaletteSwapTintFallback(targets.sprite, remap)) {
        spritePath = 'tint';
        shaderTints = 1;
      }
    }

    // ---- Cache update -------------------------------------------------
    this.cache.set(cacheKey, { swap, remap });

    return Object.freeze({
      swap,
      remap,
      ops: Object.freeze({
        fills: rectOps.fills,
        strokes: rectOps.strokes,
        tints: rectOps.tints + shaderTints,
        pipelineApplied,
        cacheHits: 0,
      }),
      spritePath,
    });
  }

  // --------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------

  private ensurePipelineInstalled(): void {
    if (this.pipelineInstallAttempted) return;
    this.pipelineInstallAttempted = true;
    if (!this.game || !this.pipelineFactory) {
      // No game / factory → tint fallback path only. Mark as attempted
      // so we don't waste cycles re-checking on every frame.
      this.pipelineInstalled = false;
      return;
    }
    this.pipelineInstalled = installPaletteSwapPipeline(
      this.game,
      this.pipelineFactory,
    );
  }
}

// ---------------------------------------------------------------------------
// Convenience: module-scope singleton
// ---------------------------------------------------------------------------

let defaultRenderer: RuntimePaletteRenderer | null = null;

/**
 * Get (or lazily construct) the module-scope default
 * `RuntimePaletteRenderer`. Useful for ad-hoc call sites — e.g. the
 * results screen painting a banner — that don't want to thread their
 * own renderer instance through the scene tree.
 *
 * Tests that need a clean slate call `resetDefaultRuntimePaletteRenderer()`
 * in `beforeEach` so a previous test's cache doesn't leak.
 */
export function getDefaultRuntimePaletteRenderer(): RuntimePaletteRenderer {
  if (defaultRenderer === null) {
    defaultRenderer = new RuntimePaletteRenderer();
  }
  return defaultRenderer;
}

/**
 * Reconfigure the module-scope default renderer with a real Phaser
 * game + pipeline factory. Idempotent — calling twice with the same
 * args is harmless. Used by `BootScene` (or the first scene that has
 * a renderer) to wire up the real WebGL path.
 */
export function configureDefaultRuntimePaletteRenderer(
  game: RuntimePaletteGame,
  pipelineFactory: RuntimePalettePipelineFactory,
): RuntimePaletteRenderer {
  defaultRenderer = new RuntimePaletteRenderer(game, pipelineFactory);
  return defaultRenderer;
}

/**
 * Drop the module-scope default renderer so the next
 * `getDefaultRuntimePaletteRenderer()` call returns a fresh one.
 * Test helper — production code should not need to call this.
 */
export function resetDefaultRuntimePaletteRenderer(): void {
  defaultRenderer = null;
}

// ---------------------------------------------------------------------------
// One-shot convenience entrypoints
// ---------------------------------------------------------------------------

/**
 * One-shot "paint this fighter, don't bother with caching" call.
 * Routes through a fresh `RuntimePaletteRenderer` so the call has no
 * cross-call state — useful for ad-hoc tests and for the lobby
 * background tile that paints once per scene-create.
 */
export function paintFighterPalette(
  targets: RuntimePaletteTargets,
  slot:
    | PlayerSlot
    | {
        readonly index: 1 | 2 | 3 | 4;
        readonly characterId: PlayerSlot['characterId'];
        readonly paletteIndex: number;
      },
  options: RuntimePaletteOptions = {},
): RuntimePaletteResult {
  const renderer = new RuntimePaletteRenderer();
  return renderer.paint('one-shot', targets, slot, options);
}

/**
 * Build the `PaletteSwapTarget` view of a Phaser GameObject by
 * forwarding the four method handles (`setFillStyle` / `setStrokeStyle`
 * / `setTint` / `clearTint`) we actually use. Useful when a caller
 * wants to wrap a Phaser object that has extra methods beyond the
 * palette contract (e.g. a `Container` with children that should not
 * receive the palette tint) without leaking the unrelated surface
 * area into the renderer.
 */
export function asPaletteSwapTarget<T extends PaletteSwapTarget>(
  obj: T,
): PaletteSwapTarget {
  return {
    setFillStyle: obj.setFillStyle?.bind(obj),
    setStrokeStyle: obj.setStrokeStyle?.bind(obj),
    setTint: obj.setTint?.bind(obj),
    clearTint: obj.clearTint?.bind(obj),
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function isPlayerSlot(value: unknown): value is PlayerSlot {
  return (
    typeof value === 'object' &&
    value !== null &&
    'inputType' in (value as Record<string, unknown>)
  );
}
