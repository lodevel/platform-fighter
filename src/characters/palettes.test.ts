import { describe, it, expect } from 'vitest';
import {
  CHARACTER_PALETTES,
  PALETTES_PER_CHARACTER,
  WOLF_PALETTES,
  CAT_PALETTES,
  OWL_PALETTES,
  BEAR_PALETTES,
  applyPaletteToPlaceholder,
  getCharacterPalette,
  getCharacterPalettes,
  type CharacterPalette,
} from './palettes';
import {
  WOLF_PLACEHOLDER,
  CAT_PLACEHOLDER,
  OWL_PLACEHOLDER,
  BEAR_PLACEHOLDER,
} from './roster';
import type { CharacterId } from '../types';

/**
 * AC 13 Sub-AC 2 — "Define palette swap colour data (per-character
 * alternate colour sets for up to 4 players) in a character palette
 * config file."
 *
 * The contract these tests lock down:
 *
 *   1. Every character in the roster ships with exactly 8 palettes
 *      (matches the Seed's "8 manual palette swaps per character")
 *      so a four-player same-character match has spare distinct
 *      palettes for the differentiation step.
 *
 *   2. Palette `index` values are exhaustive over [0, 7] in ascending
 *      order — the cycler can use the array index directly.
 *
 *   3. Palette 0 mirrors each character's existing
 *      `CharacterPlaceholderVisual` so consumers that default to
 *      `paletteIndex: 0` get the same colours they always have.
 *
 *   4. Within each character's ladder the eight `primaryColor` values
 *      are pairwise distinct so adjacent palettes are visibly
 *      different on screen.
 *
 *   5. Every colour value is an integer 0xRRGGBB in [0x000000,
 *      0xFFFFFF].
 *
 *   6. The lookup helpers (`getCharacterPalette`,
 *      `getCharacterPalettes`) are deterministic, wrap out-of-range
 *      indices, and survive negative / non-finite inputs without
 *      crashing.
 *
 *   7. `applyPaletteToPlaceholder` produces a fresh frozen visual
 *      with the palette's colours and the original geometry / sprite
 *      key.
 */
describe('palettes — AC 13 Sub-AC 2 (per-character palette colour data)', () => {
  // -----------------------------------------------------------------------
  // Constants
  // -----------------------------------------------------------------------

  describe('PALETTES_PER_CHARACTER', () => {
    it('equals 8 (matches Seed "8 manual palette swaps per character")', () => {
      expect(PALETTES_PER_CHARACTER).toBe(8);
    });
  });

  // -----------------------------------------------------------------------
  // Per-character ladders: schema
  // -----------------------------------------------------------------------

  const ALL_CHARACTERS: ReadonlyArray<readonly [CharacterId, ReadonlyArray<CharacterPalette>]> = [
    ['wolf', WOLF_PALETTES],
    ['cat', CAT_PALETTES],
    ['owl', OWL_PALETTES],
    ['bear', BEAR_PALETTES],
  ];

  describe.each(ALL_CHARACTERS)('%s palette ladder', (id, ladder) => {
    it(`has exactly ${PALETTES_PER_CHARACTER} entries`, () => {
      expect(ladder).toHaveLength(PALETTES_PER_CHARACTER);
    });

    it('exposes index values exhaustively over [0, 7] in ascending order', () => {
      const indices = ladder.map((p) => p.index);
      expect(indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    });

    it('emits frozen entries so consumers cannot mutate shared data', () => {
      expect(Object.isFrozen(ladder)).toBe(true);
      for (const p of ladder) {
        expect(Object.isFrozen(p)).toBe(true);
      }
    });

    it('uses pairwise-distinct primary colours so adjacent palettes are visibly different', () => {
      const primaries = ladder.map((p) => p.primaryColor);
      expect(new Set(primaries).size).toBe(primaries.length);
    });

    it('every colour value is an integer in [0x000000, 0xFFFFFF]', () => {
      for (const p of ladder) {
        for (const c of [p.primaryColor, p.accentColor, p.labelColor]) {
          expect(Number.isInteger(c)).toBe(true);
          expect(c).toBeGreaterThanOrEqual(0x000000);
          expect(c).toBeLessThanOrEqual(0xffffff);
        }
      }
    });

    it('every entry has a non-empty displayName', () => {
      for (const p of ladder) {
        expect(p.displayName.length).toBeGreaterThan(0);
      }
    });

    it(`is registered in CHARACTER_PALETTES under '${id}'`, () => {
      expect(CHARACTER_PALETTES[id]).toBe(ladder);
    });
  });

  // -----------------------------------------------------------------------
  // Palette 0 matches each character's canonical placeholder
  // -----------------------------------------------------------------------

  describe('palette 0 mirrors the canonical CharacterPlaceholderVisual', () => {
    it.each([
      ['wolf', WOLF_PALETTES, WOLF_PLACEHOLDER],
      ['cat', CAT_PALETTES, CAT_PLACEHOLDER],
      ['owl', OWL_PALETTES, OWL_PLACEHOLDER],
      ['bear', BEAR_PALETTES, BEAR_PLACEHOLDER],
    ] as const)(
      '%s palette 0 matches the placeholder primary/accent colours',
      (_id, ladder, placeholder) => {
        const p0 = ladder[0]!;
        expect(p0.primaryColor).toBe(placeholder.primaryColor);
        expect(p0.accentColor).toBe(placeholder.accentColor);
      },
    );
  });

  // -----------------------------------------------------------------------
  // CHARACTER_PALETTES registry
  // -----------------------------------------------------------------------

  describe('CHARACTER_PALETTES', () => {
    it('is exhaustive over the CharacterId union', () => {
      const ids: CharacterId[] = ['wolf', 'cat', 'owl', 'bear'];
      for (const id of ids) {
        expect(CHARACTER_PALETTES[id]).toBeDefined();
        expect(CHARACTER_PALETTES[id]).toHaveLength(PALETTES_PER_CHARACTER);
      }
    });

    it('is frozen so accidental writes throw under strict mode', () => {
      expect(Object.isFrozen(CHARACTER_PALETTES)).toBe(true);
    });

    it('supports a full four-player same-character lineup with distinct palettes', () => {
      // The headline AC 13 use case: four slots all pick Wolf, each
      // takes a different palette. Picking palette indices 0..3 must
      // yield four distinct primaryColor values so the renderer can
      // tell them apart on-screen.
      const lineup = [0, 1, 2, 3].map((i) => getCharacterPalette('wolf', i));
      const primaries = lineup.map((p) => p.primaryColor);
      expect(new Set(primaries).size).toBe(4);
    });
  });

  // -----------------------------------------------------------------------
  // getCharacterPalette
  // -----------------------------------------------------------------------

  describe('getCharacterPalette', () => {
    it('returns the matching palette for an in-range index', () => {
      const p = getCharacterPalette('cat', 3);
      expect(p).toBe(CAT_PALETTES[3]);
      expect(p.index).toBe(3);
    });

    it('wraps an index past the last palette back to the start', () => {
      const p = getCharacterPalette('wolf', PALETTES_PER_CHARACTER);
      expect(p).toBe(WOLF_PALETTES[0]);
    });

    it('wraps a negative index to a valid palette', () => {
      const p = getCharacterPalette('wolf', -1);
      expect(p).toBe(WOLF_PALETTES[PALETTES_PER_CHARACTER - 1]);
    });

    it('normalises NaN / Infinity to palette 0 instead of crashing', () => {
      expect(getCharacterPalette('cat', NaN)).toBe(CAT_PALETTES[0]);
      expect(getCharacterPalette('cat', Infinity)).toBe(CAT_PALETTES[0]);
      expect(getCharacterPalette('cat', -Infinity)).toBe(CAT_PALETTES[0]);
    });

    it('truncates fractional indices toward zero', () => {
      // 2.9 → 2 (truncate, not round) so cycling is predictable.
      expect(getCharacterPalette('owl', 2.9)).toBe(OWL_PALETTES[2]);
    });

    it('is deterministic — repeated calls return the same frozen object', () => {
      const a = getCharacterPalette('bear', 5);
      const b = getCharacterPalette('bear', 5);
      expect(a).toBe(b);
    });
  });

  // -----------------------------------------------------------------------
  // getCharacterPalettes
  // -----------------------------------------------------------------------

  describe('getCharacterPalettes', () => {
    it('returns the full ladder for a character', () => {
      expect(getCharacterPalettes('wolf')).toBe(WOLF_PALETTES);
      expect(getCharacterPalettes('cat')).toBe(CAT_PALETTES);
      expect(getCharacterPalettes('owl')).toBe(OWL_PALETTES);
      expect(getCharacterPalettes('bear')).toBe(BEAR_PALETTES);
    });

    it('returns a frozen array of length 8', () => {
      const ladder = getCharacterPalettes('wolf');
      expect(ladder).toHaveLength(PALETTES_PER_CHARACTER);
      expect(Object.isFrozen(ladder)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // applyPaletteToPlaceholder
  // -----------------------------------------------------------------------

  describe('applyPaletteToPlaceholder', () => {
    it('substitutes the palette colours into the placeholder', () => {
      const palette = getCharacterPalette('wolf', 1); // Cobalt
      const out = applyPaletteToPlaceholder(WOLF_PLACEHOLDER, palette);
      expect(out.primaryColor).toBe(palette.primaryColor);
      expect(out.accentColor).toBe(palette.accentColor);
      expect(out.labelColor).toBe(palette.labelColor);
    });

    it('preserves geometry (width, height) and spriteKey', () => {
      const palette = getCharacterPalette('cat', 4);
      const out = applyPaletteToPlaceholder(CAT_PLACEHOLDER, palette);
      expect(out.width).toBe(CAT_PLACEHOLDER.width);
      expect(out.height).toBe(CAT_PLACEHOLDER.height);
      expect(out.spriteKey).toBe(CAT_PLACEHOLDER.spriteKey);
    });

    it('does not mutate the input placeholder', () => {
      const before = { ...WOLF_PLACEHOLDER };
      applyPaletteToPlaceholder(WOLF_PLACEHOLDER, getCharacterPalette('wolf', 2));
      expect(WOLF_PLACEHOLDER.primaryColor).toBe(before.primaryColor);
      expect(WOLF_PLACEHOLDER.accentColor).toBe(before.accentColor);
    });

    it('returns a frozen visual', () => {
      const out = applyPaletteToPlaceholder(
        OWL_PLACEHOLDER,
        getCharacterPalette('owl', 3),
      );
      expect(Object.isFrozen(out)).toBe(true);
    });

    it('palette 0 round-trips through the canonical placeholder colours', () => {
      // Applying palette 0 to a character's own placeholder must yield
      // the same primary/accent colours — that's the "default consumer
      // sees no change" guarantee from invariant #3.
      for (const [id, ladder, placeholder] of [
        ['wolf', WOLF_PALETTES, WOLF_PLACEHOLDER],
        ['cat', CAT_PALETTES, CAT_PLACEHOLDER],
        ['owl', OWL_PALETTES, OWL_PLACEHOLDER],
        ['bear', BEAR_PALETTES, BEAR_PLACEHOLDER],
      ] as const) {
        const out = applyPaletteToPlaceholder(placeholder, ladder[0]!);
        expect(out.primaryColor, `${id} primary`).toBe(placeholder.primaryColor);
        expect(out.accentColor, `${id} accent`).toBe(placeholder.accentColor);
      }
    });
  });
});
