/**
 * Palette-swap CLI — Sub-AC 2 of AC 10202.
 *
 * --------------------------------------------------------------------
 * What this script does
 * --------------------------------------------------------------------
 *
 * For every character (or just the one named on the command line):
 *
 *   1. Load `assets/palettes/<characterId>.json`
 *      (the palette definition file authored under Sub-AC 1).
 *   2. Load the canonical spritesheet PNG declared by the palette
 *      definition's character — by default
 *      `assets/characters/<characterId>/<characterId>_source_sheet.png`.
 *   3. For each of the 8 variants in the definition:
 *      - Pixel-remap source colours → variant target colours
 *        (preserving alpha; passing through unmatched pixels).
 *      - Encode the result as PNG and write to
 *        `assets/generated/sprites/<characterId>/<index>_<slug>.png`.
 *      - Print a one-line stats summary.
 *   4. Exit non-zero on any validation, decode, or write error.
 *
 * Usage:
 *
 *   npm run palette-swap              # all 4 characters (auto-discovered)
 *   npm run palette-swap -- wolf      # one character
 *   npm run palette-swap -- wolf cat
 *
 *   tsx scripts/palette-swap/index.ts \
 *     --in assets/characters/cat/cat_source_sheet.png \
 *     --palette assets/palettes/cat.json \
 *     --out assets/generated/sprites/cat
 *
 * The two forms are equivalent for the common case; the `--in/--out/--palette`
 * form lets the script run against ad-hoc inputs without the standard
 * `assets/` layout (used by tests and one-off debugging runs).
 *
 * --------------------------------------------------------------------
 * Determinism
 * --------------------------------------------------------------------
 *
 * Same JSON + same input PNG bytes → same 8 output PNG byte streams.
 * `pngjs` writes deterministically (no embedded timestamps), the
 * variant iteration order is the file's declared array order, and the
 * remap is a pure per-pixel function. CI can re-run the script and
 * `git diff --exit-code assets/generated/sprites/` to verify nothing
 * drifted.
 */

import { mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CHARACTER_IDS,
  type CharacterId,
  type ParsedPaletteDefinition,
  loadPaletteDefinition,
} from './paletteDefinition.js';
import {
  applyPaletteVariant,
  type PaletteSwapStats,
} from './paletteSwap.js';
import { decodePngFile, writePngFile } from './pngCodec.js';
import {
  CACHE_VERSION,
  type CacheManifest,
  type CharacterCacheEntry,
  isCacheHit,
  loadCacheManifest,
  saveCacheManifest,
  sha256File,
  sha256Hex,
  withCharacterEntry,
} from './cache.js';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Repo root resolved from this file's location. The script lives at
 * `<repo>/scripts/palette-swap/index.ts`, so `../..` is the root.
 *
 * Computed via `import.meta.url` instead of `process.cwd()` so the CLI
 * works regardless of the directory it was invoked from.
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const DEFAULT_PALETTES_DIR = join(REPO_ROOT, 'assets', 'palettes');
export const DEFAULT_CHARACTERS_DIR = join(REPO_ROOT, 'assets', 'characters');
export const DEFAULT_GENERATED_SPRITES_DIR = join(
  REPO_ROOT,
  'assets',
  'generated',
  'sprites',
);

/**
 * Default cache manifest path. Lives inside the generated tree so a
 * `rm -rf assets/generated/sprites` nukes inputs and the cache state
 * together — no stale-cache foot-guns.
 */
export const DEFAULT_CACHE_MANIFEST_PATH = join(
  DEFAULT_GENERATED_SPRITES_DIR,
  '.palette-cache.json',
);

/** Slugify a variant name for the output filename (`Royal` → `royal`). */
export function slugifyVariantName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Compose the output filename for a variant index + name. */
export function variantOutputFilename(
  index: number,
  name: string,
): string {
  return `${index}_${slugifyVariantName(name)}.png`;
}

// ---------------------------------------------------------------------------
// Single-character runner
// ---------------------------------------------------------------------------

export interface RunOneOptions {
  readonly characterId: CharacterId;
  readonly inputPng: string;
  readonly paletteJson: string;
  readonly outputDir: string;
  /** Optional logger — default `console.log`. Tests inject a no-op. */
  readonly log?: (line: string) => void;
  /**
   * Optional cache manifest (already loaded). When provided and a hit
   * is detected, the function skips PNG work and returns
   * `{ cacheHit: true, ... }` with empty outputs and no manifest delta.
   *
   * Pass `undefined` to disable caching for this call (the default —
   * the all-characters runner is responsible for cache lifecycle).
   */
  readonly cacheManifest?: CacheManifest;
  /** When true, ignore any cache hit and re-run the swap. */
  readonly forceRebuild?: boolean;
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
  /** True when the run was skipped because the cache was hit. */
  readonly cacheHit: boolean;
  /**
   * If the run *wrote* PNGs (cache miss or forced), the entry that
   * should be merged into the cache manifest. `undefined` on a hit.
   */
  readonly cacheEntry?: CharacterCacheEntry;
}

/**
 * Process a single character end-to-end: read PNG, read palette JSON,
 * write 8 variant PNGs to `outputDir`. Returns a structured result so
 * callers (CLI, tests) can assert on what was produced.
 */
export async function runPaletteSwapForCharacter(
  opts: RunOneOptions,
): Promise<RunOneResult> {
  const log = opts.log ?? ((line: string) => console.log(line));

  const definition = await loadPaletteDefinition(opts.paletteJson);
  if (definition.characterId !== opts.characterId) {
    throw new Error(
      `runPaletteSwapForCharacter: palette JSON ${opts.paletteJson} ` +
        `declares characterId=${definition.characterId} but caller ` +
        `requested ${opts.characterId}`,
    );
  }

  // Determine the set of output paths *before* doing any pixel work so
  // the cache check can verify each one without us decoding the source
  // PNG. The filename rule is shared between both branches.
  const expectedOutputPaths = definition.variants.map((variant) =>
    join(opts.outputDir, variantOutputFilename(variant.index, variant.name)),
  );

  // ---------------------------------------------------------------------
  // Cache check (fast path)
  // ---------------------------------------------------------------------
  // Hashing the JSON + PNG is dramatically cheaper than re-running the
  // full pipeline (~30 ms vs ~700 ms per character on the dev laptop),
  // so we always do it when caching is enabled. The cache manifest is
  // optional — callers that don't want caching simply omit it.
  if (opts.cacheManifest && !opts.forceRebuild) {
    const paletteSha256 = await sha256File(opts.paletteJson);
    const sourceSha256 = await sha256File(opts.inputPng);
    const hit = await isCacheHit(
      opts.cacheManifest,
      {
        characterId: definition.characterId,
        paletteSha256,
        sourceSha256,
        expectedOutputPaths,
      },
      opts.outputDir,
    );
    if (hit) {
      log(
        `[${definition.characterId}] cache hit — ` +
          `${definition.variants.length} variants up-to-date in ${opts.outputDir}`,
      );
      return Object.freeze({
        characterId: definition.characterId,
        displayName: definition.displayName,
        outputDir: opts.outputDir,
        outputs: Object.freeze([] as RunOneResult['outputs'][number][]),
        cacheHit: true,
      });
    }
  }

  const image = await decodePngFile(opts.inputPng);

  await mkdir(opts.outputDir, { recursive: true });

  const outputs: RunOneResult['outputs'] = [];
  // Hashes computed inline as we write each PNG so the cache can be
  // updated without a second read pass. Using the in-memory bytes
  // avoids any chance of disk drift between write and hash.
  const outputHashes: Array<{ filename: string; sha256: string }> = [];

  log(
    `[${definition.characterId}] ${definition.displayName} — ` +
      `${image.width}×${image.height} → ${opts.outputDir}` +
      (opts.forceRebuild ? ' (forced rebuild)' : ''),
  );

  for (const variant of definition.variants) {
    const { pixels, stats } = applyPaletteVariant(
      image.pixels,
      image.width,
      image.height,
      variant,
    );
    const filename = variantOutputFilename(variant.index, variant.name);
    const outPath = join(opts.outputDir, filename);
    await writePngFile(outPath, pixels, image.width, image.height);
    // Re-read from disk so the recorded hash matches what subsequent
    // cache lookups will compute. `pngjs` is deterministic so this is
    // equivalent to hashing `encodePngBuffer(...)`'s output, but the
    // disk-read form keeps the cache contract explicit: "what is on
    // disk hashes to this."
    const writtenBytes = await readFile(outPath);
    outputHashes.push({ filename, sha256: sha256Hex(writtenBytes) });

    log(
      `  #${variant.index} ${variant.name.padEnd(10)} → ${filename}` +
        `  body=${stats.perSlot.body}` +
        `  accent=${stats.perSlot.accent}` +
        `  highlight=${stats.perSlot.highlight}` +
        `  passthrough=${stats.passThroughPixels}` +
        `  transparent=${stats.transparentPixels}`,
    );

    (outputs as Array<RunOneResult['outputs'][number]>).push({
      index: variant.index,
      name: variant.name,
      path: outPath,
      stats,
    });
  }

  // Build a cache entry the caller can fold into the manifest. We only
  // emit one when caching is in play *or* forced — no-cache callers
  // (e.g. tests for the legacy interface) get `undefined` and don't
  // need to think about manifests.
  let cacheEntry: CharacterCacheEntry | undefined;
  if (opts.cacheManifest || opts.forceRebuild) {
    const paletteSha256 = await sha256File(opts.paletteJson);
    const sourceSha256 = await sha256File(opts.inputPng);
    cacheEntry = Object.freeze({
      paletteSha256,
      sourceSha256,
      cliVersion: CACHE_VERSION,
      outputs: Object.freeze(outputHashes),
    });
  }

  return Object.freeze({
    characterId: definition.characterId,
    displayName: definition.displayName,
    outputDir: opts.outputDir,
    outputs: Object.freeze(outputs),
    cacheHit: false,
    cacheEntry,
  });
}

// ---------------------------------------------------------------------------
// All-characters runner (default mode)
// ---------------------------------------------------------------------------

/**
 * Conventional location of a character's canonical spritesheet PNG.
 * Discovered from the palette definition rather than hard-coded so a
 * later character with a non-standard filename only needs a one-line
 * lookup change here.
 */
function defaultInputPathForCharacter(
  definition: ParsedPaletteDefinition,
): string {
  return join(
    DEFAULT_CHARACTERS_DIR,
    definition.characterId,
    `${definition.characterId}_source_sheet.png`,
  );
}

export interface RunAllOptions {
  /** Subset of character ids to process, or all when omitted. */
  readonly only?: ReadonlyArray<CharacterId>;
  readonly log?: (line: string) => void;
  /**
   * When true, ignore cache hits and re-run every character. Maps to
   * the `--force` CLI flag. Useful when debugging the swap script
   * itself or after a `git checkout` that changed generated outputs
   * the manifest still claims are current.
   */
  readonly forceRebuild?: boolean;
  /**
   * Override the cache manifest path. Tests point this at a tmp dir
   * so they don't trample the repo's real cache file.
   */
  readonly cacheManifestPath?: string;
  /**
   * When true, do not consult or update the cache. Equivalent to
   * deleting the manifest before each call. Used by the legacy
   * end-to-end tests that own their own tmp output dirs.
   */
  readonly noCache?: boolean;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

export async function runPaletteSwapForAll(
  opts: RunAllOptions = {},
): Promise<ReadonlyArray<RunOneResult>> {
  const explicitSubset = opts.only !== undefined && opts.only.length > 0;
  const targets = (explicitSubset
    ? opts.only!
    : CHARACTER_IDS) as ReadonlyArray<CharacterId>;
  const log = opts.log ?? ((line: string) => console.log(line));

  // ---------------------------------------------------------------------
  // Cache lifecycle
  // ---------------------------------------------------------------------
  // Load the manifest once at the start of the run; accumulate updates
  // from each character into a working copy; write once at the end.
  // This keeps the cache file consistent if the run crashes midway —
  // we either rewrite it with the new state or leave the old one alone.
  const useCache = !opts.noCache;
  const cacheManifestPath =
    opts.cacheManifestPath ?? DEFAULT_CACHE_MANIFEST_PATH;
  let manifest = useCache
    ? await loadCacheManifest(cacheManifestPath)
    : undefined;
  let manifestChanged = false;

  let hits = 0;
  let misses = 0;

  const results: RunOneResult[] = [];
  for (const characterId of targets) {
    const paletteJson = join(DEFAULT_PALETTES_DIR, `${characterId}.json`);
    const definition = await loadPaletteDefinition(paletteJson);
    const inputPng = defaultInputPathForCharacter(definition);

    // In auto-discovery mode (no explicit subset), tolerate characters whose
    // source sheet has not been sourced yet — the M1.5 content pipeline only
    // ships wolf + cat, and M2 will drop owl + bear sheets in. Subset/explicit
    // mode still errors loudly: if the user asked for `owl`, missing assets
    // are a real failure they need to see.
    if (!explicitSubset && !(await fileExists(inputPng))) {
      log(
        `[${characterId}] skip: ${inputPng} not present yet — ` +
          `palette JSON exists but source sheet has not been sourced`,
      );
      continue;
    }

    const outputDir = join(DEFAULT_GENERATED_SPRITES_DIR, characterId);
    const result = await runPaletteSwapForCharacter({
      characterId,
      inputPng,
      paletteJson,
      outputDir,
      log: opts.log,
      cacheManifest: manifest,
      forceRebuild: opts.forceRebuild === true,
    });
    results.push(result);
    if (result.cacheHit) {
      hits++;
    } else {
      misses++;
      if (useCache && manifest && result.cacheEntry) {
        manifest = withCharacterEntry(manifest, characterId, result.cacheEntry);
        manifestChanged = true;
      }
    }
  }

  if (useCache && manifest && manifestChanged) {
    await saveCacheManifest(cacheManifestPath, manifest);
  }
  if (useCache) {
    log(
      `palette-swap: ${hits} cache hit${hits === 1 ? '' : 's'}, ` +
        `${misses} rebuilt`,
    );
  }
  return results;
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface ParsedArgs {
  readonly mode: 'all' | 'subset' | 'explicit';
  readonly only: ReadonlyArray<CharacterId>;
  readonly inputPng?: string;
  readonly paletteJson?: string;
  readonly outputDir?: string;
  readonly characterId?: CharacterId;
  /** `--force` / `-f` flag — bypass cache hits. */
  readonly forceRebuild: boolean;
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
  let forceRebuild = false;

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
    } else if (a === '--force' || a === '-f') {
      forceRebuild = true;
    } else if (a === '--help' || a === '-h') {
      throw new Error('__help__');
    } else if (a.startsWith('--')) {
      throw new Error(`unknown flag: ${a}`);
    } else {
      positional.push(a);
    }
  }

  // Explicit mode if any of the path flags were supplied.
  if (inputPng || paletteJson || outputDir) {
    if (!inputPng || !paletteJson || !outputDir) {
      throw new Error(
        '--in, --palette, --out must all be supplied together',
      );
    }
    // Character id can be inferred from the palette JSON later; if the
    // flag is given we trust it.
    return {
      mode: 'explicit',
      only: characterId ? [characterId] : [],
      inputPng,
      paletteJson,
      outputDir,
      characterId,
      forceRebuild,
    };
  }

  if (positional.length === 0) {
    return { mode: 'all', only: [], forceRebuild };
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
  return { mode: 'subset', only, forceRebuild };
}

const HELP_TEXT = `palette-swap — generate 8 palette-variant PNGs per character.

Usage:
  npm run palette-swap                # process all characters with palette JSONs
  npm run palette-swap -- wolf cat    # process a subset (positional ids)
  npm run palette-swap -- --force     # bypass cache and rebuild everything

  tsx scripts/palette-swap/index.ts \\
    --in assets/characters/cat/cat_source_sheet.png \\
    --palette assets/palettes/cat.json \\
    --out assets/generated/sprites/cat \\
    [--character cat] [--force]

Caching:
  Cache manifest lives at assets/generated/sprites/.palette-cache.json.
  A character is skipped when its palette JSON, source PNG, and every
  generated output PNG hash to the recorded values. Use --force or -f
  (or delete the manifest) to rebuild unconditionally.

Outputs are written to <outputDir>/<index>_<variant-slug>.png. The default
output directory in the all/subset modes is assets/generated/sprites/<id>/.
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
      // Resolve character id from JSON if not explicitly provided.
      let characterId = parsed.characterId;
      if (!characterId) {
        const def = await loadPaletteDefinition(parsed.paletteJson!);
        characterId = def.characterId;
      }
      // Explicit-mode runs are typically ad-hoc / debugging and write
      // to user-specified directories. We deliberately do NOT touch the
      // shared repo cache manifest here — it would conflate "real
      // generated tree" hashes with one-off output dirs and trigger
      // spurious misses on the next normal run.
      await runPaletteSwapForCharacter({
        characterId,
        inputPng: parsed.inputPng!,
        paletteJson: parsed.paletteJson!,
        outputDir: parsed.outputDir!,
        log,
        forceRebuild: parsed.forceRebuild,
      });
    } else {
      await runPaletteSwapForAll({
        only: parsed.mode === 'subset' ? parsed.only : undefined,
        log,
        forceRebuild: parsed.forceRebuild,
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

// ESM entry-point check: `import.meta.url` matches `process.argv[1]` only
// when this file was invoked directly (`tsx scripts/palette-swap/index.ts …`),
// not when imported from a test.
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
