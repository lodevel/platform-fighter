import { describe, it, expect } from 'vitest';
import {
  ASSET_KEYS,
  ASSET_MANIFEST,
  PALETTE_VARIANT_CHARACTERS,
  PALETTE_VARIANTS_PER_CHARACTER,
  findAssetEntry,
  findPaletteVariantEntry,
  getAllAssetEntries,
  paletteVariantTextureKey,
  paletteVariantUrl,
} from './manifest';

/**
 * Manifest contract tests.
 *
 * The manifest is the single source of truth for every asset Phaser
 * loads — a duplicated key, a stale path, or a missing companion JSON
 * would silently corrupt the texture cache or fail at preload. These
 * checks lock down the invariants downstream code is allowed to
 * assume:
 *
 *   1. Every key in {@link ASSET_KEYS} is unique.
 *   2. Every cache key is referenced exactly once across the
 *      manifest's per-loader sub-arrays.
 *   3. Sub-AC 1 required categories all exist (2 character sheets,
 *      stage tilemap entries, every SFX action, the stage music
 *      track).
 *   4. URLs are root-relative (`'/'`-prefixed) so they resolve under
 *      Vite's `publicDir: 'assets'` mount.
 *   5. Spritesheets carry sane frame metadata.
 */
describe('ASSET_KEYS', () => {
  it('uses unique string values for every cache slot', () => {
    const values = Object.values(ASSET_KEYS);
    expect(new Set(values).size).toBe(values.length);
  });

  it('namespaces keys under category prefixes (no bare strings)', () => {
    const allowedPrefixes = ['char.', 'stage.', 'sfx.', 'music.', 'item.'];
    for (const value of Object.values(ASSET_KEYS)) {
      expect(allowedPrefixes.some((p) => value.startsWith(p))).toBe(true);
    }
  });

  it('does not collide with the boot-texture namespace', () => {
    // BootScene reserves `tex.boot.*` — manifest keys must stay clear
    // of that prefix to avoid silently aliasing the boot pixel.
    for (const value of Object.values(ASSET_KEYS)) {
      expect(value.startsWith('tex.boot.')).toBe(false);
    }
  });
});

describe('ASSET_MANIFEST structure', () => {
  it('exposes every loader category as an array', () => {
    expect(Array.isArray(ASSET_MANIFEST.images)).toBe(true);
    expect(Array.isArray(ASSET_MANIFEST.spritesheets)).toBe(true);
    expect(Array.isArray(ASSET_MANIFEST.atlases)).toBe(true);
    expect(Array.isArray(ASSET_MANIFEST.audio)).toBe(true);
    expect(Array.isArray(ASSET_MANIFEST.music)).toBe(true);
  });

  it('has no duplicate cache keys across categories', () => {
    const keys = getAllAssetEntries().map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("references every ASSET_KEYS value exactly once", () => {
    const declared = new Set<string>(Object.values(ASSET_KEYS));
    const seen = new Set<string>();
    for (const entry of getAllAssetEntries()) {
      expect(declared.has(entry.key)).toBe(true);
      expect(seen.has(entry.key)).toBe(false);
      seen.add(entry.key);
    }
    expect(seen.size).toBe(declared.size);
  });
});

describe('Sub-AC 1 required coverage', () => {
  it('includes spritesheets for both character sheets (cat + wolf)', () => {
    const catKeys = [
      ASSET_KEYS.charCatIdle,
      ASSET_KEYS.charCatRun,
      ASSET_KEYS.charCatJump,
      ASSET_KEYS.charCatAttack,
    ];
    const wolfKeys = [
      ASSET_KEYS.charWolfIdle,
      ASSET_KEYS.charWolfRun,
      ASSET_KEYS.charWolfJump,
      ASSET_KEYS.charWolfAttack,
    ];

    for (const key of [...catKeys, ...wolfKeys]) {
      const entry = findAssetEntry(key);
      expect(entry, `missing entry for ${key}`).toBeDefined();
      expect(entry?.kind).toBe('spritesheet');
    }
  });

  it('includes stage tile spritesheets (M1 tilemap + background)', () => {
    const tilemap = findAssetEntry(ASSET_KEYS.stageM1Tilemap);
    const bg = findAssetEntry(ASSET_KEYS.stageM1Background);

    expect(tilemap?.kind).toBe('spritesheet');
    expect(bg?.kind).toBe('spritesheet');

    // Sanity-check the documented Kenney atlas geometry.
    if (tilemap?.kind === 'spritesheet') {
      expect(tilemap.frameWidth).toBe(18);
      expect(tilemap.frameHeight).toBe(18);
    }
    if (bg?.kind === 'spritesheet') {
      expect(bg.frameWidth).toBe(24);
      expect(bg.frameHeight).toBe(24);
    }
  });

  it('includes audio entries for every combat / defensive SFX', () => {
    const sfxKeys = [
      ASSET_KEYS.sfxJab,
      ASSET_KEYS.sfxTilt,
      ASSET_KEYS.sfxSmash,
      ASSET_KEYS.sfxAerial,
      ASSET_KEYS.sfxKo,
      ASSET_KEYS.sfxShield,
      ASSET_KEYS.sfxDodge,
    ];
    for (const key of sfxKeys) {
      const entry = findAssetEntry(key);
      expect(entry, `missing SFX entry for ${key}`).toBeDefined();
      expect(entry?.kind).toBe('audio');
    }
  });

  it('includes the stage music track tagged separately from SFX', () => {
    const music = findAssetEntry(ASSET_KEYS.musicStageDefault);
    expect(music).toBeDefined();
    expect(music?.kind).toBe('music');
  });
});

describe('Path conventions', () => {
  it('uses root-relative URLs for every asset (Vite publicDir mount)', () => {
    for (const entry of getAllAssetEntries()) {
      // A switch on `kind` lets TypeScript narrow each branch cleanly
      // even though `AudioAssetEntry` shares two `kind` literals.
      let urls: readonly string[];
      switch (entry.kind) {
        case 'audio':
        case 'music':
          urls = entry.urls;
          break;
        case 'atlas':
          urls = [entry.textureUrl, entry.jsonUrl];
          break;
        case 'image':
        case 'spritesheet':
          urls = [entry.url];
          break;
      }

      for (const url of urls) {
        expect(url.startsWith('/')).toBe(true);
        // Should NOT include the `assets/` segment — Vite's publicDir
        // strips it when serving.
        expect(url.startsWith('/assets/')).toBe(false);
      }
    }
  });

  it('points spritesheet URLs at .png and audio URLs at .ogg', () => {
    for (const entry of ASSET_MANIFEST.spritesheets) {
      expect(entry.url.endsWith('.png')).toBe(true);
    }
    for (const entry of [...ASSET_MANIFEST.audio, ...ASSET_MANIFEST.music]) {
      for (const url of entry.urls) {
        expect(url.endsWith('.ogg') || url.endsWith('.mp3')).toBe(true);
      }
    }
  });
});

describe('Spritesheet frame metadata', () => {
  it('has positive frame dimensions and counts on every sheet', () => {
    for (const sheet of ASSET_MANIFEST.spritesheets) {
      expect(sheet.frameWidth).toBeGreaterThan(0);
      expect(sheet.frameHeight).toBeGreaterThan(0);
      expect(sheet.frameCount).toBeGreaterThan(0);
    }
  });

  it('matches the canonical frame counts documented in each character README', () => {
    // These numbers come from `assets/characters/*/frames.json` and
    // the READMEs that document the source-sheet layout. Keeping
    // them locked here turns a silent drift between the manifest and
    // the on-disk strips into a noisy test failure.
    const cases: Array<readonly [string, number]> = [
      [ASSET_KEYS.charCatIdle, 4],
      [ASSET_KEYS.charCatRun, 10],
      [ASSET_KEYS.charCatJump, 5],
      [ASSET_KEYS.charCatAttack, 10],
      [ASSET_KEYS.charWolfIdle, 4],
      [ASSET_KEYS.charWolfRun, 8],
      [ASSET_KEYS.charWolfJump, 5],
      // Source had 4 cells but cell 0 was a stray-pixel artifact —
      // see the comment on `wolfSpritesheets` in `manifest.ts`.
      [ASSET_KEYS.charWolfAttack, 3],
      [ASSET_KEYS.charOwlIdle, 1],
      [ASSET_KEYS.charOwlRun, 8],
      [ASSET_KEYS.charOwlJump, 1],
      [ASSET_KEYS.charOwlAttack, 1],
      [ASSET_KEYS.charBearIdle, 2],
      [ASSET_KEYS.charBearRun, 4],
      [ASSET_KEYS.charBearJump, 3],
      [ASSET_KEYS.charBearAttack, 4],
    ];
    for (const [key, expectedCount] of cases) {
      const entry = findAssetEntry(key);
      expect(entry?.kind).toBe('spritesheet');
      if (entry?.kind === 'spritesheet') {
        expect(entry.frameCount).toBe(expectedCount);
      }
    }
  });
});

/**
 * Sub-AC 4 of AC 10204 — every generated palette variant must be
 * registered under a deterministic, parameterised texture key so the
 * runtime can fetch it by `(characterId, paletteIndex)` without
 * knowing the on-disk file path. The key format is
 * `char.<id>.palette.<index>` (the namespaced form of the AC's
 * `${character}_palette_${index}` example).
 */
describe('Palette variant registration — AC 10204 Sub-AC 4', () => {
  it('exposes a deterministic key helper that mirrors the registered entries', () => {
    // The key helper must be the *same* function the manifest used to
    // register entries — otherwise a runtime consumer that calls
    // `paletteVariantTextureKey('wolf', 3)` could miss the cached
    // texture by one character. We assert this by composing the key
    // both ways and checking both land on the same manifest entry.
    for (const config of PALETTE_VARIANT_CHARACTERS) {
      for (let i = 0; i < PALETTE_VARIANTS_PER_CHARACTER; i++) {
        const key = paletteVariantTextureKey(config.characterId, i);
        expect(key).toBe(`char.${config.characterId}.palette.${i}`);
        const entry = findAssetEntry(key);
        expect(entry, `missing manifest entry for ${key}`).toBeDefined();
        expect(entry?.kind).toBe('spritesheet');
      }
    }
  });

  it('registers exactly 8 variant spritesheets per configured character', () => {
    for (const config of PALETTE_VARIANT_CHARACTERS) {
      const variantKeys = ASSET_MANIFEST.spritesheets
        .filter((s) => s.key.startsWith(`char.${config.characterId}.palette.`))
        .map((s) => s.key);
      expect(variantKeys).toHaveLength(PALETTE_VARIANTS_PER_CHARACTER);
      // And the keys cover every index 0..7 exactly once.
      const indices = variantKeys
        .map((k) => Number(k.split('.').pop()))
        .sort((a, b) => a - b);
      expect(indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    }
  });

  it('every variant spritesheet carries the source-sheet frame geometry', () => {
    // The generated PNG is a pixel-remap of the canonical source sheet,
    // so the cell width/height/count must match `frames.json`. Drift
    // here would mean a frame index resolves to a different sub-rect
    // than the canonical sheet, silently rendering the wrong sprite.
    for (const config of PALETTE_VARIANT_CHARACTERS) {
      for (let i = 0; i < PALETTE_VARIANTS_PER_CHARACTER; i++) {
        const entry = findAssetEntry(
          paletteVariantTextureKey(config.characterId, i),
        );
        expect(entry?.kind).toBe('spritesheet');
        if (entry?.kind === 'spritesheet') {
          expect(entry.frameWidth).toBe(config.frameWidth);
          expect(entry.frameHeight).toBe(config.frameHeight);
          expect(entry.frameCount).toBe(config.frameCount);
        }
      }
    }
  });

  it('points each variant URL at the script output `/generated/sprites/<id>/<index>_<slug>.png`', () => {
    for (const config of PALETTE_VARIANT_CHARACTERS) {
      for (let i = 0; i < PALETTE_VARIANTS_PER_CHARACTER; i++) {
        const url = paletteVariantUrl(config, i);
        const slug = config.slugs[i];
        expect(url).toBe(
          `/generated/sprites/${config.characterId}/${i}_${slug}.png`,
        );
        // And the manifest entry's URL must match the helper exactly.
        const entry = findAssetEntry(
          paletteVariantTextureKey(config.characterId, i),
        );
        expect(entry?.kind).toBe('spritesheet');
        if (entry?.kind === 'spritesheet') {
          expect(entry.url).toBe(url);
        }
      }
    }
  });

  it('texture keys are unique across every registered variant', () => {
    // Belt and braces against a copy/paste typo in PALETTE_VARIANT_CHARACTERS.
    const allVariantKeys: string[] = [];
    for (const config of PALETTE_VARIANT_CHARACTERS) {
      for (let i = 0; i < PALETTE_VARIANTS_PER_CHARACTER; i++) {
        allVariantKeys.push(paletteVariantTextureKey(config.characterId, i));
      }
    }
    expect(new Set(allVariantKeys).size).toBe(allVariantKeys.length);
  });

  it('wraps an out-of-range paletteIndex into [0, 8) so stale slots still resolve', () => {
    // A replay JSON that was authored before a palette ladder change
    // could carry a `paletteIndex` of 9 or -1. The texture key composer
    // must still land on a valid entry — same contract as
    // `getCharacterPalette` in `src/characters/palettes.ts`.
    expect(paletteVariantTextureKey('wolf', 8)).toBe('char.wolf.palette.0');
    expect(paletteVariantTextureKey('wolf', -1)).toBe('char.wolf.palette.7');
    expect(paletteVariantTextureKey('cat', 17)).toBe('char.cat.palette.1');
    expect(paletteVariantTextureKey('cat', Number.NaN)).toBe(
      'char.cat.palette.0',
    );
  });

  it('findPaletteVariantEntry round-trips through the deterministic key', () => {
    for (const config of PALETTE_VARIANT_CHARACTERS) {
      for (let i = 0; i < PALETTE_VARIANTS_PER_CHARACTER; i++) {
        const direct = findAssetEntry(
          paletteVariantTextureKey(config.characterId, i),
        );
        const helper = findPaletteVariantEntry(config.characterId, i);
        expect(helper).toBe(direct);
      }
    }
  });

  it('returns undefined for characters without registered variants (Owl/Bear in M1)', () => {
    // Owl + Bear have palette JSONs but no source sheet yet — the
    // helper must signal that cleanly so the renderer can fall back to
    // the tint pipeline instead of trying to load a non-existent PNG.
    expect(findPaletteVariantEntry('owl', 0)).toBeUndefined();
    expect(findPaletteVariantEntry('bear', 3)).toBeUndefined();
  });
});

describe('findAssetEntry helper', () => {
  it('returns the entry for a known key', () => {
    const entry = findAssetEntry(ASSET_KEYS.sfxJab);
    expect(entry?.key).toBe(ASSET_KEYS.sfxJab);
  });

  it('returns undefined for an unknown key', () => {
    expect(findAssetEntry('does.not.exist')).toBeUndefined();
  });
});
