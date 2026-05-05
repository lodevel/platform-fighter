/**
 * scripts/palette-swap.ts — Sub-AC 1 of AC 10201.
 *
 * --------------------------------------------------------------------
 * What this script does (per the AC text)
 * --------------------------------------------------------------------
 *
 *   "Create scripts/palette-swap.ts with the core palette-swap logic
 *    that reads a base spritesheet, applies a color-mapping table to
 *    produce 8 recolored variants, and writes them to
 *    build/assets/<character>/."
 *
 * Concretely, for every character (or just the one(s) named on the
 * command line):
 *
 *   1. Load `assets/palettes/<characterId>.json` — the per-character
 *      color-mapping table (8 variants × 3 slots: body/accent/highlight).
 *   2. Decode the canonical RGBA spritesheet from
 *      `assets/characters/<characterId>/<characterId>_source_sheet.png`.
 *   3. For each of the 8 variants:
 *      - Apply the slot color mapping pixel-by-pixel (alpha preserved,
 *        unmatched pixels passed through unchanged).
 *      - Encode the result as PNG and write to
 *        `build/assets/<characterId>/<index>_<variant-slug>.png`
 *        (the build-time output dir mandated by the AC).
 *      - Print a one-line stats summary for diagnostics.
 *   4. Exit non-zero on any validation, decode, or write error.
 *
 * --------------------------------------------------------------------
 * Architecture choice — single-file entry, modular core
 * --------------------------------------------------------------------
 *
 * The deterministic per-pixel transform, palette JSON validation, and
 * PNG codec already exist as small, individually tested modules under
 * `scripts/palette-swap/`. This file is the single-entry script the AC
 * names; it composes those modules and locks the output directory to
 * `build/assets/<character>/`.
 *
 * Re-using the modular core (rather than copy-pasting the transform)
 * means:
 *   - One implementation of the remap → one place to test determinism.
 *   - The same transform can run in the browser against `<canvas>`
 *     image data for an in-game palette preview without a code fork.
 *   - Schema/validator changes propagate automatically.
 *
 * --------------------------------------------------------------------
 * Pixel manipulation library
 * --------------------------------------------------------------------
 *
 * The AC text suggests "use sharp or jimp for pixel manipulation".
 * This script uses the existing `pngjs`-based codec at
 * `scripts/palette-swap/pngCodec.ts` because:
 *
 *   - `pngjs` is a pure-JavaScript codec with zero native deps — it
 *     does not bloat the dev install or the v1 web bundle (which has a
 *     hard <100 MB cap per the Seed constraints).
 *   - It produces and consumes the exact `[R,G,B,A,...]` row-major
 *     RGBA buffer the deterministic remap operates on — identical to
 *     what `getImageData()` returns in the browser.
 *   - It writes deterministically (no embedded timestamps), which the
 *     replay/determinism story requires: same JSON + same input PNG
 *     bytes ⇒ same 8 output PNG byte streams, every run.
 *   - The codec is fully isolated behind `pngCodec.ts`. Swapping for
 *     `sharp` or `jimp` later (e.g. if we hit a perf wall on
 *     4 × 8 × 1024² pixels) is a one-file change.
 *
 * --------------------------------------------------------------------
 * Determinism
 * --------------------------------------------------------------------
 *
 * Same JSON + same input PNG bytes → same 8 output PNG byte streams,
 * byte-for-byte. CI can re-run this script and
 * `git diff --exit-code build/assets/` to verify nothing drifted.
 *
 * --------------------------------------------------------------------
 * Usage
 * --------------------------------------------------------------------
 *
 *   tsx scripts/palette-swap.ts                # all 4 characters
 *   tsx scripts/palette-swap.ts wolf cat       # subset (positional ids)
 *   tsx scripts/palette-swap.ts \
 *     --in   assets/characters/cat/cat_source_sheet.png \
 *     --palette assets/palettes/cat.json \
 *     --out  build/assets/cat                  # explicit ad-hoc mode
 *
 * Outputs are written to `build/assets/<characterId>/<index>_<slug>.png`.
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CHARACTER_IDS,
  type CharacterId,
  type ParsedPaletteDefinition,
  loadPaletteDefinition,
} from './palette-swap/paletteDefinition.js';
import {
  applyPaletteVariant,
  type PaletteSwapStats,
} from './palette-swap/paletteSwap.js';
import {
  decodePngBuffer,
  encodePngBuffer,
} from './palette-swap/pngCodec.js';

// ---------------------------------------------------------------------------
// Path helpers — repo-root-relative, so the script works from any CWD
// ---------------------------------------------------------------------------

/**
 * Repo root resolved from this file's location. The script lives at
 * `<repo>/scripts/palette-swap.ts`, so `..` is the root.
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Where the per-character palette JSON files live (read). */
export const PALETTES_DIR = join(REPO_ROOT, 'assets', 'palettes');

/** Where the per-character source spritesheets live (read). */
export const CHARACTERS_DIR = join(REPO_ROOT, 'assets', 'characters');

/**
 * Where the recolored variant PNGs are written (the AC-mandated path).
 *
 * `build/` is the conventional output directory for generated build
 * artefacts (parallel to `dist/` which Vite owns). We keep palette
 * outputs in `build/assets/` rather than `dist/` so they can be picked
 * up by the asset pipeline without colliding with Vite's bundling step.
 */
export const BUILD_ASSETS_DIR = join(REPO_ROOT, 'build', 'assets');

/** Slugify a variant name for the output filename (`Royal` → `royal`). */
export function slugifyVariantName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Compose the output filename for one variant. */
export function variantOutputFilename(
  index: number,
  name: string,
): string {
  return `${index}_${slugifyVariantName(name)}.png`;
}

/** Conventional path of a character's canonical spritesheet PNG. */
function defaultInputPathForCharacter(characterId: CharacterId): string {
  return join(
    CHARACTERS_DIR,
    characterId,
    `${characterId}_source_sheet.png`,
  );
}

/** Conventional path of a character's palette JSON. */
function defaultPalettePathForCharacter(characterId: CharacterId): string {
  return join(PALETTES_DIR, `${characterId}.json`);
}

/** Conventional output directory for one character under `build/assets/`. */
function defaultOutputDirForCharacter(characterId: CharacterId): string {
  return join(BUILD_ASSETS_DIR, characterId);
}

// ---------------------------------------------------------------------------
// Single-character runner
// ---------------------------------------------------------------------------

export interface RunOneOptions {
  readonly characterId: CharacterId;
  /** Path to the canonical input spritesheet PNG. */
  readonly inputPng: string;
  /** Path to the per-character palette JSON (color-mapping table). */
  readonly paletteJson: string;
  /** Where to write the 8 variant PNGs. */
  readonly outputDir: string;
  /** Optional logger — default `console.log`. Tests inject a no-op. */
  readonly log?: (line: string) => void;
}

export interface RunOneResult {
  readonly characterId: CharacterId;
  readonly displayName: string;
  readonly outputDir: string;
  readonly outputs: ReadonlyArray<{
    readonly index: number;
    readonly name: string;
    readonly path: string;
    readonly stats: PaletteSwapStats;
  }>;
}

/**
 * Process a single character end-to-end:
 *   1. Read & validate the palette JSON (the color-mapping table).
 *   2. Decode the source spritesheet to RGBA pixels.
 *   3. For each of the 8 variants, run the deterministic remap and
 *      write `<outputDir>/<index>_<variant-slug>.png`.
 *   4. Return a structured result so callers (CLI, tests) can assert
 *      on what was produced.
 */
export async function runPaletteSwapForCharacter(
  opts: RunOneOptions,
): Promise<RunOneResult> {
  const log = opts.log ?? ((line: string) => console.log(line));

  // ---- 1. Load + validate the color-mapping table -------------------------
  const definition = await loadPaletteDefinition(opts.paletteJson);
  if (definition.characterId !== opts.characterId) {
    throw new Error(
      `runPaletteSwapForCharacter: palette JSON ${opts.paletteJson} ` +
        `declares characterId=${definition.characterId} but caller ` +
        `requested ${opts.characterId}`,
    );
  }

  // ---- 2. Decode the base spritesheet -------------------------------------
  let inputBytes: Buffer;
  try {
    inputBytes = await readFile(opts.inputPng);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(
      `runPaletteSwapForCharacter: cannot read source sheet ` +
        `${opts.inputPng}: ${cause}`,
    );
  }
  const image = decodePngBuffer(inputBytes, opts.inputPng);

  // ---- 3. Make sure the output directory exists ---------------------------
  await mkdir(opts.outputDir, { recursive: true });

  log(
    `[${definition.characterId}] ${definition.displayName} — ` +
      `${image.width}×${image.height} → ${opts.outputDir}`,
  );

  const outputs: Array<RunOneResult['outputs'][number]> = [];

  // ---- 4. Apply each variant and write a PNG ------------------------------
  for (const variant of definition.variants) {
    const { pixels, stats } = applyPaletteVariant(
      image.pixels,
      image.width,
      image.height,
      variant,
    );
    const filename = variantOutputFilename(variant.index, variant.name);
    const outPath = join(opts.outputDir, filename);

    const pngBytes = encodePngBuffer(pixels, image.width, image.height);
    await writeFile(outPath, pngBytes);

    log(
      `  #${variant.index} ${variant.name.padEnd(10)} → ${filename}` +
        `  body=${stats.perSlot.body}` +
        `  accent=${stats.perSlot.accent}` +
        `  highlight=${stats.perSlot.highlight}` +
        `  passthrough=${stats.passThroughPixels}` +
        `  transparent=${stats.transparentPixels}`,
    );

    outputs.push({
      index: variant.index,
      name: variant.name,
      path: outPath,
      stats,
    });
  }

  return Object.freeze({
    characterId: definition.characterId,
    displayName: definition.displayName,
    outputDir: opts.outputDir,
    outputs: Object.freeze(outputs),
  });
}

// ---------------------------------------------------------------------------
// All-characters runner (default mode)
// ---------------------------------------------------------------------------

export interface RunAllOptions {
  /** Subset of character ids to process, or all when omitted. */
  readonly only?: ReadonlyArray<CharacterId>;
  readonly log?: (line: string) => void;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

/**
 * Iterate over every character (or the named subset) and run
 * `runPaletteSwapForCharacter` for each, writing output under
 * `build/assets/<characterId>/`.
 *
 * In auto-discovery mode (no explicit subset), tolerate characters
 * whose source sheet has not been sourced yet — the M1.5 content
 * pipeline only ships wolf + cat, and M2 will drop owl + bear sheets
 * in. Subset/explicit mode still errors loudly: if the user asked for
 * `owl`, missing assets are a real failure they need to see.
 */
export async function runPaletteSwapForAll(
  opts: RunAllOptions = {},
): Promise<ReadonlyArray<RunOneResult>> {
  const explicitSubset = opts.only !== undefined && opts.only.length > 0;
  const targets = (explicitSubset
    ? opts.only!
    : CHARACTER_IDS) as ReadonlyArray<CharacterId>;
  const log = opts.log ?? ((line: string) => console.log(line));

  const results: RunOneResult[] = [];
  for (const characterId of targets) {
    const paletteJson = defaultPalettePathForCharacter(characterId);
    if (!(await fileExists(paletteJson))) {
      if (explicitSubset) {
        throw new Error(
          `palette JSON missing for ${characterId}: ${paletteJson}`,
        );
      }
      log(`[${characterId}] skip: palette JSON not present yet`);
      continue;
    }

    // Load up-front so we can use the declared characterId / displayName
    // when reporting skipped/missing source sheets.
    const definition: ParsedPaletteDefinition =
      await loadPaletteDefinition(paletteJson);
    const inputPng = defaultInputPathForCharacter(definition.characterId);

    if (!(await fileExists(inputPng))) {
      if (explicitSubset) {
        throw new Error(
          `source sheet missing for ${characterId}: ${inputPng}`,
        );
      }
      log(
        `[${characterId}] skip: ${inputPng} not present yet — ` +
          `palette JSON exists but source sheet has not been sourced`,
      );
      continue;
    }

    const outputDir = defaultOutputDirForCharacter(definition.characterId);
    const result = await runPaletteSwapForCharacter({
      characterId: definition.characterId,
      inputPng,
      paletteJson,
      outputDir,
      log: opts.log,
    });
    results.push(result);
  }
  return results;
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface ParsedArgs {
  readonly mode: 'all' | 'subset' | 'explicit';
  readonly only: ReadonlyArray<CharacterId>;
  readonly inputPng?: string;
  readonly paletteJson?: string;
  readonly outputDir?: string;
  readonly characterId?: CharacterId;
}

function isCharacterId(s: string): s is CharacterId {
  return (CHARACTER_IDS as readonly string[]).includes(s);
}

export function parseCliArgs(argv: ReadonlyArray<string>): ParsedArgs {
  const positional: string[] = [];
  let inputPng: string | undefined;
  let paletteJson: string | undefined;
  let outputDir: string | undefined;
  let characterId: CharacterId | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--in' || a === '--input') {
      inputPng = argv[++i];
    } else if (a === '--palette') {
      paletteJson = argv[++i];
    } else if (a === '--out' || a === '--output') {
      outputDir = argv[++i];
    } else if (a === '--character') {
      const v = argv[++i];
      if (!v || !isCharacterId(v)) {
        throw new Error(
          `--character: expected one of ${JSON.stringify(CHARACTER_IDS)}, got ${JSON.stringify(v)}`,
        );
      }
      characterId = v;
    } else if (a === '--help' || a === '-h') {
      throw new Error('__help__');
    } else if (a.startsWith('--')) {
      throw new Error(`unknown flag: ${a}`);
    } else {
      positional.push(a);
    }
  }

  if (inputPng || paletteJson || outputDir) {
    if (!inputPng || !paletteJson || !outputDir) {
      throw new Error(
        '--in, --palette, --out must all be supplied together',
      );
    }
    return {
      mode: 'explicit',
      only: characterId ? [characterId] : [],
      inputPng,
      paletteJson,
      outputDir,
      characterId,
    };
  }

  if (positional.length === 0) {
    return { mode: 'all', only: [] };
  }

  const only: CharacterId[] = [];
  for (const id of positional) {
    if (!isCharacterId(id)) {
      throw new Error(
        `unknown character id ${JSON.stringify(id)} ` +
          `(expected one of ${JSON.stringify(CHARACTER_IDS)})`,
      );
    }
    only.push(id);
  }
  return { mode: 'subset', only };
}

const HELP_TEXT = `palette-swap — generate 8 palette-variant PNGs per character.

Reads a base spritesheet, applies the palette JSON's color-mapping
table, and writes 8 recolored variants to build/assets/<character>/.

Usage:
  tsx scripts/palette-swap.ts                # all 4 characters
  tsx scripts/palette-swap.ts wolf cat       # subset (positional ids)

  tsx scripts/palette-swap.ts \\
    --in   assets/characters/cat/cat_source_sheet.png \\
    --palette assets/palettes/cat.json \\
    --out  build/assets/cat \\
    [--character cat]

Outputs are written to <outputDir>/<index>_<variant-slug>.png.
The default output directory is build/assets/<characterId>/.
`;

// ---------------------------------------------------------------------------
// Main entry — only run when invoked directly (not when imported by tests)
// ---------------------------------------------------------------------------

export async function main(
  argv: ReadonlyArray<string> = process.argv.slice(2),
  log: (line: string) => void = (line) => console.log(line),
): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseCliArgs(argv);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === '__help__') {
      log(HELP_TEXT);
      return 0;
    }
    log(`error: ${msg}`);
    log('');
    log(HELP_TEXT);
    return 2;
  }

  try {
    if (parsed.mode === 'explicit') {
      // Resolve character id from the JSON if not explicitly provided.
      let characterId = parsed.characterId;
      if (!characterId) {
        const def = await loadPaletteDefinition(parsed.paletteJson!);
        characterId = def.characterId;
      }
      await runPaletteSwapForCharacter({
        characterId,
        inputPng: parsed.inputPng!,
        paletteJson: parsed.paletteJson!,
        outputDir: parsed.outputDir!,
        log,
      });
    } else {
      await runPaletteSwapForAll({
        only: parsed.mode === 'subset' ? parsed.only : undefined,
        log,
      });
    }
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`error: ${msg}`);
    if (err instanceof Error && err.stack) {
      log(err.stack);
    }
    return 1;
  }
}

// ESM entry-point check: `import.meta.url` matches `process.argv[1]`
// only when this file was invoked directly
// (`tsx scripts/palette-swap.ts ...`), not when imported from a test.
const invokedDirectly = (() => {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === `file://${resolve(process.argv[1])}`;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main().then((code) => {
    process.exit(code);
  });
}
