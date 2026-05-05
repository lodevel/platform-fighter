/**
 * Unit tests for the palette-swap build cache (Sub-AC 3 of AC 10203).
 *
 * Focus areas:
 *
 *   1. **Hash determinism** — `sha256Hex` returns identical output for
 *      identical input and changes for any single-byte difference.
 *
 *   2. **Manifest serialize/load round-trip** — write a manifest, load
 *      it, expect deep equality. Then bit-flip the file (bad version,
 *      malformed JSON, missing file) and confirm the loader degrades
 *      to "empty manifest" rather than throwing — a corrupt cache must
 *      never break the build.
 *
 *   3. **`isCacheHit` decision logic** — exhaustively cover the
 *      conditions that should produce a hit vs miss:
 *        - matching hashes, all outputs present + intact → hit
 *        - palette hash mismatch → miss
 *        - source hash mismatch → miss
 *        - cliVersion mismatch → miss
 *        - missing output file on disk → miss
 *        - tampered output file → miss
 *        - extra recorded output → miss
 *
 *   4. **End-to-end caching via `runPaletteSwapForAll`** — the headline
 *      acceptance test for Sub-AC 3:
 *        a. First run with a clean cache writes 8 PNGs and creates the
 *           manifest.
 *        b. Second run with no input changes is a *hit* — output mtimes
 *           are unchanged, no PNGs rewritten.
 *        c. Touching the palette JSON triggers a rebuild.
 *        d. `--force` (forceRebuild=true) bypasses an otherwise-valid
 *           cache.
 *        e. Deleting one output PNG invalidates the cache for that
 *           character.
 *
 * The end-to-end test creates an isolated `assets/` layout in a temp
 * directory by symlinking the real palette JSONs and source PNGs, so it
 * never touches the repo's real `assets/generated/` tree.
 */

import { describe, expect, it } from 'vitest';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CACHE_VERSION,
  type CacheManifest,
  type CharacterCacheEntry,
  isCacheHit,
  loadCacheManifest,
  saveCacheManifest,
  serializeCacheManifest,
  sha256Hex,
  withCharacterEntry,
} from './cache.js';
import { runPaletteSwapForCharacter } from './index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const REAL_PALETTES_DIR = join(REPO_ROOT, 'assets', 'palettes');
const REAL_CHARACTERS_DIR = join(REPO_ROOT, 'assets', 'characters');

// ---------------------------------------------------------------------------
// 1. Hashing
// ---------------------------------------------------------------------------

describe('sha256Hex', () => {
  it('is deterministic for identical input', () => {
    const a = sha256Hex(Buffer.from('hello'));
    const b = sha256Hex(Buffer.from('hello'));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
  it('differs for any single-byte change', () => {
    const a = sha256Hex(Buffer.from('hello'));
    const b = sha256Hex(Buffer.from('Hello'));
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// 2. Manifest serialize / load
// ---------------------------------------------------------------------------

function buildEntry(overrides: Partial<CharacterCacheEntry> = {}): CharacterCacheEntry {
  return Object.freeze({
    paletteSha256: 'a'.repeat(64),
    sourceSha256: 'b'.repeat(64),
    cliVersion: CACHE_VERSION,
    outputs: Object.freeze([
      { filename: '0_red.png', sha256: 'c'.repeat(64) },
      { filename: '1_blue.png', sha256: 'd'.repeat(64) },
    ]),
    ...overrides,
  });
}

describe('manifest round-trip', () => {
  it('serializes deterministically with sorted character ids', () => {
    const m1: CacheManifest = Object.freeze({
      version: CACHE_VERSION,
      characters: Object.freeze({
        wolf: buildEntry(),
        cat: buildEntry(),
      }),
    });
    const m2: CacheManifest = Object.freeze({
      version: CACHE_VERSION,
      characters: Object.freeze({
        cat: buildEntry(),
        wolf: buildEntry(),
      }),
    });
    expect(serializeCacheManifest(m1)).toBe(serializeCacheManifest(m2));
    // cat sorts before wolf
    const text = serializeCacheManifest(m1);
    expect(text.indexOf('"cat"')).toBeLessThan(text.indexOf('"wolf"'));
    expect(text.endsWith('\n')).toBe(true);
  });

  it('saves and re-loads a manifest with structural equality', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'palette-cache-'));
    try {
      const path = join(tmp, '.palette-cache.json');
      const original: CacheManifest = Object.freeze({
        version: CACHE_VERSION,
        characters: Object.freeze({ wolf: buildEntry() }),
      });
      await saveCacheManifest(path, original);
      const loaded = await loadCacheManifest(path);
      expect(loaded.version).toBe(CACHE_VERSION);
      expect(Object.keys(loaded.characters)).toEqual(['wolf']);
      expect(loaded.characters['wolf']).toEqual(original.characters['wolf']);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('loadCacheManifest degrades gracefully', () => {
  it('returns empty manifest when file is missing', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'palette-cache-'));
    try {
      const m = await loadCacheManifest(join(tmp, 'nope.json'));
      expect(m.version).toBe(CACHE_VERSION);
      expect(Object.keys(m.characters)).toEqual([]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('returns empty manifest on malformed JSON', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'palette-cache-'));
    try {
      const path = join(tmp, '.palette-cache.json');
      await writeFile(path, '{not json', 'utf8');
      const m = await loadCacheManifest(path);
      expect(Object.keys(m.characters)).toEqual([]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('returns empty manifest on version mismatch', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'palette-cache-'));
    try {
      const path = join(tmp, '.palette-cache.json');
      await writeFile(
        path,
        JSON.stringify({ version: 'old-v0', characters: { wolf: {} } }),
        'utf8',
      );
      const m = await loadCacheManifest(path);
      expect(Object.keys(m.characters)).toEqual([]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('drops malformed character entries but keeps the manifest', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'palette-cache-'));
    try {
      const path = join(tmp, '.palette-cache.json');
      await writeFile(
        path,
        JSON.stringify({
          version: CACHE_VERSION,
          characters: {
            wolf: { paletteSha256: 'x', sourceSha256: 'y' /* missing fields */ },
            cat: {
              paletteSha256: 'p',
              sourceSha256: 's',
              cliVersion: CACHE_VERSION,
              outputs: [{ filename: '0_a.png', sha256: 'h' }],
            },
          },
        }),
        'utf8',
      );
      const m = await loadCacheManifest(path);
      expect(Object.keys(m.characters)).toEqual(['cat']);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 3. isCacheHit decision logic
// ---------------------------------------------------------------------------

async function setupCacheHitFixture() {
  const tmp = await mkdtemp(join(tmpdir(), 'palette-cache-'));
  // Two fake output PNGs on disk with known content + hashes.
  const out1 = join(tmp, '0_red.png');
  const out2 = join(tmp, '1_blue.png');
  await writeFile(out1, 'red-bytes');
  await writeFile(out2, 'blue-bytes');
  const entry: CharacterCacheEntry = Object.freeze({
    paletteSha256: 'PAL-HASH',
    sourceSha256: 'SRC-HASH',
    cliVersion: CACHE_VERSION,
    outputs: Object.freeze([
      { filename: '0_red.png', sha256: sha256Hex(Buffer.from('red-bytes')) },
      { filename: '1_blue.png', sha256: sha256Hex(Buffer.from('blue-bytes')) },
    ]),
  });
  const manifest: CacheManifest = Object.freeze({
    version: CACHE_VERSION,
    characters: Object.freeze({ wolf: entry }),
  });
  return { tmp, out1, out2, manifest, entry };
}

describe('isCacheHit', () => {
  it('returns true when everything matches', async () => {
    const { tmp, out1, out2, manifest } = await setupCacheHitFixture();
    try {
      expect(
        await isCacheHit(
          manifest,
          {
            characterId: 'wolf',
            paletteSha256: 'PAL-HASH',
            sourceSha256: 'SRC-HASH',
            expectedOutputPaths: [out1, out2],
          },
          tmp,
        ),
      ).toBe(true);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('returns false when no entry exists', async () => {
    const { tmp, out1, out2, manifest } = await setupCacheHitFixture();
    try {
      expect(
        await isCacheHit(
          manifest,
          {
            characterId: 'cat',
            paletteSha256: 'PAL-HASH',
            sourceSha256: 'SRC-HASH',
            expectedOutputPaths: [out1, out2],
          },
          tmp,
        ),
      ).toBe(false);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('returns false when palette hash differs', async () => {
    const { tmp, out1, out2, manifest } = await setupCacheHitFixture();
    try {
      expect(
        await isCacheHit(
          manifest,
          {
            characterId: 'wolf',
            paletteSha256: 'CHANGED',
            sourceSha256: 'SRC-HASH',
            expectedOutputPaths: [out1, out2],
          },
          tmp,
        ),
      ).toBe(false);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('returns false when source hash differs', async () => {
    const { tmp, out1, out2, manifest } = await setupCacheHitFixture();
    try {
      expect(
        await isCacheHit(
          manifest,
          {
            characterId: 'wolf',
            paletteSha256: 'PAL-HASH',
            sourceSha256: 'CHANGED',
            expectedOutputPaths: [out1, out2],
          },
          tmp,
        ),
      ).toBe(false);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('returns false when cliVersion differs', async () => {
    const { tmp, out1, out2, entry } = await setupCacheHitFixture();
    const stale: CacheManifest = Object.freeze({
      version: CACHE_VERSION,
      characters: Object.freeze({
        wolf: { ...entry, cliVersion: 'old-v0' },
      }),
    });
    try {
      expect(
        await isCacheHit(
          stale,
          {
            characterId: 'wolf',
            paletteSha256: 'PAL-HASH',
            sourceSha256: 'SRC-HASH',
            expectedOutputPaths: [out1, out2],
          },
          tmp,
        ),
      ).toBe(false);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('returns false when an output PNG is missing on disk', async () => {
    const { tmp, out1, out2, manifest } = await setupCacheHitFixture();
    try {
      await rm(out2);
      expect(
        await isCacheHit(
          manifest,
          {
            characterId: 'wolf',
            paletteSha256: 'PAL-HASH',
            sourceSha256: 'SRC-HASH',
            expectedOutputPaths: [out1, out2],
          },
          tmp,
        ),
      ).toBe(false);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('returns false when an output PNG was hand-edited', async () => {
    const { tmp, out1, out2, manifest } = await setupCacheHitFixture();
    try {
      await writeFile(out2, 'tampered');
      expect(
        await isCacheHit(
          manifest,
          {
            characterId: 'wolf',
            paletteSha256: 'PAL-HASH',
            sourceSha256: 'SRC-HASH',
            expectedOutputPaths: [out1, out2],
          },
          tmp,
        ),
      ).toBe(false);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('returns false when the recorded output set has the wrong size', async () => {
    const { tmp, out1, out2, entry } = await setupCacheHitFixture();
    const padded: CacheManifest = Object.freeze({
      version: CACHE_VERSION,
      characters: Object.freeze({
        wolf: {
          ...entry,
          outputs: [
            ...entry.outputs,
            { filename: '2_ghost.png', sha256: 'z'.repeat(64) },
          ],
        },
      }),
    });
    try {
      expect(
        await isCacheHit(
          padded,
          {
            characterId: 'wolf',
            paletteSha256: 'PAL-HASH',
            sourceSha256: 'SRC-HASH',
            expectedOutputPaths: [out1, out2],
          },
          tmp,
        ),
      ).toBe(false);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 4. withCharacterEntry purity
// ---------------------------------------------------------------------------

describe('withCharacterEntry', () => {
  it('returns a new manifest without mutating the input', () => {
    const before: CacheManifest = Object.freeze({
      version: CACHE_VERSION,
      characters: Object.freeze({}),
    });
    const after = withCharacterEntry(before, 'wolf', buildEntry());
    expect(Object.keys(before.characters)).toEqual([]);
    expect(Object.keys(after.characters)).toEqual(['wolf']);
    expect(after).not.toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 5. End-to-end: runPaletteSwapForCharacter with cache
// ---------------------------------------------------------------------------

/**
 * Build an isolated character workspace by copying real assets into a
 * tmpdir. We use copies (not symlinks) so the test can mutate inputs
 * to trigger cache misses without touching the repo.
 */
async function setupRealCatWorkspace(): Promise<{
  tmp: string;
  paletteJson: string;
  inputPng: string;
  outputDir: string;
  manifestPath: string;
}> {
  const tmp = await mkdtemp(join(tmpdir(), 'palette-e2e-'));
  const paletteJson = join(tmp, 'cat.json');
  const inputPng = join(tmp, 'cat_source_sheet.png');
  await copyFile(join(REAL_PALETTES_DIR, 'cat.json'), paletteJson);
  await copyFile(
    join(REAL_CHARACTERS_DIR, 'cat', 'cat_source_sheet.png'),
    inputPng,
  );
  const outputDir = join(tmp, 'out');
  const manifestPath = join(tmp, '.palette-cache.json');
  await mkdir(outputDir, { recursive: true });
  return { tmp, paletteJson, inputPng, outputDir, manifestPath };
}

async function getMtimes(dir: string, filenames: ReadonlyArray<string>): Promise<number[]> {
  const out: number[] = [];
  for (const f of filenames) {
    const s = await stat(join(dir, f));
    out.push(s.mtimeMs);
  }
  return out;
}

const CAT_OUTPUT_FILENAMES = [
  '0_sky.png',
  '1_fuchsia.png',
  '2_mint.png',
  '3_lavender.png',
  '4_coral.png',
  '5_lime.png',
  '6_teal.png',
  '7_shadow.png',
] as const;

describe('runPaletteSwapForCharacter — cache integration', () => {
  it('first run is a miss + writes outputs + emits a cache entry', async () => {
    const ws = await setupRealCatWorkspace();
    try {
      const manifest = await loadCacheManifest(ws.manifestPath);
      const r = await runPaletteSwapForCharacter({
        characterId: 'cat',
        inputPng: ws.inputPng,
        paletteJson: ws.paletteJson,
        outputDir: ws.outputDir,
        log: () => {},
        cacheManifest: manifest,
      });
      expect(r.cacheHit).toBe(false);
      expect(r.outputs.length).toBe(8);
      expect(r.cacheEntry).toBeDefined();
      expect(r.cacheEntry!.outputs.length).toBe(8);
      // Cache entry hashes must match the actual on-disk files.
      for (const o of r.cacheEntry!.outputs) {
        const bytes = await readFile(join(ws.outputDir, o.filename));
        expect(sha256Hex(bytes)).toBe(o.sha256);
      }
    } finally {
      await rm(ws.tmp, { recursive: true, force: true });
    }
  }, 30_000);

  it('second run with unchanged inputs is a cache hit and writes nothing', async () => {
    const ws = await setupRealCatWorkspace();
    try {
      // Run 1: populate the cache.
      let manifest = await loadCacheManifest(ws.manifestPath);
      const first = await runPaletteSwapForCharacter({
        characterId: 'cat',
        inputPng: ws.inputPng,
        paletteJson: ws.paletteJson,
        outputDir: ws.outputDir,
        log: () => {},
        cacheManifest: manifest,
      });
      manifest = withCharacterEntry(manifest, 'cat', first.cacheEntry!);
      await saveCacheManifest(ws.manifestPath, manifest);

      // Snapshot mtimes BEFORE the second run.
      const before = await getMtimes(ws.outputDir, CAT_OUTPUT_FILENAMES);
      // Roll mtimes back so any rewrite would be obvious in the diff.
      // (Some filesystems quantize mtime to 1s — rolling helps disambiguate.)
      const past = new Date(Date.now() - 60_000);
      for (const f of CAT_OUTPUT_FILENAMES) {
        await utimes(join(ws.outputDir, f), past, past);
      }

      // Run 2: should be a hit.
      const reloaded = await loadCacheManifest(ws.manifestPath);
      const second = await runPaletteSwapForCharacter({
        characterId: 'cat',
        inputPng: ws.inputPng,
        paletteJson: ws.paletteJson,
        outputDir: ws.outputDir,
        log: () => {},
        cacheManifest: reloaded,
      });
      expect(second.cacheHit).toBe(true);
      expect(second.outputs.length).toBe(0); // no work performed
      expect(second.cacheEntry).toBeUndefined(); // no manifest delta

      // mtimes still set to the rolled-back value → no rewrite happened.
      const after = await getMtimes(ws.outputDir, CAT_OUTPUT_FILENAMES);
      for (const t of after) {
        expect(t).toBeLessThan(before[0]!); // each well below "now"
        expect(Math.abs(t - past.getTime())).toBeLessThan(2_000);
      }
    } finally {
      await rm(ws.tmp, { recursive: true, force: true });
    }
  }, 30_000);

  it('palette JSON change triggers a rebuild', async () => {
    const ws = await setupRealCatWorkspace();
    try {
      let manifest = await loadCacheManifest(ws.manifestPath);
      const first = await runPaletteSwapForCharacter({
        characterId: 'cat',
        inputPng: ws.inputPng,
        paletteJson: ws.paletteJson,
        outputDir: ws.outputDir,
        log: () => {},
        cacheManifest: manifest,
      });
      manifest = withCharacterEntry(manifest, 'cat', first.cacheEntry!);

      // Mutate the palette JSON in a benign way: add whitespace. The
      // bytes change, so the hash changes, so the cache must miss —
      // even though the parsed palette is semantically identical.
      const original = await readFile(ws.paletteJson, 'utf8');
      await writeFile(ws.paletteJson, original + '\n', 'utf8');

      const second = await runPaletteSwapForCharacter({
        characterId: 'cat',
        inputPng: ws.inputPng,
        paletteJson: ws.paletteJson,
        outputDir: ws.outputDir,
        log: () => {},
        cacheManifest: manifest,
      });
      expect(second.cacheHit).toBe(false);
      expect(second.cacheEntry).toBeDefined();
      // New entry's palette hash must differ from the first run's.
      expect(second.cacheEntry!.paletteSha256).not.toBe(
        first.cacheEntry!.paletteSha256,
      );
    } finally {
      await rm(ws.tmp, { recursive: true, force: true });
    }
  }, 30_000);

  it('forceRebuild bypasses an otherwise-valid cache hit', async () => {
    const ws = await setupRealCatWorkspace();
    try {
      let manifest = await loadCacheManifest(ws.manifestPath);
      const first = await runPaletteSwapForCharacter({
        characterId: 'cat',
        inputPng: ws.inputPng,
        paletteJson: ws.paletteJson,
        outputDir: ws.outputDir,
        log: () => {},
        cacheManifest: manifest,
      });
      manifest = withCharacterEntry(manifest, 'cat', first.cacheEntry!);

      const forced = await runPaletteSwapForCharacter({
        characterId: 'cat',
        inputPng: ws.inputPng,
        paletteJson: ws.paletteJson,
        outputDir: ws.outputDir,
        log: () => {},
        cacheManifest: manifest,
        forceRebuild: true,
      });
      expect(forced.cacheHit).toBe(false);
      expect(forced.outputs.length).toBe(8);
      expect(forced.cacheEntry).toBeDefined();
    } finally {
      await rm(ws.tmp, { recursive: true, force: true });
    }
  }, 30_000);

  it('deleting an output PNG invalidates the cache', async () => {
    const ws = await setupRealCatWorkspace();
    try {
      let manifest = await loadCacheManifest(ws.manifestPath);
      const first = await runPaletteSwapForCharacter({
        characterId: 'cat',
        inputPng: ws.inputPng,
        paletteJson: ws.paletteJson,
        outputDir: ws.outputDir,
        log: () => {},
        cacheManifest: manifest,
      });
      manifest = withCharacterEntry(manifest, 'cat', first.cacheEntry!);

      await rm(join(ws.outputDir, '4_coral.png'));

      const second = await runPaletteSwapForCharacter({
        characterId: 'cat',
        inputPng: ws.inputPng,
        paletteJson: ws.paletteJson,
        outputDir: ws.outputDir,
        log: () => {},
        cacheManifest: manifest,
      });
      expect(second.cacheHit).toBe(false);
      // The deleted file is back.
      const restored = await stat(join(ws.outputDir, '4_coral.png'));
      expect(restored.isFile()).toBe(true);
    } finally {
      await rm(ws.tmp, { recursive: true, force: true });
    }
  }, 30_000);
});
