/**
 * Build-time cache for the palette-swap pipeline — Sub-AC 3 of AC 10203.
 *
 * --------------------------------------------------------------------
 * Why a cache exists
 * --------------------------------------------------------------------
 *
 * The full palette-swap run is wired into `npm run build` via the
 * `prebuild` hook in `package.json`. Without caching, every Vite build
 * — including the typecheck-only ones developers run between code
 * edits — re-decodes 4 × ~1 MP PNGs and re-encodes 32 PNGs. That's
 * roughly 3 seconds the user pays for output that did not change.
 *
 * With caching, a build whose source PNGs and palette JSONs are
 * untouched skips the swap entirely (~50 ms for hash + manifest read).
 *
 * --------------------------------------------------------------------
 * Cache shape
 * --------------------------------------------------------------------
 *
 * The cache is a single JSON manifest at
 * `assets/generated/sprites/.palette-cache.json`. One entry per
 * character id. Each entry pins:
 *
 *   - `paletteSha256`  — hash of the `assets/palettes/<id>.json` bytes
 *   - `sourceSha256`   — hash of the canonical source PNG bytes
 *   - `outputs`        — list of `{ filename, sha256 }` for every variant
 *                        PNG written on the recorded run
 *   - `cliVersion`     — bumps when the script's serialization changes,
 *                        forcing a full rebuild after a script upgrade
 *
 * A cache *hit* requires:
 *
 *   1. Manifest entry exists for the character id.
 *   2. `paletteSha256` matches the current palette JSON file bytes.
 *   3. `sourceSha256` matches the current source PNG file bytes.
 *   4. `cliVersion` matches the current script version.
 *   5. Every recorded output PNG still exists on disk and its bytes
 *      hash to the recorded `sha256` (so a hand-edited or partially
 *      deleted output triggers a rebuild).
 *
 * Anything less is a *miss* — the script runs the full swap for that
 * character and rewrites the manifest entry.
 *
 * --------------------------------------------------------------------
 * Why hash all outputs, not just inputs?
 * --------------------------------------------------------------------
 *
 * Cheap insurance. If a developer hand-edits a generated PNG (or `git
 * checkout` brings in a different version while the cache claims the
 * inputs are unchanged), input-only checks would falsely hit and ship
 * stale art. Output hashing keeps the manifest the single source of
 * truth for "what is on disk right now matches what the inputs say."
 *
 * --------------------------------------------------------------------
 * Determinism
 * --------------------------------------------------------------------
 *
 * `JSON.stringify` is called with sorted keys and a stable 2-space
 * indent so the manifest itself is byte-stable across runs. Combined
 * with `pngjs`'s deterministic encoder, this means a fresh checkout
 * that re-runs the swap produces a manifest identical to the one in
 * Git — `git diff --exit-code` is a valid CI assertion.
 */

import { createHash } from 'node:crypto';
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

/**
 * Bump this if the script's output format changes (filename convention,
 * pixel encoding, slot iteration order…). Mismatched versions in the
 * manifest force a full rebuild — the safe default.
 *
 * Keep this string short and grep-friendly: it appears verbatim in the
 * manifest JSON.
 */
export const CACHE_VERSION = '1';

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/** SHA-256 of a Buffer / Uint8Array, returned as lowercase hex. */
export function sha256Hex(bytes: Buffer | Uint8Array): string {
  const h = createHash('sha256');
  h.update(bytes);
  return h.digest('hex');
}

/** SHA-256 of a file's bytes. Streams via readFile (small files). */
export async function sha256File(path: string): Promise<string> {
  const bytes = await readFile(path);
  return sha256Hex(bytes);
}

// ---------------------------------------------------------------------------
// Manifest types
// ---------------------------------------------------------------------------

export interface CachedOutput {
  readonly filename: string;
  readonly sha256: string;
}

export interface CharacterCacheEntry {
  readonly paletteSha256: string;
  readonly sourceSha256: string;
  readonly cliVersion: string;
  readonly outputs: ReadonlyArray<CachedOutput>;
}

export interface CacheManifest {
  /** Free-form schema version; bumped with `CACHE_VERSION`. */
  readonly version: string;
  /** Map from character id (e.g. "wolf") to its cache entry. */
  readonly characters: Readonly<Record<string, CharacterCacheEntry>>;
}

const EMPTY_MANIFEST: CacheManifest = Object.freeze({
  version: CACHE_VERSION,
  characters: Object.freeze({}),
});

// ---------------------------------------------------------------------------
// Load / save
// ---------------------------------------------------------------------------

/**
 * Read the manifest from disk. Returns an empty manifest when the file
 * does not exist (first run) or when its version doesn't match the
 * current script — both are recoverable; the next save overwrites it.
 *
 * Malformed JSON is also treated as "no cache" rather than failing the
 * build: a build should never break because the cache file got corrupt.
 */
export async function loadCacheManifest(
  path: string,
): Promise<CacheManifest> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    // ENOENT or any read error → start fresh.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return EMPTY_MANIFEST;
    }
    return EMPTY_MANIFEST;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return EMPTY_MANIFEST;
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    return EMPTY_MANIFEST;
  }
  const obj = parsed as Record<string, unknown>;
  if (obj['version'] !== CACHE_VERSION) {
    return EMPTY_MANIFEST;
  }
  const charsRaw = obj['characters'];
  if (
    typeof charsRaw !== 'object' ||
    charsRaw === null ||
    Array.isArray(charsRaw)
  ) {
    return EMPTY_MANIFEST;
  }
  const characters: Record<string, CharacterCacheEntry> = {};
  for (const [id, entryRaw] of Object.entries(
    charsRaw as Record<string, unknown>,
  )) {
    const entry = parseCharacterEntry(entryRaw);
    if (entry) characters[id] = entry;
  }
  return Object.freeze({
    version: CACHE_VERSION,
    characters: Object.freeze(characters),
  });
}

function parseCharacterEntry(raw: unknown): CharacterCacheEntry | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const paletteSha256 = r['paletteSha256'];
  const sourceSha256 = r['sourceSha256'];
  const cliVersion = r['cliVersion'];
  const outputsRaw = r['outputs'];
  if (
    typeof paletteSha256 !== 'string' ||
    typeof sourceSha256 !== 'string' ||
    typeof cliVersion !== 'string' ||
    !Array.isArray(outputsRaw)
  ) {
    return null;
  }
  const outputs: CachedOutput[] = [];
  for (const o of outputsRaw) {
    if (typeof o !== 'object' || o === null) return null;
    const oo = o as Record<string, unknown>;
    if (typeof oo['filename'] !== 'string' || typeof oo['sha256'] !== 'string') {
      return null;
    }
    outputs.push({
      filename: oo['filename'] as string,
      sha256: oo['sha256'] as string,
    });
  }
  return Object.freeze({
    paletteSha256,
    sourceSha256,
    cliVersion,
    outputs: Object.freeze(outputs),
  });
}

/**
 * Serialize a manifest with stable key ordering and a 2-space indent.
 * The serialized form is byte-stable across runs given equal inputs.
 */
export function serializeCacheManifest(manifest: CacheManifest): string {
  // Sort character ids and `outputs` filenames so the file stays
  // diff-friendly regardless of insertion order.
  const characterIds = Object.keys(manifest.characters).sort();
  const orderedCharacters: Record<string, unknown> = {};
  for (const id of characterIds) {
    const e = manifest.characters[id]!;
    const orderedOutputs = [...e.outputs].sort((a, b) =>
      a.filename.localeCompare(b.filename),
    );
    orderedCharacters[id] = {
      paletteSha256: e.paletteSha256,
      sourceSha256: e.sourceSha256,
      cliVersion: e.cliVersion,
      outputs: orderedOutputs.map((o) => ({
        filename: o.filename,
        sha256: o.sha256,
      })),
    };
  }
  // Trailing newline matches POSIX text-file convention; keeps `git`
  // happy about no-newline-at-end-of-file warnings.
  return (
    JSON.stringify(
      { version: manifest.version, characters: orderedCharacters },
      null,
      2,
    ) + '\n'
  );
}

/** Write the manifest to disk, creating parent directories as needed. */
export async function saveCacheManifest(
  path: string,
  manifest: CacheManifest,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serializeCacheManifest(manifest), 'utf8');
}

// ---------------------------------------------------------------------------
// Hit detection
// ---------------------------------------------------------------------------

export interface CacheHitInputs {
  readonly characterId: string;
  readonly paletteSha256: string;
  readonly sourceSha256: string;
  /** Absolute paths the run *would* write. Order does not matter. */
  readonly expectedOutputPaths: ReadonlyArray<string>;
}

/**
 * Decide whether a character can be skipped. Verifies:
 *
 *   1. Manifest entry exists with matching cliVersion.
 *   2. Palette + source hashes match.
 *   3. Recorded output filenames match the expected set exactly
 *      (no missing outputs, no leftover ghost entries).
 *   4. Every recorded output file exists on disk and its bytes hash
 *      to the recorded sha256 — guards against hand-edits / partial
 *      deletes between builds.
 *
 * Returns `true` only when *all* checks pass.
 */
export async function isCacheHit(
  manifest: CacheManifest,
  inputs: CacheHitInputs,
  outputDir: string,
): Promise<boolean> {
  const entry = manifest.characters[inputs.characterId];
  if (!entry) return false;
  if (entry.cliVersion !== CACHE_VERSION) return false;
  if (entry.paletteSha256 !== inputs.paletteSha256) return false;
  if (entry.sourceSha256 !== inputs.sourceSha256) return false;

  const expectedFilenames = new Set(
    inputs.expectedOutputPaths.map((p) => p.split(/[\\/]/).pop()!),
  );
  if (entry.outputs.length !== expectedFilenames.size) return false;
  for (const o of entry.outputs) {
    if (!expectedFilenames.has(o.filename)) return false;
  }

  // Verify each output file is still on disk and unchanged.
  const { join } = await import('node:path');
  for (const o of entry.outputs) {
    const p = join(outputDir, o.filename);
    let st;
    try {
      st = await stat(p);
    } catch {
      return false;
    }
    if (!st.isFile()) return false;
    const actual = await sha256File(p);
    if (actual !== o.sha256) return false;
  }
  return true;
}

/**
 * Return a new manifest with an updated entry for `characterId`. The
 * input manifest is not mutated — callers accumulate updates and write
 * once at the end of the run.
 */
export function withCharacterEntry(
  manifest: CacheManifest,
  characterId: string,
  entry: CharacterCacheEntry,
): CacheManifest {
  return Object.freeze({
    version: manifest.version,
    characters: Object.freeze({
      ...manifest.characters,
      [characterId]: entry,
    }),
  });
}
