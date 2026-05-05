# Music — Stage Tracks

CC0 1.0 stage music for the M1.5 audio pipeline (AC 10003 Sub-AC 3).
This directory ships **one** stage track today — the M2 milestone adds the
remaining three.

## Inventory

| File                   | Use                  | Source pack            | Source filename                              |
|------------------------|----------------------|------------------------|----------------------------------------------|
| `stage_8bit_loop.ogg`  | M1 default-stage BGM | Kenney Music Jingles   | `Audio/8-Bit jingles/jingles_NES00.ogg`      |

The file is 44.1 kHz Vorbis (`.ogg`) and plays directly via Phaser's WebAudio
backend. It is short (~10 s) and intentionally tonal so it can loop
seamlessly behind a 1–3-minute match without listener fatigue. M2 will add
longer per-stage compositions.

## Source pack

- **Kenney — Music Jingles (1.0)** · CC0 1.0 ·
  https://kenney.nl/assets/music-jingles
  License preserved at `LICENSE-kenney-music-jingles.txt`.

## How it was chosen

Per the Seed's strict priority order:

1. **PRIMARY** — A CC0 chiptune cue from Kenney's *Music Jingles* pack:
   single-author NES-style synth, no attribution burden, < 40 KB so it
   barely touches the 100 MB bundle ceiling.
2. **FALLBACK** — runtime WebAudio synthesis was *not* needed because the
   pack ships ready-to-loop tracks.

Future M2 stage tracks will follow the same priority order; CC-BY entries
(if any are picked up) will be credited in `../../ATTRIBUTION.md`.
