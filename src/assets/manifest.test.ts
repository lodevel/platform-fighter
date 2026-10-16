import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ASSET_KEYS,
  ASSET_MANIFEST,
  findAssetEntry,
  getAllAssetEntries,
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

  it("references every required key once and loads only reviewed Pikachu sheets", () => {
    // A packed fighter's sheets are its frames.json clips (char.<fighter>.<clip>), declared by that file.
    const packedKeys = ['donkeykong', 'link'].flatMap(fighter => Object.keys(JSON.parse(readFileSync(
      resolve(`assets/characters/${fighter}/frames.json`), 'utf8')).animations).map(clip => `char.${fighter}.${clip}`));
    const declared = new Set<string>([...Object.values(ASSET_KEYS), ...packedKeys]);
    const seen = new Set<string>();
    for (const entry of getAllAssetEntries()) {
      expect(declared.has(entry.key), entry.key).toBe(true);
      expect(seen.has(entry.key)).toBe(false);
      seen.add(entry.key);
    }
    // Pikachu reserves its complete action inventory before generation.
    // Pending keys must remain unloaded; accepted metadata is the asset gate.
    const reviewed = JSON.parse(readFileSync(resolve('assets/characters/pikachu/frames.json'), 'utf8'));
    const acceptedPikachuKeys = new Set(Object.keys(reviewed.animations).map(sheet =>
      `char.pikachu.${sheet === 'ftilt' ? 'tilt' : sheet}`));
    for (const key of declared) {
      expect(seen.has(key), key).toBe(key.startsWith('char.pikachu.')
        ? acceptedPikachuKeys.has(key) : true);
    }
  });
});

describe('Sub-AC 1 required coverage', () => {
  it('includes basic spritesheets for the sheet-driven fighters (link + donkeykong)', () => {
    const keys = [
      ASSET_KEYS.charLinkIdle,
      ASSET_KEYS.charDonkeykongIdle,
      ASSET_KEYS.charDonkeykongRun,
      ASSET_KEYS.charDonkeykongJump,
      ASSET_KEYS.charDonkeykongAttack,
    ];

    for (const key of keys) {
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

  it('points spritesheet URLs at .png and audio URLs at a WebAudio-decodable format', () => {
    for (const entry of ASSET_MANIFEST.spritesheets) {
      expect(entry.url.endsWith('.png')).toBe(true);
    }
    // The original combat/music cuts ship as `.ogg` (Vorbis) with `.mp3`
    // codec-fallback companions for Safari. The M1.5 action-audio
    // expansion (AC 10304) adds short `.wav` cuts sourced from the Kenney
    // Interface Sounds CC0 mirror, which distributes WAV — Phaser's
    // `load.audio` decodes all three natively, so we accept any of them
    // rather than forcing a transcode step the asset pipeline doesn't run.
    for (const entry of [...ASSET_MANIFEST.audio, ...ASSET_MANIFEST.music]) {
      for (const url of entry.urls) {
        expect(
          url.endsWith('.ogg') || url.endsWith('.mp3') || url.endsWith('.wav'),
        ).toBe(true);
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
