/**
 * Palette definition loader and validator.
 *
 * --------------------------------------------------------------------
 * What this module is
 * --------------------------------------------------------------------
 *
 * Sub-AC 2 of AC 10202 — the "core Node.js palette-swap script". This
 * file owns the **read side** of the pipeline: load a per-character
 * palette JSON file from `assets/palettes/<characterId>.json`, validate
 * it against the same invariants the JSON Schema enforces, and parse
 * `#RRGGBB` hex strings into 24-bit numeric RGB the pixel remapper
 * consumes.
 *
 * The pipeline is split this way so:
 *
 *   1. The pure transform code in `paletteSwap.ts` deals only in
 *      numeric `(source, target)` pairs and never has to re-validate
 *      the JSON shape — anything that reaches `applyPaletteRemap` has
 *      already been proven well-formed.
 *
 *   2. The CLI in `index.ts` can fail fast with one clear error per
 *      missing slot or malformed hex value, before it touches a single
 *      pixel of the spritesheet.
 *
 *   3. Unit tests can drive the validator with fixtures and assert the
 *      exact error messages, without faking PNG bytes.
 *
 * The schema lives in `assets/palettes/palette.schema.json` and is the
 * machine-readable contract; this module is its TypeScript mirror — any
 * change to the schema (new slot, new variant count) must update both.
 *
 * --------------------------------------------------------------------
 * Determinism
 * --------------------------------------------------------------------
 *
 * Pure: same JSON in → same parsed record out. No I/O is performed by
 * `parsePaletteDefinition`; the file-reading helper is a thin wrapper
 * that calls the parser. This means the validator runs in unit tests
 * with hand-rolled JSON literals and the CLI runs the same code path.
 */

import { readFile } from 'node:fs/promises';

/**
 * Slot names that match `PaletteSlot` in
 * `src/characters/paletteSwapShader.ts`. Kept as a literal-array
 * constant so the validator can iterate it deterministically and
 * generate per-slot error messages without grep'ing strings.
 */
export const PALETTE_SLOTS = ['body', 'accent', 'highlight'] as const;
export type PaletteSlot = (typeof PALETTE_SLOTS)[number];

/** The four character ids the Seed mandates. */
export const CHARACTER_IDS = ['wolf', 'cat', 'owl', 'bear'] as const;
export type CharacterId = (typeof CHARACTER_IDS)[number];

/** Required exact variant count per character (Seed invariant). */
export const VARIANTS_PER_CHARACTER = 8;

/**
 * 24-bit RGB colour as packed integer 0xRRGGBB. Matches the runtime
 * `Phaser`-side numeric format and lets the remapper compare colours
 * with a single `===` instead of three field reads.
 */
export type Rgb24 = number;

/** Parsed slot mapping: source pixel colour → target pixel colour. */
export interface ParsedSlotMapping {
  readonly slot: PaletteSlot;
  readonly source: Rgb24;
  readonly target: Rgb24;
}

/** Parsed variant — the 8 entries of a character's palette ladder. */
export interface ParsedVariant {
  readonly index: number;
  readonly name: string;
  readonly isCanonical: boolean;
  /**
   * Slot mappings in {@link PALETTE_SLOTS} order. The remapper iterates
   * this list per pixel; ordering keeps the inner loop branch-free.
   */
  readonly mappings: ReadonlyArray<ParsedSlotMapping>;
}

/** A whole `<characterId>.json` file in parsed form. */
export interface ParsedPaletteDefinition {
  readonly characterId: CharacterId;
  readonly displayName: string;
  /** Source slot colours present in the canonical authored sheet. */
  readonly source: Readonly<Record<PaletteSlot, Rgb24>>;
  /** Exactly 8 variants, indexed 0..7 in array order. */
  readonly variants: ReadonlyArray<ParsedVariant>;
}

// ---------------------------------------------------------------------------
// Hex parsing
// ---------------------------------------------------------------------------

/**
 * Match `#RRGGBB` (case-insensitive). Anchored so partial matches like
 * `"red#ff0000"` are rejected — the schema spec is exact.
 */
const HEX_RGB_RE = /^#([0-9a-fA-F]{6})$/;

/**
 * Parse a `#RRGGBB` hex string into a packed 24-bit integer.
 *
 * Throws on any malformed input — this is intentional, palette files
 * are checked into source so a bad value should fail the build script
 * loudly, not silently degrade to a "close enough" colour.
 */
export function parseHexColor(hex: unknown, where: string): Rgb24 {
  if (typeof hex !== 'string') {
    throw new Error(`${where}: expected hex string, got ${typeof hex}`);
  }
  const m = HEX_RGB_RE.exec(hex);
  if (!m) {
    throw new Error(
      `${where}: invalid hex colour ${JSON.stringify(hex)} ` +
        `(expected #RRGGBB)`,
    );
  }
  // Non-null: regex match guarantees group 1.
  return parseInt(m[1]!, 16);
}

/** Format a 24-bit RGB integer back to `#rrggbb` lowercase hex. */
export function formatHexColor(rgb: Rgb24): string {
  return `#${(rgb & 0xffffff).toString(16).padStart(6, '0')}`;
}

// ---------------------------------------------------------------------------
// JSON validation — TS mirror of palette.schema.json
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function assertCharacterId(v: unknown): CharacterId {
  if (typeof v !== 'string') {
    throw new Error(
      `characterId: expected string, got ${typeof v}`,
    );
  }
  if (!(CHARACTER_IDS as readonly string[]).includes(v)) {
    throw new Error(
      `characterId: ${JSON.stringify(v)} is not one of ` +
        `${JSON.stringify(CHARACTER_IDS)}`,
    );
  }
  return v as CharacterId;
}

function parseSourcePalette(
  raw: unknown,
): Readonly<Record<PaletteSlot, Rgb24>> {
  if (!isPlainObject(raw)) {
    throw new Error(`source: expected object, got ${typeof raw}`);
  }
  const out = {} as Record<PaletteSlot, Rgb24>;
  for (const slot of PALETTE_SLOTS) {
    out[slot] = parseHexColor(raw[slot], `source.${slot}`);
  }
  // Guard against extra/typo'd slot names slipping into the file.
  for (const key of Object.keys(raw)) {
    if (!(PALETTE_SLOTS as readonly string[]).includes(key)) {
      throw new Error(`source: unexpected key ${JSON.stringify(key)}`);
    }
  }
  return Object.freeze(out);
}

function parseVariant(
  raw: unknown,
  expectedIndex: number,
  source: Readonly<Record<PaletteSlot, Rgb24>>,
): ParsedVariant {
  if (!isPlainObject(raw)) {
    throw new Error(
      `variants[${expectedIndex}]: expected object, got ${typeof raw}`,
    );
  }
  const where = `variants[${expectedIndex}]`;

  const idx = raw['index'];
  if (typeof idx !== 'number' || !Number.isInteger(idx) || idx !== expectedIndex) {
    throw new Error(
      `${where}.index: expected integer ${expectedIndex}, got ` +
        `${JSON.stringify(idx)}`,
    );
  }
  const name = raw['name'];
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`${where}.name: expected non-empty string`);
  }
  const isCanonicalRaw = raw['isCanonical'];
  if (
    isCanonicalRaw !== undefined &&
    typeof isCanonicalRaw !== 'boolean'
  ) {
    throw new Error(`${where}.isCanonical: expected boolean if present`);
  }
  const isCanonical = isCanonicalRaw === true;

  const mappingsRaw = raw['mappings'];
  if (!isPlainObject(mappingsRaw)) {
    throw new Error(`${where}.mappings: expected object`);
  }
  const mappings: ParsedSlotMapping[] = [];
  for (const slot of PALETTE_SLOTS) {
    const m = mappingsRaw[slot];
    if (!isPlainObject(m)) {
      throw new Error(`${where}.mappings.${slot}: expected object`);
    }
    const slotWhere = `${where}.mappings.${slot}`;
    const from = parseHexColor(m['from'], `${slotWhere}.from`);
    const to = parseHexColor(m['to'], `${slotWhere}.to`);
    // Schema invariant: `from` always equals the file-root source slot
    // colour — the script reads pixels from the canonical atlas, never
    // from a previously generated variant.
    if (from !== source[slot]) {
      throw new Error(
        `${slotWhere}.from: must equal source.${slot} ` +
          `(${formatHexColor(source[slot])}), got ${formatHexColor(from)}`,
      );
    }
    if (isCanonical && to !== source[slot]) {
      throw new Error(
        `${slotWhere}.to: canonical variant must keep source colour ` +
          `${formatHexColor(source[slot])}, got ${formatHexColor(to)}`,
      );
    }
    mappings.push(Object.freeze({ slot, source: from, target: to }));
  }
  for (const key of Object.keys(mappingsRaw)) {
    if (!(PALETTE_SLOTS as readonly string[]).includes(key)) {
      throw new Error(
        `${where}.mappings: unexpected slot key ${JSON.stringify(key)}`,
      );
    }
  }

  return Object.freeze({
    index: idx,
    name,
    isCanonical,
    mappings: Object.freeze(mappings),
  });
}

/**
 * Parse a raw JSON value (already `JSON.parse`'d) into a validated
 * {@link ParsedPaletteDefinition}. Throws with a descriptive message
 * on any schema violation. Pure — no I/O.
 */
export function parsePaletteDefinition(raw: unknown): ParsedPaletteDefinition {
  if (!isPlainObject(raw)) {
    throw new Error(
      `palette definition: expected top-level object, got ${typeof raw}`,
    );
  }
  const characterId = assertCharacterId(raw['characterId']);
  const displayName = raw['displayName'];
  if (typeof displayName !== 'string' || displayName.length === 0) {
    throw new Error('displayName: expected non-empty string');
  }
  const source = parseSourcePalette(raw['source']);

  const variantsRaw = raw['variants'];
  if (!Array.isArray(variantsRaw)) {
    throw new Error('variants: expected array');
  }
  if (variantsRaw.length !== VARIANTS_PER_CHARACTER) {
    throw new Error(
      `variants: expected exactly ${VARIANTS_PER_CHARACTER} entries, ` +
        `got ${variantsRaw.length}`,
    );
  }
  const variants: ParsedVariant[] = [];
  for (let i = 0; i < variantsRaw.length; i++) {
    variants.push(parseVariant(variantsRaw[i], i, source));
  }

  // Schema invariant: exactly one canonical variant, and it is index 0.
  const canonicalCount = variants.filter((v) => v.isCanonical).length;
  if (canonicalCount !== 1) {
    throw new Error(
      `variants: expected exactly 1 canonical entry, found ${canonicalCount}`,
    );
  }
  if (!variants[0]!.isCanonical) {
    throw new Error('variants[0] must be the canonical variant');
  }

  return Object.freeze({
    characterId,
    displayName,
    source,
    variants: Object.freeze(variants),
  });
}

/**
 * Read and parse a palette definition file from disk. The path is
 * resolved by the caller — the CLI passes
 * `assets/palettes/<characterId>.json`, tests pass a fixture path.
 */
export async function loadPaletteDefinition(
  filePath: string,
): Promise<ParsedPaletteDefinition> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(
      `loadPaletteDefinition: cannot read ${filePath}: ${cause}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(
      `loadPaletteDefinition: ${filePath} is not valid JSON: ${cause}`,
    );
  }
  return parsePaletteDefinition(parsed);
}
