# SFX — Combat & Defensive Audio

CC0 1.0 audio cuts curated for the M1.5 audio pipeline (AC 10003 Sub-AC 3).
Every file in this directory is freely usable in personal, educational, and
commercial work — attribution is optional but recommended for traceability.
Upstream license files are preserved verbatim alongside the assets.

## Inventory

| File                | Action               | Source pack              | Source filename                    |
|---------------------|----------------------|--------------------------|------------------------------------|
| `jab.ogg`           | Light jab swing      | Kenney Impact Sounds     | `Audio/impactPunch_medium_000.ogg` |
| `tilt.ogg`          | Tilt attack swing    | Kenney Impact Sounds     | `Audio/impactWood_medium_000.ogg`  |
| `smash.ogg`         | Heavy smash swing    | Kenney Impact Sounds     | `Audio/impactPunch_heavy_000.ogg`  |
| `aerial.ogg`        | Aerial swing         | Kenney Impact Sounds     | `Audio/impactPlate_light_000.ogg`  |
| `ko.ogg`            | KO / blast-zone      | Kenney Impact Sounds     | `Audio/impactBell_heavy_000.ogg`   |
| `shield.ogg`        | Shield raise         | Kenney UI Audio          | `Audio/switch3.ogg`                |
| `dodge.ogg`         | Spot/air dodge       | Kenney UI Audio          | `Audio/switch16.ogg`               |
| `jump.wav`          | Ground jump          | Kenney Interface Sounds  | `maximize_003.wav`                 |
| `jump_air.wav`      | Air / multi-jump     | Kenney Interface Sounds  | `maximize_007.wav`                 |
| `land.wav`          | Landing thud         | Kenney Interface Sounds  | `minimize_003.wav`                 |
| `hit_light.wav`     | Light hit connect    | Kenney Interface Sounds  | `drop_001.wav`                     |
| `hit_heavy.wav`     | Heavy hit connect    | Kenney Interface Sounds  | `drop_003.wav`                     |
| `clang.wav`         | Held-weapon clang    | Kenney Interface Sounds  | `glass_001.wav`                    |
| `shield_break.wav`  | Shield shatter       | Kenney Interface Sounds  | `glass_004.wav`                    |
| `charge.wav`        | Charge wind-up loop  | Kenney Interface Sounds  | `bong_001.wav`                     |

The original seven cuts are 44.1 kHz Vorbis (`.ogg`); the AC 10304
action-audio expansion adds eight 44.1 kHz `.wav` cuts (the Kenney
Interface Sounds CC0 mirror distributes WAV). Both formats are playable
directly via Phaser's WebAudio backend — no transcode step needed.

## Swing vs connect

`jab` / `tilt` / `smash` / `aerial` voice the **swing** (the swoosh as
the hitbox spawns, whether or not it touches anyone). `hit_light` /
`hit_heavy` / `clang` voice the **connect** — the crunch the frame a hit
actually lands on a defender, chosen by damage (light below 9%, heavy at
or above) with the metallic clang overriding for held-weapon hits. Smash
plays both layers.

## Source packs

- **Kenney — Impact Sounds (1.0)** · CC0 1.0 ·
  https://kenney.nl/assets/impact-sounds
  License preserved at `LICENSE-kenney-impact-sounds.txt`.
- **Kenney — UI Audio (1.0)** · CC0 1.0 ·
  https://kenney.nl/assets/ui-audio
  License preserved at `LICENSE-kenney-ui-audio.txt`.
- **Kenney — Interface Sounds (1.0)** · CC0 1.0 ·
  https://kenney.nl/assets/interface-sounds
  (downloaded from the CC0 Godot mirror
  https://github.com/Calinou/kenney-interface-sounds)
  License preserved at `LICENSE-kenney-interface-sounds.txt`.

## How they were chosen

Per the Seed's strict priority order:

1. **PRIMARY** — CC0 packs from Kenney (zero attribution burden, predictable
   single-author tone, OGG-native so the bundle stays under 100 MB).
2. **FALLBACK** — procedural WebAudio beeps were *not* needed because
   Kenney's impact + UI catalogues cover every M1 combat slot.

The selection biases toward short (< 0.5 s) percussive hits so the audio
mixer can fire many overlapping cues at 60 FPS without clipping.
