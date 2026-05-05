/**
 * Palette swap shader / tint system — Sub-AC 1 of AC 10301.
 *
 * --------------------------------------------------------------------
 * What this module solves
 * --------------------------------------------------------------------
 *
 * The Seed promises "8 manual palette swaps per character via hue-shift
 * batch script". Sub-AC 2 of AC 13 (`palettes.ts`) ships the colour
 * data; Sub-AC 3 of AC 13 (`PaletteSwapRenderer.ts`) paints those
 * colours onto a flat-colour Phaser `Rectangle` via `setFillStyle`. The
 * rectangle pipeline works because there is exactly **one** colour to
 * swap — the rectangle's fill.
 *
 * Once real sprite atlases land, that "one colour" assumption breaks.
 * A real sprite has **multiple** authored colours per pixel:
 *
 *   • body fur fill                             (the "primary" colour)
 *   • outline / detail strokes                  (the "accent" colour)
 *   • optional highlight / specular pixels      (a derived colour)
 *
 * `setTint` cannot solve this — it multiplies *every* pixel by a single
 * uniform RGB, which tints the outline the same colour as the body and
 * destroys the contrast that makes a sprite legible at 60 px tall.
 *
 * The fix is a **palette-key remap shader**: a fragment shader that
 * looks at each pixel, compares it against the character's known
 * "source palette" (the colours actually present in the canonical atlas
 * — typically 2-4 distinct hues), and substitutes the matching entry
 * from the target palette. Pixels that don't match any source slot
 * pass through unchanged so transparent edges and shared outlines stay
 * intact across all 8 swaps.
 *
 * This module ships that remap pipeline in three layers:
 *
 *   1. **Pure colour-remap helpers** (Phaser-free, deterministic) —
 *      `remapPixel`, `remapImageData`, `buildPaletteRemap`. They take a
 *      `PaletteSwap` (from `PaletteSwapRenderer`) plus a per-character
 *      source palette and produce the destination pixel/image. Unit-
 *      testable under plain Node and used by the Canvas-renderer
 *      fallback for browsers that block WebGL.
 *
 *   2. **Per-character source palette table** — names the canonical
 *      slot colours each character's atlas paints with (body / accent /
 *      highlight). The hue-shift batch script that generates the 8
 *      palette atlases reads exactly this table to know which pixels
 *      to recolour, so the runtime remap and the build-time generator
 *      stay in lockstep.
 *
 *   3. **Phaser WebGL pipeline factory** — generates the GLSL fragment
 *      shader source string and exposes a `Phaser.Pipeline` subclass
 *      factory + per-sprite installer. The factory accepts a
 *      `PaletteSwap` and pushes the source/destination uniforms into
 *      the shader so the same shader instance can drive all four
 *      players (one uniform set per call).
 *
 * --------------------------------------------------------------------
 * Why not just `setTint` for v1?
 * --------------------------------------------------------------------
 *
 *   • `setTint` multiplies — a darker pixel stays proportionally darker.
 *     With a hue-shifted palette that's correct only when the source
 *     palette is monochromatic. Real sprites have white highlights and
 *     black outlines that should stay white / black across swaps; the
 *     multiplicative tint would dye them red on a Crimson swap and ruin
 *     the silhouette.
 *
 *   • A 2-colour minimum (body + accent) means the swap **must** know
 *     which pixels are which slot. `setTint` cannot make that
 *     distinction because it operates per pixel without context. A
 *     palette-key shader can.
 *
 *   • Determinism: the shader is stateless (no per-frame uniform feed-
 *     back; the remap config is uploaded once when the sprite mounts).
 *     The same atlas + the same `PaletteSwap` always renders the same
 *     pixels, byte-for-byte. The pure-helper path proves this without a
 *     GPU dependency.
 *
 * --------------------------------------------------------------------
 * Determinism contract
 * --------------------------------------------------------------------
 *
 * Every public function in this module is a pure projection of its
 * inputs onto a frozen output. No `Math.random()`, no wall-clock, no
 * environment lookup. The shader source generator emits the same string
 * for the same `numSlots`. The pipeline-install path is render-only and
 * never feeds back into the simulation.
 *
 * --------------------------------------------------------------------
 * Composition with the existing `PaletteSwapRenderer`
 * --------------------------------------------------------------------
 *
 * `PaletteSwapRenderer.ts` already projects `(characterId, paletteIndex)
 * → PaletteSwap`. This module *consumes* that record — it does not
 * duplicate the lookup. A typical call site looks like:
 *
 *     const swap   = paletteSwapForSlot(slot);          // existing
 *     const remap  = buildPaletteRemap(swap);           // new (this file)
 *     applyPaletteSwapPipeline(sprite, remap);          // new (this file)
 *
 * For the placeholder rectangle code path that ships in M1/M2 the new
 * pipeline is a no-op (the rectangle has no atlas to remap), so
 * `PaletteSwapRenderer.applyPaletteSwap` keeps painting the rectangle
 * with `setFillStyle` as before. When the M-future sprite atlas lands,
 * the same `swap` flows into both helpers and the visuals stay in sync.
 */

import type { CharacterId } from '../types';
import { getCharacterPalette } from './palettes';
import {
  paletteSwapForSlot,
  type PaletteSwap,
} from './PaletteSwapRenderer';

// ---------------------------------------------------------------------------
// Per-character source palette table
// ---------------------------------------------------------------------------

/**
 * Named slot in a character's source palette. The shader maps each
 * source slot to the corresponding entry in the destination palette,
 * pixel by pixel.
 *
 *   • `body`      — the dominant fur / skin colour. Mapped to the
 *                   `PaletteSwap.primaryColor`.
 *   • `accent`    — outlines, detail strokes, the secondary recolour
 *                   target. Mapped to the `PaletteSwap.accentColor`.
 *   • `highlight` — optional bright pixels used for eyes, fur sheen,
 *                   weapon glints. Mapped to the `PaletteSwap.labelColor`
 *                   so the HUD label and the in-sprite highlights share
 *                   one source of truth.
 *
 * Three slots is the v1 ceiling — the hue-shift batch script that emits
 * the 8 palette atlases authors all three; later art passes can extend
 * the union (e.g. add `shadow`) and bump the slot count without
 * changing the shader's matching logic.
 */
export type PaletteSlot = 'body' | 'accent' | 'highlight';

/** Ordered list of slots — the shader iterates this list per pixel. */
export const PALETTE_SLOT_ORDER: ReadonlyArray<PaletteSlot> = Object.freeze([
  'body',
  'accent',
  'highlight',
]);

/**
 * The colours present in a character's *canonical* atlas (palette 0).
 * Every other palette is derived by the hue-shift script using these
 * source colours as the recolour key. Two characters share the same
 * slot names but typically have different source colours so each
 * character's atlas can be remapped independently.
 *
 * Frozen — adding a slot means extending the type union AND every
 * character's table here, by design.
 */
export interface CharacterSourcePalette {
  readonly characterId: CharacterId;
  readonly body: number;       // 0xRRGGBB
  readonly accent: number;     // 0xRRGGBB
  readonly highlight: number;  // 0xRRGGBB
}

/**
 * Build a source palette record from a character id by reading the
 * canonical (palette 0) entry. Centralised so the source colours always
 * match what `palettes.ts` declares as the canonical look — a colour
 * tweak in `palettes.ts` automatically updates the recolour key.
 *
 * Pure / deterministic.
 */
export function getCharacterSourcePalette(
  characterId: CharacterId,
): CharacterSourcePalette {
  const canonical = getCharacterPalette(characterId, 0);
  return Object.freeze({
    characterId,
    body: canonical.primaryColor,
    accent: canonical.accentColor,
    highlight: canonical.labelColor,
  });
}

// ---------------------------------------------------------------------------
// PaletteSwapRemap — the (source, target) pair the shader consumes
// ---------------------------------------------------------------------------

/**
 * Per-pixel colour remap configuration the shader / canvas-fallback
 * applies to a sprite. Each `(source, target)` pair maps one canonical
 * slot colour to its substitute under a given `PaletteSwap`.
 *
 * Built by {@link buildPaletteRemap} from the existing `PaletteSwap`
 * record so callers don't duplicate the `(characterId, paletteIndex) →
 * colours` projection. Frozen so a misbehaving consumer can't mutate
 * the remap mid-frame and desync replays.
 *
 * The `tolerance` field controls how close a source pixel must be to
 * the slot colour to count as a match. A non-zero tolerance lets the
 * shader handle anti-aliased edges without ringing artefacts, but the
 * v1 default is `0` — the source atlases are flat-colour pixel art with
 * no AA, so an exact RGB match is correct.
 *
 *   • `tolerance` = 0 → exact match only.
 *   • `tolerance` = 0.05 → match if the per-channel float distance is
 *     within ±5 % (suits softly-anti-aliased atlases).
 *   • `tolerance` is clamped into [0, 1] by the consumers so a stray
 *     out-of-range value never crashes the shader.
 */
export interface PaletteSwapRemap {
  /** Source character id (echoed from `PaletteSwap`). */
  readonly characterId: CharacterId;
  /** Target palette index 0..7. */
  readonly paletteIndex: number;
  /**
   * Slot mapping pairs. Iteration order matches
   * {@link PALETTE_SLOT_ORDER} so the shader can index uniform arrays
   * by position.
   */
  readonly entries: ReadonlyArray<{
    readonly slot: PaletteSlot;
    readonly source: number;
    readonly target: number;
  }>;
  /** Per-channel float tolerance (0..1). Default `0`. */
  readonly tolerance: number;
}

/**
 * Build a `PaletteSwapRemap` from a `PaletteSwap` (and the implicit
 * canonical source palette for the character). Pure / deterministic.
 *
 * The same swap always produces the same remap — `entries` are emitted
 * in `PALETTE_SLOT_ORDER` and the resulting object is deep-frozen so
 * the shader-uniform upload path can hash the record without worrying
 * about post-construction mutation.
 */
export function buildPaletteRemap(
  swap: PaletteSwap,
  options: { tolerance?: number } = {},
): PaletteSwapRemap {
  const source = getCharacterSourcePalette(swap.characterId);
  const entries = PALETTE_SLOT_ORDER.map((slot) => {
    const sourceColor =
      slot === 'body'
        ? source.body
        : slot === 'accent'
          ? source.accent
          : source.highlight;
    const targetColor =
      slot === 'body'
        ? swap.primaryColor
        : slot === 'accent'
          ? swap.accentColor
          : swap.labelColor;
    return Object.freeze({ slot, source: sourceColor, target: targetColor });
  });
  return Object.freeze({
    characterId: swap.characterId,
    paletteIndex: swap.paletteIndex,
    entries: Object.freeze(entries),
    tolerance: clampTolerance(options.tolerance ?? 0),
  });
}

/**
 * Convenience: build a remap directly from a `PlayerSlot`. Equivalent
 * to `buildPaletteRemap(paletteSwapForSlot(slot))` — saves the call
 * site one import.
 */
export function buildPaletteRemapForSlot(
  slot: Parameters<typeof paletteSwapForSlot>[0],
  options: { tolerance?: number } = {},
): PaletteSwapRemap {
  return buildPaletteRemap(paletteSwapForSlot(slot), options);
}

/**
 * Structural equality on two remaps. Used by the pipeline cache to
 * avoid re-uploading uniforms when nothing has changed since the last
 * frame. Two remaps with the same `(characterId, paletteIndex,
 * tolerance, entries[])` compare equal byte-for-byte.
 */
export function paletteRemapEqual(
  a: PaletteSwapRemap,
  b: PaletteSwapRemap,
): boolean {
  if (
    a.characterId !== b.characterId ||
    a.paletteIndex !== b.paletteIndex ||
    a.tolerance !== b.tolerance ||
    a.entries.length !== b.entries.length
  ) {
    return false;
  }
  for (let i = 0; i < a.entries.length; i++) {
    const ea = a.entries[i]!;
    const eb = b.entries[i]!;
    if (
      ea.slot !== eb.slot ||
      ea.source !== eb.source ||
      ea.target !== eb.target
    ) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Pure pixel-level remap helpers
// ---------------------------------------------------------------------------

/**
 * Remap a single 0xRRGGBB pixel using the configured slot mapping.
 *
 *   • Iterates the remap entries in order.
 *   • Returns the first slot's `target` whose `source` is within
 *     `tolerance` of the input pixel.
 *   • Returns the input pixel unchanged when nothing matches.
 *
 * Pure / deterministic. Used by the canvas-renderer fallback (when
 * WebGL is disabled) and by every unit test in this module.
 *
 * The `pixel` argument is a 24-bit integer (`0xRRGGBB`); alpha is the
 * caller's responsibility — for an `Uint8ClampedArray` walk see
 * {@link remapImageData} which preserves the alpha channel.
 */
export function remapPixel(
  pixel: number,
  remap: PaletteSwapRemap,
): number {
  // Clamp the input to the legal 24-bit range so a stray out-of-range
  // value (e.g. signed -1 from a buggy caller) still produces a sane
  // 24-bit output rather than NaN-painting the sprite.
  const clamped = clampColor24(pixel);
  for (const entry of remap.entries) {
    if (colorWithinTolerance(clamped, entry.source, remap.tolerance)) {
      return clampColor24(entry.target);
    }
  }
  return clamped;
}

/**
 * Walk an RGBA pixel buffer (length must be a multiple of 4) and remap
 * every pixel through {@link remapPixel}. Alpha is passed through
 * unchanged — fully-transparent pixels stay transparent so the sprite's
 * silhouette is preserved across swaps.
 *
 * The function returns a *new* `Uint8ClampedArray` so the caller's
 * source buffer (typically a CanvasRenderingContext2D `getImageData`
 * snapshot) can be reused for the next swap without re-reading from
 * the GPU. For an in-place variant see {@link remapImageDataInPlace}.
 *
 * Pure / deterministic.
 */
export function remapImageData(
  pixels: Uint8ClampedArray,
  remap: PaletteSwapRemap,
): Uint8ClampedArray {
  if (pixels.length % 4 !== 0) {
    throw new Error(
      `remapImageData: pixel buffer length must be a multiple of 4 (RGBA). Got ${pixels.length}.`,
    );
  }
  const out = new Uint8ClampedArray(pixels.length);
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]!;
    const g = pixels[i + 1]!;
    const b = pixels[i + 2]!;
    const a = pixels[i + 3]!;
    const remapped = remapPixel((r << 16) | (g << 8) | b, remap);
    out[i] = (remapped >> 16) & 0xff;
    out[i + 1] = (remapped >> 8) & 0xff;
    out[i + 2] = remapped & 0xff;
    out[i + 3] = a;
  }
  return out;
}

/**
 * In-place variant of {@link remapImageData}. Mutates the input buffer
 * directly — useful when the caller wants to write the remapped pixels
 * straight back into the same `ImageData` object via `putImageData`
 * without allocating a new buffer per frame.
 *
 * Returns the same reference as the input for chaining convenience.
 */
export function remapImageDataInPlace(
  pixels: Uint8ClampedArray,
  remap: PaletteSwapRemap,
): Uint8ClampedArray {
  if (pixels.length % 4 !== 0) {
    throw new Error(
      `remapImageDataInPlace: pixel buffer length must be a multiple of 4 (RGBA). Got ${pixels.length}.`,
    );
  }
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]!;
    const g = pixels[i + 1]!;
    const b = pixels[i + 2]!;
    // alpha stays untouched.
    const remapped = remapPixel((r << 16) | (g << 8) | b, remap);
    pixels[i] = (remapped >> 16) & 0xff;
    pixels[i + 1] = (remapped >> 8) & 0xff;
    pixels[i + 2] = remapped & 0xff;
  }
  return pixels;
}

// ---------------------------------------------------------------------------
// Shader source generator
// ---------------------------------------------------------------------------

/**
 * Identifier the Phaser pipeline registers under. Exposed so call
 * sites can query `game.renderer.pipelines.get(PALETTE_SWAP_PIPELINE_KEY)`
 * without re-typing the literal.
 */
export const PALETTE_SWAP_PIPELINE_KEY = 'PaletteSwapPipeline';

/**
 * Default fragment shader uniform name for the source colours array.
 * Exposed so tests can grep for it inside the generated source string
 * and the pipeline upload code can read the same constant.
 */
export const PALETTE_SWAP_UNIFORM_SOURCE = 'uPaletteSource';
/** Destination colours uniform name. */
export const PALETTE_SWAP_UNIFORM_TARGET = 'uPaletteTarget';
/** Per-channel float tolerance uniform name. */
export const PALETTE_SWAP_UNIFORM_TOLERANCE = 'uPaletteTolerance';
/** Active slot count uniform name (lets one shader handle 1-N slots). */
export const PALETTE_SWAP_UNIFORM_COUNT = 'uPaletteSlotCount';

/**
 * Generate the GLSL fragment shader source string that does the
 * per-pixel palette key remap.
 *
 *   • Sized for `numSlots` source/target colour pairs (default = the
 *     length of {@link PALETTE_SLOT_ORDER}).
 *   • Iterates the slot list and replaces the first matching source
 *     with the corresponding target. Non-matching pixels pass through.
 *   • Compares colours in float space with a per-channel tolerance so
 *     anti-aliased edges remap cleanly when the caller asks for it.
 *
 * Pure / deterministic — the same `numSlots` always produces the same
 * source string. Generated rather than hand-written so a future "8-slot
 * extended palette" character drops in without re-authoring GLSL.
 */
export function createPaletteSwapShaderSource(
  options: { numSlots?: number } = {},
): string {
  const numSlots = options.numSlots ?? PALETTE_SLOT_ORDER.length;
  if (!Number.isInteger(numSlots) || numSlots < 1) {
    throw new Error(
      `createPaletteSwapShaderSource: numSlots must be a positive integer. Got ${String(
        numSlots,
      )}.`,
    );
  }
  return [
    'precision mediump float;',
    '',
    'uniform sampler2D uMainSampler;',
    `uniform vec3 ${PALETTE_SWAP_UNIFORM_SOURCE}[${numSlots}];`,
    `uniform vec3 ${PALETTE_SWAP_UNIFORM_TARGET}[${numSlots}];`,
    `uniform float ${PALETTE_SWAP_UNIFORM_TOLERANCE};`,
    `uniform int ${PALETTE_SWAP_UNIFORM_COUNT};`,
    '',
    'varying vec2 outTexCoord;',
    '',
    'void main(void) {',
    '  vec4 texel = texture2D(uMainSampler, outTexCoord);',
    '  vec3 rgb = texel.rgb;',
    '  vec3 result = rgb;',
    '  bool matched = false;',
    `  for (int i = 0; i < ${numSlots}; i++) {`,
    `    if (i >= ${PALETTE_SWAP_UNIFORM_COUNT}) { break; }`,
    `    if (matched) { continue; }`,
    `    vec3 src = ${PALETTE_SWAP_UNIFORM_SOURCE}[i];`,
    `    vec3 dst = ${PALETTE_SWAP_UNIFORM_TARGET}[i];`,
    `    vec3 diff = abs(rgb - src);`,
    `    if (diff.r <= ${PALETTE_SWAP_UNIFORM_TOLERANCE} &&`,
    `        diff.g <= ${PALETTE_SWAP_UNIFORM_TOLERANCE} &&`,
    `        diff.b <= ${PALETTE_SWAP_UNIFORM_TOLERANCE}) {`,
    `      result = dst;`,
    `      matched = true;`,
    `    }`,
    '  }',
    '  gl_FragColor = vec4(result, texel.a);',
    '}',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Phaser pipeline factory + per-sprite installer
// ---------------------------------------------------------------------------

/**
 * Phaser-side renderer surface — only the pieces this module touches.
 * Typed structurally so the unit tests can drive the install path with
 * a hand-rolled mock and the live game can drive it with the real
 * `Phaser.Game`/`Phaser.Renderer.WebGL.PipelineManager`.
 */
export interface PaletteShaderRendererSurface {
  /** WebGL renderer exposes a pipeline manager; canvas does not. */
  readonly pipelines?: PaletteShaderPipelineManager;
}

export interface PaletteShaderPipelineManager {
  /** Test for an existing registration. */
  has?(key: string): boolean;
  /** Register a new pipeline. Phaser's signature is `(key, instance)`. */
  add(key: string, pipeline: unknown): unknown;
  /** Look the pipeline back up after registration. */
  get?(key: string): unknown;
}

/**
 * Phaser-side game surface — the slice of `Phaser.Game` we touch.
 * Optional renderer covers the (rare) case where the shim hasn't
 * initialised the renderer yet (e.g. in headless tests).
 */
export interface PaletteShaderGame {
  readonly renderer?: PaletteShaderRendererSurface;
}

/**
 * Install the palette-swap pipeline on a Phaser game.
 *
 * Idempotent — checks the manager for an existing registration before
 * adding so a hot-reloaded scene re-installing the pipeline doesn't
 * register two copies. Returns `true` if the pipeline was newly added,
 * `false` if it already existed (or there's no WebGL renderer).
 *
 * Pipelines are factory-created via the supplied `pipelineFactory`
 * callback so the unit tests can pass a stub factory and the live
 * scene can pass a real Phaser `Pipeline` subclass constructor without
 * this module having to import `Phaser`. (Phaser's
 * `Renderer.WebGL.Pipelines.PostFXPipeline` superclass is a runtime
 * import that pulls a heavy dependency tree; structural typing keeps
 * this file Phaser-free for unit testing.)
 */
export function installPaletteSwapPipeline(
  game: PaletteShaderGame,
  pipelineFactory: () => unknown,
): boolean {
  const manager = game.renderer?.pipelines;
  if (!manager || typeof manager.add !== 'function') {
    // No WebGL pipeline manager — canvas renderer or headless test.
    // Caller should fall back to `applyPaletteSwapTintFallback`.
    return false;
  }
  if (typeof manager.has === 'function' && manager.has(PALETTE_SWAP_PIPELINE_KEY)) {
    return false;
  }
  manager.add(PALETTE_SWAP_PIPELINE_KEY, pipelineFactory());
  return true;
}

/**
 * Structural shape of a sprite-like object the pipeline can attach to.
 * Mirrors the subset of `Phaser.GameObjects.Sprite` we touch — just
 * `setPipeline` / `resetPipeline` / `setPipelineData`. Other targets
 * (Image, RenderTexture) implement the same methods.
 */
export interface PaletteShaderTarget {
  setPipeline?(name: string): unknown;
  resetPipeline?(): unknown;
  setPipelineData?(key: string, value: unknown): unknown;
  /** Tint fallback for the canvas-renderer path. */
  setTint?(color: number): unknown;
  clearTint?(): unknown;
}

/**
 * Snapshot of the uniform values the shader will receive — produced by
 * {@link buildPipelineUniforms} and uploaded by the pipeline install
 * callback. Exposed so tests can assert exactly what colours the shader
 * sees without reaching into a `Phaser.Pipeline` mock.
 *
 * Colour values are pre-normalised into `[0, 1]` `[r, g, b]` triplets
 * because GLSL `vec3` uniforms are float-typed. Slot count is forwarded
 * so the shader can short-circuit unused slots (a "1-slot character"
 * still uses the same shader as a "3-slot character").
 */
export interface PaletteShaderUniforms {
  readonly source: ReadonlyArray<readonly [number, number, number]>;
  readonly target: ReadonlyArray<readonly [number, number, number]>;
  readonly tolerance: number;
  readonly slotCount: number;
}

/**
 * Build the shader-uniform snapshot for a remap. Pure / deterministic
 * — the same remap always produces the same uniforms.
 */
export function buildPipelineUniforms(
  remap: PaletteSwapRemap,
): PaletteShaderUniforms {
  const source = remap.entries.map((e) => colorToVec3(e.source));
  const target = remap.entries.map((e) => colorToVec3(e.target));
  return Object.freeze({
    source: Object.freeze(source),
    target: Object.freeze(target),
    tolerance: remap.tolerance,
    slotCount: remap.entries.length,
  });
}

/**
 * Apply a palette swap to a sprite via the WebGL pipeline path.
 *
 *   1. Sets the sprite's pipeline to {@link PALETTE_SWAP_PIPELINE_KEY}.
 *   2. Pushes the per-instance uniform data (source / target colours +
 *      tolerance + slot count) via `setPipelineData` so the same shader
 *      can drive every sprite without one pipeline instance per swap.
 *
 * Idempotent — re-applying the same remap to the same sprite produces
 * identical uniform data.
 *
 * Returns `true` if the pipeline path was used, `false` if the sprite
 * doesn't expose `setPipeline` (in which case the caller should call
 * {@link applyPaletteSwapTintFallback} for the canvas renderer).
 */
export function applyPaletteSwapPipeline(
  sprite: PaletteShaderTarget,
  remap: PaletteSwapRemap,
): boolean {
  if (typeof sprite.setPipeline !== 'function') {
    return false;
  }
  sprite.setPipeline(PALETTE_SWAP_PIPELINE_KEY);
  if (typeof sprite.setPipelineData === 'function') {
    const uniforms = buildPipelineUniforms(remap);
    sprite.setPipelineData(PALETTE_SWAP_UNIFORM_SOURCE, uniforms.source);
    sprite.setPipelineData(PALETTE_SWAP_UNIFORM_TARGET, uniforms.target);
    sprite.setPipelineData(PALETTE_SWAP_UNIFORM_TOLERANCE, uniforms.tolerance);
    sprite.setPipelineData(PALETTE_SWAP_UNIFORM_COUNT, uniforms.slotCount);
  }
  return true;
}

/**
 * Tint-only fallback for the canvas renderer (or for any sprite that
 * doesn't expose `setPipeline`). Calls `setTint(primaryColor)` so the
 * sprite at least picks up the body colour — the accent / highlight
 * remap is sacrificed to keep visuals working when WebGL is disabled.
 *
 * Returns `true` if a tint was applied, `false` if the sprite doesn't
 * expose `setTint` either (in which case the caller has nothing more
 * to do — the sprite stays in its default look).
 */
export function applyPaletteSwapTintFallback(
  sprite: PaletteShaderTarget,
  remap: PaletteSwapRemap,
): boolean {
  if (typeof sprite.setTint !== 'function') {
    return false;
  }
  if (typeof sprite.clearTint === 'function') {
    sprite.clearTint();
  }
  // First entry is the body slot by `PALETTE_SLOT_ORDER` convention.
  // Falls back to white (no tint) if the remap is somehow empty.
  const bodyEntry = remap.entries[0];
  const tint = bodyEntry ? bodyEntry.target : 0xffffff;
  sprite.setTint(tint);
  return true;
}

/**
 * Top-level convenience — pick the best remap path based on what the
 * sprite supports. Calls {@link applyPaletteSwapPipeline} when the
 * sprite has a pipeline; falls back to {@link applyPaletteSwapTintFallback}
 * otherwise.
 *
 * Returns the path that was used so the caller can log /trace.
 */
export function applyPaletteSwapToSprite(
  sprite: PaletteShaderTarget,
  remap: PaletteSwapRemap,
): 'pipeline' | 'tint' | 'none' {
  if (applyPaletteSwapPipeline(sprite, remap)) return 'pipeline';
  if (applyPaletteSwapTintFallback(sprite, remap)) return 'tint';
  return 'none';
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Convert a 0xRRGGBB integer into a normalised `[r, g, b]` float triple
 * in `[0, 1]`. Matches the GLSL `vec3` representation the shader
 * uniforms expect.
 */
export function colorToVec3(color: number): readonly [number, number, number] {
  const c = clampColor24(color);
  const r = ((c >> 16) & 0xff) / 255;
  const g = ((c >> 8) & 0xff) / 255;
  const b = (c & 0xff) / 255;
  return Object.freeze([r, g, b]) as readonly [number, number, number];
}

/**
 * Convert a normalised `[r, g, b]` float triple back into a 0xRRGGBB
 * integer. Inverse of {@link colorToVec3}; used by the canvas-renderer
 * fallback path that sometimes needs to round-trip colours through the
 * shader format.
 */
export function vec3ToColor(
  rgb: readonly [number, number, number],
): number {
  const r = clampUnit(rgb[0]);
  const g = clampUnit(rgb[1]);
  const b = clampUnit(rgb[2]);
  return (
    (Math.round(r * 255) << 16) |
    (Math.round(g * 255) << 8) |
    Math.round(b * 255)
  );
}

/**
 * `true` if two 0xRRGGBB pixels are within `tolerance` per channel
 * after normalisation. Used by {@link remapPixel} and by the GLSL
 * shader (which mirrors this logic in float math). Tolerance is per
 * channel (matches the shader's `diff.r <= tol && diff.g <= tol &&
 * diff.b <= tol`) so anti-aliased edges that drift in one channel
 * still match.
 */
export function colorWithinTolerance(
  pixel: number,
  source: number,
  tolerance: number,
): boolean {
  if (tolerance <= 0) {
    return clampColor24(pixel) === clampColor24(source);
  }
  const a = colorToVec3(pixel);
  const b = colorToVec3(source);
  const tol = clampTolerance(tolerance);
  return (
    Math.abs(a[0] - b[0]) <= tol &&
    Math.abs(a[1] - b[1]) <= tol &&
    Math.abs(a[2] - b[2]) <= tol
  );
}

/** Clamp a colour to the legal 24-bit range, flooring fractional inputs. */
function clampColor24(color: number): number {
  if (!Number.isFinite(color)) return 0;
  return Math.max(0, Math.min(0xffffff, Math.floor(color)));
}

/** Clamp a unit float into `[0, 1]`, mapping NaN to 0. */
function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/** Clamp a tolerance into `[0, 1]`, mapping NaN to 0. */
function clampTolerance(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
