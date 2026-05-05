# Assets

Sprites, audio, and other static files served by Vite from `assets/`
(mounted as `publicDir` in `vite.config.ts`).

## Sourcing strategy

Per-asset choice, in priority order:

1. **Primary — free CC0 / CC-BY packs** from
   [itch.io](https://itch.io/game-assets/free),
   [Kenney.nl](https://kenney.nl/assets), or
   [OpenGameArt.org](https://opengameart.org).
   Every CC-BY asset must be credited in `../ATTRIBUTION.md`.
2. **Fallback — procedural pixel art** generated in TypeScript via
   `Phaser.GameObjects.Graphics` (and `generateTexture()` for sprite
   atlases). Use this when no suitable pack exists, when bundle budget
   is tight, or when an asset is needed before art is sourced.

## Layout

- `sprites/` — character atlases + UI icons (itch.io / Kenney packs;
  procedural fallback via build-time texture generation). Palette swaps
  applied via build script for 8 variants per character.
- `audio/` — music and SFX (CC0 packs preferred; procedural beeps via
  WebAudio acceptable as fallback for SFX).
- `stages/` — backgrounds and tilesets for the 4 built-in hazard stages.
- `ui/` — menu artwork, HUD pieces, VCR overlay icons.

Asset pipeline scripts will be added in M2 (palette swap script) and M3
(builder piece thumbnails).

## Hard limits

- Total bundle size ≤ **100 MB**.
- Per-character: ~1120 base sprite frames before palette swaps
  (10 moves × 6–8 frames × N animation states).

## Licensing rules

- **CC0 assets**: no attribution required, but list the source pack in
  `ATTRIBUTION.md` for traceability.
- **CC-BY assets**: attribution **mandatory** in `ATTRIBUTION.md` —
  author name, asset/pack title, source URL, license URL.
- **No CC-BY-SA, CC-BY-NC, or unclear-license assets** — those are
  rejected at review.
- **Procedural assets**: no attribution needed; mark the source file
  with `// procedural fallback` so future swaps are easy to find.
