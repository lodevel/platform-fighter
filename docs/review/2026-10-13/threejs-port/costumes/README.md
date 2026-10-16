# Costume recolouring in the 3D renderer (2026-10-13)

The user asked that the kept fighters (DK, Pikachu, Link) stay recolourable
once the build-time palette pipeline goes with Wolf, Cat, Owl and Bear.

## What the game did before

- `paletteSwapShader.ts` swaps pixels that **exactly** match three key
  colours. It was written for flat pixel art.
- `MatchScene` builds its `RuntimePaletteRenderer` without a WebGL pipeline,
  so every fighter takes the `setTint` fallback: the whole sprite is
  multiplied by one colour.
- The soft-shaded cartoon art of the kept fighters never had real costume
  recolouring.

## What the port does now

- **The shader:** `engine/sprites/spriteLayer.ts` takes an optional `recolor`
  list of up to 4 HSV regions.
  - A pixel near a region's key colour (per-channel tolerance, soft edge) has
    its hue rotated and its saturation and value scaled.
  - Light, shadow and outlines therefore survive.
  - Each pixel follows only its nearest key.
  - With no regions, the texel is untouched: Phaser parity holds at max diff
    1/255 and 0 pixels over 2.
- **The regions:** `pending/characters/paletteArtKeys.ts` lists where each
  costume region lives in the art.
  - The key colours are ART-MEASURED by median-cut of the sheets each fighter
    draws.
  - The tolerances are AUTHORED, tuned by eye.
  - DK: fur. The tan face and chest stay as in Smash, and the red tie stays
    out by hue.
  - Pikachu: the yellow body and the brown ear tips and stripes.
  - Link: the tunic and the cap. The fresh Link's sheets are `a00wait1` and
    `c02attackhi3`; `link/animations/idle.png` is an old sheet that is no
    longer drawn.
- **The target colours:** `fighters/palette.ts` (`costumeRecolor`) shifts each
  region by palette N relative to palette 0 in `src/characters/palettes.ts`,
  so the costume colours stay in one place.
- **The page:** `port/costumes.html` shows each fighter in its 8 costumes,
  captured in `costumes-f0.png`.

## Notes

- Measure again when a fighter's art changes. The fresh Link's art is still
  being produced.
- At the gate, `gate-merge.mjs` moves `paletteArtKeys.ts` to `src/characters/`.
  The Phaser palette modules (`paletteSwapShader`, `PaletteSwapRenderer`,
  `runtimePaletteRenderer`) go with Phaser in step 9.

## Menus (same day)

- Select-screen cards and HUD plates now show the fighter's in-game idle
  pose in its chosen costume. `engine/sprites/spriteSnapshot.ts` draws a
  single sprite through the same shader on a small offscreen renderer, and
  `ui/assets/fighterArt.ts` trims and caches the result per fighter and
  costume.
- This also fixes Link's card art, which used the old unused `idle.png`.
- The lineups on the stage, match and results screens draw each player's
  costume.
- Evidence is in `menus/`:
  - `07-fighters-picked`: P2 Scarlet and P3 Cobalt by default;
  - `07b-fighters-costume`: P1 clicks Banana;
  - `10-match`: the lineup in costume.
