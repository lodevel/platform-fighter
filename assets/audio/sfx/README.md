# SFX — Combat & Defensive Audio

CC0 1.0 audio cuts curated for the M1.5 audio pipeline (AC 10003 Sub-AC 3).
Every file in this directory is freely usable in personal, educational, and
commercial work — attribution is optional but recommended for traceability.
Upstream license files are preserved verbatim alongside the assets.

## Inventory

| File          | Action          | Source pack          | Source filename                       |
|---------------|-----------------|----------------------|---------------------------------------|
| `jab.ogg`     | Light jab hit   | Kenney Impact Sounds | `Audio/impactPunch_medium_000.ogg`    |
| `tilt.ogg`    | Tilt attack hit | Kenney Impact Sounds | `Audio/impactWood_medium_000.ogg`     |
| `smash.ogg`   | Heavy smash hit | Kenney Impact Sounds | `Audio/impactPunch_heavy_000.ogg`     |
| `aerial.ogg`  | Aerial hit      | Kenney Impact Sounds | `Audio/impactPlate_light_000.ogg`     |
| `ko.ogg`      | KO / blast-zone | Kenney Impact Sounds | `Audio/impactBell_heavy_000.ogg`      |
| `shield.ogg`  | Shield raise    | Kenney UI Audio      | `Audio/switch3.ogg`                   |
| `dodge.ogg`   | Spot/air dodge  | Kenney UI Audio      | `Audio/switch16.ogg`                  |

All files are 44.1 kHz Vorbis (`.ogg`) — playable directly via Phaser's
WebAudio backend (no transcode step needed).

## Source packs

- **Kenney — Impact Sounds (1.0)** · CC0 1.0 ·
  https://kenney.nl/assets/impact-sounds
  License preserved at `LICENSE-kenney-impact-sounds.txt`.
- **Kenney — UI Audio (1.0)** · CC0 1.0 ·
  https://kenney.nl/assets/ui-audio
  License preserved at `LICENSE-kenney-ui-audio.txt`.

## How they were chosen

Per the Seed's strict priority order:

1. **PRIMARY** — CC0 packs from Kenney (zero attribution burden, predictable
   single-author tone, OGG-native so the bundle stays under 100 MB).
2. **FALLBACK** — procedural WebAudio beeps were *not* needed because
   Kenney's impact + UI catalogues cover every M1 combat slot.

The selection biases toward short (< 0.5 s) percussive hits so the audio
mixer can fire many overlapping cues at 60 FPS without clipping.
