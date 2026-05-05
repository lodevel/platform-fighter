# `scripts/palette-swap/`

Node.js palette-swap script — **Sub-AC 2 of AC 10202** (M1.5 content
pipeline).

Reads a per-character canonical spritesheet PNG plus its palette
definition JSON (`assets/palettes/<id>.json`, authored under Sub-AC 1)
and emits **8 recoloured PNG variants** to
`assets/generated/sprites/<id>/<index>_<slug>.png`.

## Layout

```
scripts/palette-swap/
├── index.ts               # CLI entry — `tsx scripts/palette-swap/index.ts`
├── paletteDefinition.ts   # Loads + validates assets/palettes/<id>.json
├── paletteSwap.ts         # Pure pixel-level RGBA → RGBA remap (no I/O)
├── pngCodec.ts            # Thin pngjs wrapper (decode/encode RGBA bytes)
├── cache.ts               # Build-time cache (sha256 manifest, hit detection)
├── paletteSwap.test.ts    # Unit + end-to-end tests for the swap pipeline
├── cache.test.ts          # Hashing, manifest, hit detection, e2e cache tests
└── README.md              # this file
```

The split is deliberate:

- `paletteDefinition.ts` is the read-side validator and is the TS mirror
  of `assets/palettes/palette.schema.json`. Any schema change must
  update both.
- `paletteSwap.ts` is **pure** — codec-free and I/O-free — so the same
  transform can later run inside the browser against `<canvas>`
  `getImageData()` without modification.
- `pngCodec.ts` isolates `pngjs` so we can swap to `sharp` later if we
  hit a perf wall on 4 × 8 × 1024² pixels.
- `index.ts` orchestrates: load JSON → decode PNG → remap each variant
  → encode + write PNG.

## Usage

```bash
# Default — process all 4 characters with palette JSONs.
npm run palette-swap

# Subset — positional ids from {wolf, cat, owl, bear}.
npm run palette-swap -- wolf cat

# Bypass cache and rebuild everything.
npm run palette-swap -- --force

# Explicit paths — useful for ad-hoc inputs / tests.
npm run palette-swap -- \
  --in assets/characters/wolf/wolf_source_sheet.png \
  --palette assets/palettes/wolf.json \
  --out assets/generated/sprites/wolf

npm run palette-swap -- --help
```

## Build-pipeline integration (Sub-AC 3 of AC 10203)

The script is wired into `npm run build` via the `prebuild` hook in
`package.json`:

```json
"scripts": {
  "prebuild": "npm run build:palettes",
  "build": "tsc --noEmit && vite build",
  "build:palettes": "tsx scripts/palette-swap/index.ts"
}
```

`npm run build` always regenerates palette variants before Vite bundles
them — there is no way for stale art to ship in `dist/`.

### Caching

A full rebuild costs ~3 s on the dev laptop. To keep the typical
rebuild instant we maintain a SHA-256 cache manifest at:

```
assets/generated/sprites/.palette-cache.json
```

Each character entry pins:

- `paletteSha256` — bytes of `assets/palettes/<id>.json`
- `sourceSha256`  — bytes of the canonical source PNG
- `cliVersion`    — bumped when the script's output format changes
- `outputs[]`     — `{ filename, sha256 }` for every generated variant

A character is **skipped** only when *all* of:

1. Manifest entry exists with matching `cliVersion`.
2. Palette JSON hashes to the recorded `paletteSha256`.
3. Source PNG hashes to the recorded `sourceSha256`.
4. Every recorded output PNG still exists on disk.
5. Each output PNG's bytes hash to the recorded `sha256`.

Output hashing guards against hand-edits and partial deletes —
input-only checks would falsely hit and ship stale art.

### Bypassing the cache

```bash
npm run build:palettes -- --force      # one-shot rebuild
rm assets/generated/sprites/.palette-cache.json   # nuke the manifest
```

Both have the same effect. The manifest format is versioned
(`CACHE_VERSION` in `cache.ts`) so any future change that affects
output bytes can force a global rebuild by bumping the constant.

### Determinism of the manifest

`serializeCacheManifest` sorts character ids and `outputs[]` filenames,
emits 2-space indented JSON, and ends with a trailing newline. Combined
with `pngjs`'s deterministic encoder, the manifest itself is byte-stable
across runs given equal inputs — `git diff --exit-code` on
`.palette-cache.json` is a valid CI assertion.

## Output filename convention

`<index>_<slug>.png`, where `slug` is the variant `name` lowercased and
dashed. Example for wolf:

```
0_crimson.png   1_cobalt.png   2_sunburst.png   3_forest.png
4_royal.png     5_ember.png    6_lagoon.png     7_rose.png
```

The `<index>` prefix matches `PlayerSlot.paletteIndex` so a runtime
loader can construct the asset key directly from the palette index.

## Determinism

Same JSON + same input PNG bytes → same 8 output PNG byte streams.
`pngjs` writes deterministically (no embedded timestamps), variant
iteration order is the file's declared array order, and the remap is a
pure per-pixel function. CI can re-run the script and `git diff` the
generated tree to verify nothing drifted.

## Pixel transform contract

For each pixel in the source RGBA buffer:

1. If `alpha === 0`, **skip entirely** (no rewrite).
2. Else if `(R, G, B)` matches any slot's `mappings.<slot>.from`
   (exact compare, no tolerance), rewrite to that slot's
   `mappings.<slot>.to` and **preserve alpha**.
3. Else copy the pixel through unchanged ("pass-through").

The first-match-wins rule (slot iteration order = `body, accent,
highlight`) only matters when two slot `from` colours coincide, which
the schema permits when a character has no separate highlight slot in
its art (`highlight === accent`).

## Why `pngjs` (not `sharp`)?

- Pure JavaScript — no native deps, so dev install stays fast and
  cross-platform (matters for the WSL workflow this repo uses).
- Output bytes are deterministic by default.
- Throughput is fine for the v1 budget (4 chars × 8 variants × ≤ 1 M
  pixels each = ~32 MP per full rebuild — measured ~3 s on the dev
  laptop).

If a future content pass blows past that budget (palette swaps for AI
training data, batch tooling, …), `pngCodec.ts` is the only file to
touch.
