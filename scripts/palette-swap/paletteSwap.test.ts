/**
 * Unit tests for the palette-swap pipeline (Sub-AC 2 of AC 10202).
 *
 * Coverage strategy:
 *
 *   1. **Hex parsing** — surface-level format guards (rejects, accepts,
 *      round-trip) so a bad hex value in a palette JSON always fails
 *      with an actionable error.
 *
 *   2. **Definition validator** — drive `parsePaletteDefinition` with
 *      hand-rolled JS objects (no fixture files) and assert each schema
 *      invariant (variant count = 8, indexes 0..7 in order, exactly one
 *      canonical, `from` matches the file-root source slot, …).
 *
 *   3. **Pixel transform** — build a 4×1 RGBA buffer covering body /
 *      accent / highlight / unmatched and verify the output bytes
 *      match exactly. Also exercise alpha preservation and the
 *      transparent-pixel skip.
 *
 *   4. **Determinism** — run the transform twice on the same input and
 *      `expect(a).toEqual(b)` byte-for-byte. The Seed makes determinism
 *      a hard contract for the engine; the build pipeline must honour
 *      it too so the generated PNGs don't drift between runs.
 *
 *   5. **PNG codec round-trip** — encode then decode a small RGBA
 *      buffer through `pngjs` and confirm the bytes survive.
 *
 *   6. **End-to-end runner** — call `runPaletteSwapForCharacter` with
 *      a temporary directory + the real `cat.json` palette and the real
 *      cat source sheet from `assets/characters/cat/`. Assert all 8
 *      output PNGs exist with the expected filenames and that the
 *      canonical (variant 0) output is byte-identical to the source.
 */

import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CHARACTER_IDS,
  VARIANTS_PER_CHARACTER,
  formatHexColor,
  loadPaletteDefinition,
  parseHexColor,
  parsePaletteDefinition,
} from './paletteDefinition.js';
import { applyPaletteVariant, readPackedRgb } from './paletteSwap.js';
import { decodePngBuffer, encodePngBuffer } from './pngCodec.js';
import {
  runPaletteSwapForCharacter,
  slugifyVariantName,
  variantOutputFilename,
  parseCliArgs,
} from './index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

// ---------------------------------------------------------------------------
// Hex parsing
// ---------------------------------------------------------------------------

describe('parseHexColor / formatHexColor', () => {
  it('parses lowercase #rrggbb', () => {
    expect(parseHexColor('#c24a4a', 'x')).toBe(0xc24a4a);
  });
  it('parses uppercase hex', () => {
    expect(parseHexColor('#FF00AA', 'x')).toBe(0xff00aa);
  });
  it('rejects missing hash', () => {
    expect(() => parseHexColor('c24a4a', 'x')).toThrow(/invalid hex/);
  });
  it('rejects 3-digit shorthand', () => {
    expect(() => parseHexColor('#abc', 'x')).toThrow(/invalid hex/);
  });
  it('rejects non-hex chars', () => {
    expect(() => parseHexColor('#zz0000', 'x')).toThrow(/invalid hex/);
  });
  it('rejects non-string input with descriptive error', () => {
    expect(() => parseHexColor(0xff0000, 'source.body')).toThrow(
      /source\.body: expected hex string/,
    );
  });
  it('round-trips through formatHexColor', () => {
    for (const hex of ['#000000', '#ffffff', '#c24a4a', '#a0d8ff']) {
      expect(formatHexColor(parseHexColor(hex, 't'))).toBe(hex);
    }
  });
  it('formatHexColor zero-pads short colours', () => {
    expect(formatHexColor(0x0000ff)).toBe('#0000ff');
    expect(formatHexColor(0)).toBe('#000000');
  });
});

// ---------------------------------------------------------------------------
// Definition validator
// ---------------------------------------------------------------------------

function validVariant(
  index: number,
  to: { body: string; accent: string; highlight: string },
  source: { body: string; accent: string; highlight: string },
  isCanonical = false,
) {
  return {
    index,
    name: `Variant${index}`,
    ...(isCanonical ? { isCanonical: true } : {}),
    mappings: {
      body: { from: source.body, to: to.body },
      accent: { from: source.accent, to: to.accent },
      highlight: { from: source.highlight, to: to.highlight },
    },
  };
}

function buildValidDefinition() {
  const source = {
    body: '#c24a4a',
    accent: '#ffe0a0',
    highlight: '#ffe0a0',
  };
  return {
    characterId: 'wolf',
    displayName: 'Wolf',
    source,
    variants: [
      validVariant(0, source, source, true),
      validVariant(1, { body: '#4a6ec2', accent: '#a0c8ff', highlight: '#a0c8ff' }, source),
      validVariant(2, { body: '#c2a44a', accent: '#fff5a0', highlight: '#fff5a0' }, source),
      validVariant(3, { body: '#4ac26a', accent: '#b0ffb8', highlight: '#b0ffb8' }, source),
      validVariant(4, { body: '#8b4ac2', accent: '#d0a0ff', highlight: '#d0a0ff' }, source),
      validVariant(5, { body: '#c2784a', accent: '#ffd6a0', highlight: '#ffd6a0' }, source),
      validVariant(6, { body: '#4ac2b8', accent: '#a0fff0', highlight: '#a0fff0' }, source),
      validVariant(7, { body: '#c24a8a', accent: '#ffa0d0', highlight: '#ffa0d0' }, source),
    ],
  };
}

describe('parsePaletteDefinition', () => {
  it('accepts a well-formed definition with 8 variants', () => {
    const parsed = parsePaletteDefinition(buildValidDefinition());
    expect(parsed.characterId).toBe('wolf');
    expect(parsed.variants.length).toBe(VARIANTS_PER_CHARACTER);
    expect(parsed.variants[0]!.isCanonical).toBe(true);
    expect(parsed.source.body).toBe(0xc24a4a);
    expect(parsed.variants[1]!.mappings[0]!.target).toBe(0x4a6ec2);
  });

  it('rejects an unknown characterId', () => {
    const def = buildValidDefinition();
    (def as { characterId: string }).characterId = 'tiger';
    expect(() => parsePaletteDefinition(def)).toThrow(/characterId/);
  });

  it('rejects fewer than 8 variants', () => {
    const def = buildValidDefinition();
    def.variants.pop();
    expect(() => parsePaletteDefinition(def)).toThrow(/exactly 8/);
  });

  it('rejects a non-canonical variant 0', () => {
    const def = buildValidDefinition();
    delete (def.variants[0] as { isCanonical?: boolean }).isCanonical;
    expect(() => parsePaletteDefinition(def)).toThrow(/canonical/);
  });

  it('rejects two canonical variants', () => {
    // Re-mark variant 1 as canonical AND give it identity mappings so the
    // per-variant "canonical must keep source colour" check passes; the
    // post-loop canonical-count check is what we want to exercise here.
    const def = buildValidDefinition();
    const src = def.source;
    def.variants[1] = validVariant(1, src, src, true);
    expect(() => parsePaletteDefinition(def)).toThrow(/exactly 1 canonical/);
  });

  it('rejects misordered variant indices', () => {
    const def = buildValidDefinition();
    (def.variants[3] as { index: number }).index = 9;
    expect(() => parsePaletteDefinition(def)).toThrow(/index/);
  });

  it('rejects mappings.<slot>.from that disagrees with source.<slot>', () => {
    const def = buildValidDefinition();
    (def.variants[2]!.mappings.body as { from: string }).from = '#000000';
    expect(() => parsePaletteDefinition(def)).toThrow(/must equal source\.body/);
  });

  it('rejects canonical variant whose to differs from source', () => {
    const def = buildValidDefinition();
    (def.variants[0]!.mappings.body as { to: string }).to = '#000000';
    expect(() => parsePaletteDefinition(def)).toThrow(/canonical variant must keep/);
  });

  it('rejects unknown slot keys in source', () => {
    const def = buildValidDefinition();
    (def.source as Record<string, string>).shadow = '#000000';
    expect(() => parsePaletteDefinition(def)).toThrow(/unexpected key/);
  });

  it('rejects missing displayName', () => {
    const def = buildValidDefinition();
    (def as { displayName?: string }).displayName = '';
    expect(() => parsePaletteDefinition(def)).toThrow(/displayName/);
  });
});

// ---------------------------------------------------------------------------
// Loader (real palette files on disk)
// ---------------------------------------------------------------------------

describe('loadPaletteDefinition (real files)', () => {
  for (const id of CHARACTER_IDS) {
    it(`loads assets/palettes/${id}.json`, async () => {
      const def = await loadPaletteDefinition(
        join(REPO_ROOT, 'assets', 'palettes', `${id}.json`),
      );
      expect(def.characterId).toBe(id);
      expect(def.variants.length).toBe(VARIANTS_PER_CHARACTER);
      expect(def.variants[0]!.isCanonical).toBe(true);
    });
  }

  it('reports a clean error for a missing file', async () => {
    await expect(
      loadPaletteDefinition(
        join(REPO_ROOT, 'assets', 'palettes', 'no-such.json'),
      ),
    ).rejects.toThrow(/cannot read/);
  });
});

// ---------------------------------------------------------------------------
// Pixel transform — the deterministic core
// ---------------------------------------------------------------------------

/** 1×4 RGBA buffer: body, accent, highlight, unmatched. */
function build4PixelBuffer(): {
  pixels: Uint8Array;
  width: number;
  height: number;
} {
  // Slot colours match the wolf canonical:
  //   body      = #c24a4a
  //   accent    = #ffe0a0
  //   highlight = #ffe0a0
  // Unmatched: pure black with full alpha.
  const px = new Uint8Array([
    0xc2, 0x4a, 0x4a, 0xff, // body — fully opaque
    0xff, 0xe0, 0xa0, 0x80, // accent — half-alpha (must be preserved)
    0xff, 0xe0, 0xa0, 0xff, // highlight (same RGB as accent in this test)
    0x00, 0x00, 0x00, 0xff, // unmatched neutral
  ]);
  return { pixels: px, width: 4, height: 1 };
}

describe('applyPaletteVariant', () => {
  it('rewrites slot pixels and passes through unmatched ones', () => {
    const def = parsePaletteDefinition(buildValidDefinition());
    const cobalt = def.variants[1]!; // body→#4a6ec2, accent/highlight→#a0c8ff
    const { pixels: src, width, height } = build4PixelBuffer();

    const { pixels: out, stats } = applyPaletteVariant(src, width, height, cobalt);

    // body pixel
    expect(readPackedRgb(out, 0)).toBe(0x4a6ec2);
    expect(out[3]).toBe(0xff); // alpha preserved
    // accent pixel: same RGB as highlight in source — first matching slot wins.
    // PALETTE_SLOTS = [body, accent, highlight] so accent matches first.
    expect(readPackedRgb(out, 4)).toBe(0xa0c8ff);
    expect(out[7]).toBe(0x80); // half-alpha preserved
    // "highlight" pixel — in this test it shares RGB with accent, so the
    // accent rewrite already captured it. Remap is by colour, not by
    // position, which is the documented contract.
    expect(readPackedRgb(out, 8)).toBe(0xa0c8ff);
    expect(out[11]).toBe(0xff);
    // unmatched neutral
    expect(readPackedRgb(out, 12)).toBe(0x000000);
    expect(out[15]).toBe(0xff);

    expect(stats.totalPixels).toBe(4);
    expect(stats.transparentPixels).toBe(0);
    // Note: highlight count is 0 because the accent slot caught its
    // duplicate-colour pixel first — accurate, not a bug.
    expect(stats.perSlot.body).toBe(1);
    expect(stats.perSlot.accent).toBe(2);
    expect(stats.perSlot.highlight).toBe(0);
    expect(stats.passThroughPixels).toBe(1);
  });

  it('canonical variant produces an identical-colour copy', () => {
    const def = parsePaletteDefinition(buildValidDefinition());
    const { pixels: src, width, height } = build4PixelBuffer();
    const { pixels: out, stats } = applyPaletteVariant(
      src,
      width,
      height,
      def.variants[0]!,
    );
    expect(out).toEqual(src);
    expect(stats.isCanonical).toBe(true);
  });

  it('skips fully transparent pixels (alpha=0)', () => {
    const def = parsePaletteDefinition(buildValidDefinition());
    // 1 transparent pixel whose RGB happens to match body. Must NOT be
    // recoloured — alpha=0 pixels are skipped entirely so the script
    // never paints meaningful colour into a region the artist marked as
    // empty.
    const px = new Uint8Array([0xc2, 0x4a, 0x4a, 0x00]);
    const { pixels: out, stats } = applyPaletteVariant(px, 1, 1, def.variants[1]!);
    expect(readPackedRgb(out, 0)).toBe(0xc24a4a);
    expect(out[3]).toBe(0x00);
    expect(stats.transparentPixels).toBe(1);
    expect(stats.perSlot.body).toBe(0);
  });

  it('does not mutate the input buffer', () => {
    const def = parsePaletteDefinition(buildValidDefinition());
    const { pixels: src, width, height } = build4PixelBuffer();
    const before = new Uint8Array(src);
    applyPaletteVariant(src, width, height, def.variants[3]!);
    expect(src).toEqual(before);
  });

  it('throws on buffer-size mismatch', () => {
    const def = parsePaletteDefinition(buildValidDefinition());
    expect(() =>
      applyPaletteVariant(new Uint8Array(15), 4, 1, def.variants[0]!),
    ).toThrow(/does not match/);
  });

  it('is deterministic — same input twice yields identical output', () => {
    const def = parsePaletteDefinition(buildValidDefinition());
    const { pixels: src, width, height } = build4PixelBuffer();
    const a = applyPaletteVariant(src, width, height, def.variants[5]!);
    const b = applyPaletteVariant(src, width, height, def.variants[5]!);
    expect(a.pixels).toEqual(b.pixels);
  });
});

// ---------------------------------------------------------------------------
// PNG codec round-trip
// ---------------------------------------------------------------------------

describe('pngCodec', () => {
  it('encode → decode round-trips an RGBA buffer byte-for-byte', () => {
    const w = 4;
    const h = 1;
    const src = new Uint8Array([
      255, 0, 0, 255,
      0, 255, 0, 128,
      0, 0, 255, 0, // fully transparent
      128, 128, 128, 255,
    ]);
    const png = encodePngBuffer(src, w, h);
    const decoded = decodePngBuffer(png, '<test>');
    expect(decoded.width).toBe(w);
    expect(decoded.height).toBe(h);
    expect(decoded.pixels).toEqual(src);
  });

  it('rejects mismatched buffer sizes on encode', () => {
    expect(() => encodePngBuffer(new Uint8Array(15), 4, 1)).toThrow(/does not match/);
  });

  it('reports a clean error on non-PNG bytes', () => {
    expect(() => decodePngBuffer(Buffer.from('not a png'), '<test>')).toThrow(
      /not a valid PNG/,
    );
  });
});

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

describe('parseCliArgs', () => {
  it('default → all-characters mode', () => {
    expect(parseCliArgs([])).toEqual({
      mode: 'all',
      only: [],
      forceRebuild: false,
    });
  });
  it('positional ids → subset mode', () => {
    expect(parseCliArgs(['wolf', 'cat'])).toEqual({
      mode: 'subset',
      only: ['wolf', 'cat'],
      forceRebuild: false,
    });
  });
  it('explicit --in/--palette/--out → explicit mode', () => {
    const r = parseCliArgs([
      '--in', 'a.png',
      '--palette', 'p.json',
      '--out', 'out',
      '--character', 'cat',
    ]);
    expect(r.mode).toBe('explicit');
    expect(r.inputPng).toBe('a.png');
    expect(r.paletteJson).toBe('p.json');
    expect(r.outputDir).toBe('out');
    expect(r.characterId).toBe('cat');
    expect(r.forceRebuild).toBe(false);
  });
  it('--force flag is parsed in all/subset/explicit modes', () => {
    expect(parseCliArgs(['--force']).forceRebuild).toBe(true);
    expect(parseCliArgs(['-f']).forceRebuild).toBe(true);
    expect(parseCliArgs(['wolf', '--force']).forceRebuild).toBe(true);
    expect(
      parseCliArgs([
        '--in', 'a.png',
        '--palette', 'p.json',
        '--out', 'o',
        '--force',
      ]).forceRebuild,
    ).toBe(true);
  });
  it('partial --in without --palette/--out errors', () => {
    expect(() => parseCliArgs(['--in', 'a.png'])).toThrow(/all be supplied together/);
  });
  it('unknown character id errors', () => {
    expect(() => parseCliArgs(['tiger'])).toThrow(/unknown character/);
  });
  it('unknown flag errors', () => {
    expect(() => parseCliArgs(['--bogus'])).toThrow(/unknown flag/);
  });
});

// ---------------------------------------------------------------------------
// Filename helpers
// ---------------------------------------------------------------------------

describe('output filename helpers', () => {
  it('slugifyVariantName lowercases and dashes', () => {
    expect(slugifyVariantName('Crimson')).toBe('crimson');
    expect(slugifyVariantName('Sky Blue!')).toBe('sky-blue');
    expect(slugifyVariantName('  Forest__Green ')).toBe('forest-green');
  });
  it('variantOutputFilename composes index_slug.png', () => {
    expect(variantOutputFilename(0, 'Crimson')).toBe('0_crimson.png');
    expect(variantOutputFilename(7, 'Sky Blue')).toBe('7_sky-blue.png');
  });
});

// ---------------------------------------------------------------------------
// End-to-end with the real cat sheet
// ---------------------------------------------------------------------------

describe('runPaletteSwapForCharacter — end-to-end against real cat assets', () => {
  it('writes 8 variant PNGs, with variant 0 byte-identical to the source', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'palette-swap-'));
    try {
      const inputPng = join(
        REPO_ROOT,
        'assets',
        'characters',
        'cat',
        'cat_source_sheet.png',
      );
      const paletteJson = join(REPO_ROOT, 'assets', 'palettes', 'cat.json');
      const log: string[] = [];
      const result = await runPaletteSwapForCharacter({
        characterId: 'cat',
        inputPng,
        paletteJson,
        outputDir: tmp,
        log: (l) => log.push(l),
      });

      expect(result.outputs.length).toBe(VARIANTS_PER_CHARACTER);
      const written = (await readdir(tmp)).sort();
      expect(written).toEqual([
        '0_sky.png',
        '1_fuchsia.png',
        '2_mint.png',
        '3_lavender.png',
        '4_coral.png',
        '5_lime.png',
        '6_teal.png',
        '7_shadow.png',
      ]);

      // Variant 0 (canonical) decoded should equal the source decoded —
      // identity remap, every pixel passes through unchanged.
      const srcDecoded = decodePngBuffer(await readFile(inputPng), inputPng);
      const v0Decoded = decodePngBuffer(
        await readFile(join(tmp, '0_sky.png')),
        '0_sky.png',
      );
      expect(v0Decoded.width).toBe(srcDecoded.width);
      expect(v0Decoded.height).toBe(srcDecoded.height);
      expect(v0Decoded.pixels).toEqual(srcDecoded.pixels);

      // Note: we deliberately do NOT assert that variant 1 differs from
      // the source here. Whether real pixels actually get remapped
      // depends on whether the canonical source colours declared in
      // `cat.json` (Sub-AC 1) literally appear in `cat_source_sheet.png`.
      // That alignment is Sub-AC 1 / asset-authoring concern; this
      // Sub-AC 2 only owns the *script*. The synthetic-PNG test below
      // proves the remap actually rewrites pixels when source colours
      // are present.

      // Determinism: re-running into a second tmp dir produces
      // byte-identical output for every variant.
      const tmp2 = await mkdtemp(join(tmpdir(), 'palette-swap-'));
      try {
        await runPaletteSwapForCharacter({
          characterId: 'cat',
          inputPng,
          paletteJson,
          outputDir: tmp2,
          log: () => {},
        });
        for (const name of written) {
          const a = await readFile(join(tmp, name));
          const b = await readFile(join(tmp2, name));
          expect(a.equals(b)).toBe(true);
        }
      } finally {
        await rm(tmp2, { recursive: true, force: true });
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }, 30_000);

  it('end-to-end against a synthetic PNG actually rewrites pixels', async () => {
    // Build a 2×2 RGBA test image whose colours line up exactly with
    // wolf.json's source slots, write it to disk, run the swap, and
    // verify variant 1 (Cobalt) recoloured every body pixel.
    const tmp = await mkdtemp(join(tmpdir(), 'palette-swap-syn-'));
    try {
      const synPng = join(tmp, 'syn_source.png');
      const synPixels = new Uint8Array([
        0xc2, 0x4a, 0x4a, 0xff, // body
        0xff, 0xe0, 0xa0, 0xff, // accent
        0xc2, 0x4a, 0x4a, 0x80, // body, half alpha
        0x00, 0x00, 0x00, 0xff, // unmatched (outline-style black)
      ]);
      const { writeFile } = await import('node:fs/promises');
      await writeFile(synPng, encodePngBuffer(synPixels, 2, 2));

      const result = await runPaletteSwapForCharacter({
        characterId: 'wolf',
        inputPng: synPng,
        paletteJson: join(REPO_ROOT, 'assets', 'palettes', 'wolf.json'),
        outputDir: join(tmp, 'out'),
        log: () => {},
      });

      // Variant 0 (Crimson, canonical) → identity.
      const v0 = decodePngBuffer(
        await readFile(result.outputs[0]!.path),
        'v0',
      );
      expect(v0.pixels).toEqual(synPixels);

      // Variant 1 (Cobalt) → body #4a6ec2, accent #a0c8ff.
      const v1 = decodePngBuffer(
        await readFile(result.outputs[1]!.path),
        'v1',
      );
      // body pixel 0
      expect(readPackedRgb(v1.pixels, 0)).toBe(0x4a6ec2);
      expect(v1.pixels[3]).toBe(0xff);
      // accent pixel 1
      expect(readPackedRgb(v1.pixels, 4)).toBe(0xa0c8ff);
      expect(v1.pixels[7]).toBe(0xff);
      // body pixel 2 — alpha preserved at 0x80
      expect(readPackedRgb(v1.pixels, 8)).toBe(0x4a6ec2);
      expect(v1.pixels[11]).toBe(0x80);
      // unmatched outline pixel 3 — passes through untouched
      expect(readPackedRgb(v1.pixels, 12)).toBe(0x000000);
      expect(v1.pixels[15]).toBe(0xff);

      // Stats reflect what actually happened.
      const v1Stats = result.outputs[1]!.stats;
      expect(v1Stats.perSlot.body).toBe(2);
      expect(v1Stats.perSlot.accent).toBe(1);
      expect(v1Stats.passThroughPixels).toBe(1);
      expect(v1Stats.transparentPixels).toBe(0);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('errors clearly when palette JSON characterId disagrees with caller', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'palette-swap-'));
    try {
      await expect(
        runPaletteSwapForCharacter({
          characterId: 'wolf',
          inputPng: join(
            REPO_ROOT,
            'assets',
            'characters',
            'cat',
            'cat_source_sheet.png',
          ),
          paletteJson: join(REPO_ROOT, 'assets', 'palettes', 'cat.json'),
          outputDir: tmp,
          log: () => {},
        }),
      ).rejects.toThrow(/declares characterId=cat but caller requested wolf/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
