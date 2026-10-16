# Asset Attribution

Third-party assets used in this project, grouped by license.

Every CC-BY asset **must** be listed here with author, title, source
URL, and license URL. CC0 entries are optional but recommended for
traceability. Procedural / in-engine generated assets are not listed.

Format per entry:

```
- **<Asset or pack name>** — <Author / Studio>
  Source: <URL>
  License: <license name + URL>
  Used in: <path(s) under assets/>
```

---

## CC-BY 4.0 (attribution required)

_None yet._

## CC-BY 3.0 (attribution required)

_None yet._

## OGA-BY 3.0 (attribution required)

_None yet._

## CC0 1.0 / Public Domain (attribution optional, listed for traceability)

- **Platformer Art Deluxe (1.0)** — Kenney (kenney.nl)
  Source: https://kenney.nl/assets/platformer-art-deluxe
  License: CC0 1.0 — https://creativecommons.org/publicdomain/zero/1.0/
  Used in: `assets/sprites/items/raygun.png`
  Per-file source mapping (upstream filename inside the pack):

  | Repo file                            | Upstream source filename                  |
  |--------------------------------------|-------------------------------------------|
  | `assets/sprites/items/raygun.png`    | `Request pack/Tiles/raygun.png` (verbatim copy) |

  Notes: Powers the ray-gun item visual. 70×70 transparent PNG used
  verbatim — the manifest scales it on render to fit the in-world
  item silhouette. Upstream license file preserved at
  `assets/sprites/items/LICENSE-kenney-platformer-art-deluxe.txt`.

- **Particle Pack (1.1)** — Kenney (kenney.nl)
  Source: https://kenney.nl/assets/particle-pack
  License: CC0 1.0 — https://creativecommons.org/publicdomain/zero/1.0/
  Used in: `assets/sprites/items/bomb.png`,
  `assets/sprites/items/explosion.png`
  Per-file source mapping (upstream filename inside the pack):

  | Repo file                            | Upstream source filename(s)                                         |
  |--------------------------------------|---------------------------------------------------------------------|
  | `assets/sprites/items/bomb.png`      | `PNG (Transparent)/fire_01.png` (downscaled 512→40, fuse overlay)   |
  | `assets/sprites/items/explosion.png` | 3-frame strip (96×96 each): `flare_01.png`, `fire_01.png`, `smoke_01.png` |

  Notes: Powers the bomb item visual + its detonation explosion
  animation. The bomb sprite adds a small procedural fuse rectangle
  on top of the resized fire-particle so the silhouette reads as a
  bomb-with-fuse rather than just a glowing ball. The 3-frame
  explosion strip plays in sequence (flash → fireball → smoke) on
  the bomb's detonation frame. Upstream license file preserved at
  `assets/sprites/items/LICENSE-kenney-particle-pack.txt`.

- **Pixel Platformer (v1.2)** — Kenney (kenney.nl)
  Source: https://kenney.nl/assets/pixel-platformer
  License: CC0 1.0 — https://creativecommons.org/publicdomain/zero/1.0/
  Used in: `assets/stages/m1/background/`,
  `assets/stages/m1/tiles/`, `assets/stages/m1/tilemap/`,
  `assets/sprites/stages/m1/platforms/`,
  `assets/sprites/stages/m1/background/`,
  `assets/sprites/stages/m1/tilemap/`,
  `assets/sprites/stages/m1/frames.json`
  Notes: Powers the **M1 flat stage** background + platform tile art
  (Sub-AC 2 of AC 10002). 18×18 platform-tile cells (20×9 grid, 180
  tiles) and 24×24 background-tile cells (8×3 grid, 24 tiles), with
  packed and 1-px-gutter atlas variants. Upstream license file
  preserved verbatim at `assets/stages/m1/LICENSE.txt` (and again at
  `assets/sprites/stages/m1/LICENSE.txt` so the engine-facing sprite
  namespace ships its own licence root).
  The curated single-tile PNGs under
  `assets/sprites/stages/m1/{platforms,background}/` are byte-identical
  copies of specific cells from the upstream pack — see
  `assets/sprites/stages/m1/frames.json` for the per-tile
  `(col, row, sourceTileIndex, upstreamFile)` mapping.

- **Impact Sounds (1.0)** — Kenney (kenney.nl)
  Source: https://kenney.nl/assets/impact-sounds
  License: CC0 1.0 — https://creativecommons.org/publicdomain/zero/1.0/
  Used in: `assets/audio/sfx/jab.ogg`, `assets/audio/sfx/tilt.ogg`,
  `assets/audio/sfx/smash.ogg`, `assets/audio/sfx/aerial.ogg`,
  `assets/audio/sfx/ko.ogg`
  Per-file source mapping (upstream filename inside the pack):

  | Repo file                       | Upstream source filename                |
  |---------------------------------|-----------------------------------------|
  | `assets/audio/sfx/jab.ogg`      | `Audio/impactPunch_medium_000.ogg`      |
  | `assets/audio/sfx/tilt.ogg`     | `Audio/impactWood_medium_000.ogg`       |
  | `assets/audio/sfx/smash.ogg`    | `Audio/impactPunch_heavy_000.ogg`       |
  | `assets/audio/sfx/aerial.ogg`   | `Audio/impactPlate_light_000.ogg`       |
  | `assets/audio/sfx/ko.ogg`       | `Audio/impactBell_heavy_000.ogg`        |

  Notes: Powers the M1.5 combat-impact SFX bank (Sub-AC 3 of AC 10003).
  Cuts hand-picked from `impactPunch_*`, `impactWood_*`, `impactPlate_*`,
  and `impactBell_*` so each combat tier (jab / tilt / smash / aerial / KO)
  has a distinguishable timbre. Upstream license file preserved at
  `assets/audio/sfx/LICENSE-kenney-impact-sounds.txt`.

- **UI Audio (1.0)** — Kenney (kenney.nl)
  Source: https://kenney.nl/assets/ui-audio
  License: CC0 1.0 — https://creativecommons.org/publicdomain/zero/1.0/
  Used in: `assets/audio/sfx/shield.ogg`,
  `assets/audio/sfx/dodge.ogg`
  Per-file source mapping (upstream filename inside the pack):

  | Repo file                       | Upstream source filename                |
  |---------------------------------|-----------------------------------------|
  | `assets/audio/sfx/shield.ogg`   | `Audio/switch3.ogg`                     |
  | `assets/audio/sfx/dodge.ogg`    | `Audio/switch16.ogg`                    |

  Notes: Powers the M1.5 defensive SFX (shield raise + dodge whoosh,
  Sub-AC 3 of AC 10003). Cuts taken from the `switch*` family — short
  enough not to overlap with combat impacts. Upstream license file
  preserved at `assets/audio/sfx/LICENSE-kenney-ui-audio.txt`.

- **Interface Sounds (1.0)** — Kenney (kenney.nl)
  Source: https://kenney.nl/assets/interface-sounds
  License: CC0 1.0 — https://creativecommons.org/publicdomain/zero/1.0/
  Mirror used for download (CC0 1.0, Godot-packaged):
  https://github.com/Calinou/kenney-interface-sounds
  Used in: the AC 10304 action-audio expansion — jump / air-jump,
  landing, light / heavy hit connect, weapon clang, shield shatter, and
  the charge wind-up loop.
  Per-file source mapping (upstream filename inside the pack):

  | Repo file                            | Upstream source filename |
  |--------------------------------------|--------------------------|
  | `assets/audio/sfx/jump.wav`          | `maximize_003.wav`       |
  | `assets/audio/sfx/jump_air.wav`      | `maximize_007.wav`       |
  | `assets/audio/sfx/land.wav`          | `minimize_003.wav`       |
  | `assets/audio/sfx/hit_light.wav`     | `drop_001.wav`           |
  | `assets/audio/sfx/hit_heavy.wav`     | `drop_003.wav`           |
  | `assets/audio/sfx/clang.wav`         | `glass_001.wav`          |
  | `assets/audio/sfx/shield_break.wav`  | `glass_004.wav`          |
  | `assets/audio/sfx/charge.wav`        | `bong_001.wav`           |

  Notes: Powers the M1.5 action-audio expansion (AC 10304) — the
  movement, connect-on-hit, shield-shatter, and charge-loop cues that
  round out the Smash-style action vocabulary on top of the original
  seven combat / defensive cuts above. Shipped verbatim as `.wav`
  (the CC0 mirror distributes WAV; Phaser's `load.audio` decodes it
  natively, so no transcode step runs). Glass cuts voice the shield
  shatter + weapon clang; `maximize` / `minimize` voice the jump /
  land arcs; `drop` cuts voice the hit connect tiers; `bong` voices the
  charge hum. Upstream license file preserved at
  `assets/audio/sfx/LICENSE-kenney-interface-sounds.txt`.

- **Music Jingles (1.0)** — Kenney (kenney.nl)
  Source: https://kenney.nl/assets/music-jingles
  License: CC0 1.0 — https://creativecommons.org/publicdomain/zero/1.0/
  Used in: `assets/audio/music/stage_8bit_loop.ogg`
  Per-file source mapping (upstream filename inside the pack):

  | Repo file                                | Upstream source filename                  |
  |------------------------------------------|-------------------------------------------|
  | `assets/audio/music/stage_8bit_loop.ogg` | `Audio/8-Bit jingles/jingles_NES00.ogg`   |

  Notes: Powers the M1.5 default stage music track (Sub-AC 3 of AC 10003).
  Cut from the *8-Bit jingles* sub-folder — chosen because it loops cleanly
  behind a 1–3-minute match. M2 will add longer per-stage compositions;
  this single track satisfies the Sub-AC 3 "1 stage music track" target.
  Upstream license file preserved at
  `assets/audio/music/LICENSE-kenney-music-jingles.txt`.

## Procedural fallbacks & in-house data

Procedurally generated assets are produced at build time or runtime
from TypeScript code. They carry no third-party license obligations.
See source files marked with `// procedural fallback` for inventory.

The `frames.json` files under `assets/sprites/stages/m1/` are **in-house** strip-extraction /
cell-cut metadata authored by this project (cell coordinates, frame
counts, Phaser loader hints, and per-cut upstream-cell references
back to the originating CC-BY / CC0 / OGA-BY source). They are not
derived pixel data and require no upstream attribution on their own —
every PNG they describe is credited above.

---

## Coverage audit

This file is the single source of truth for every third-party asset
shipped under `assets/` (the Vite `publicDir`). The table below cross-
references the asset directory tree against the entries above so AC
10004 Sub-AC 4 can be verified at a glance.

| Asset directory                  | Sourced pack                                       | Section above                              |
|----------------------------------|----------------------------------------------------|--------------------------------------------|
| `assets/stages/m1/`              | *Pixel Platformer* v1.2 (Kenney)                   | CC0 1.0                                    |
| `assets/sprites/stages/m1/`      | *Pixel Platformer* v1.2 (Kenney) — engine-facing curated cuts of the same upstream pack | CC0 1.0 |
| `assets/audio/sfx/jab\|tilt\|smash\|aerial\|ko.ogg` | *Impact Sounds* 1.0 (Kenney)        | CC0 1.0                                    |
| `assets/audio/sfx/shield\|dodge.ogg`               | *UI Audio* 1.0 (Kenney)             | CC0 1.0                                    |
| `assets/audio/music/stage_8bit_loop.ogg`           | *Music Jingles* 1.0 (Kenney)        | CC0 1.0                                    |
| `assets/ui/`                     | _empty — no sourced assets present yet_            | n/a                                        |

Audit method: `find assets -type f` enumerated against the *Used in*
paths above. Every shipped file is attributable to exactly one
entry in this file, with the following well-defined exclusions:

- **`README.md`** files — in-house developer documentation, no
  upstream pixel data.
- **`LICENSE*.txt` / `LICENSE*.md`** files — verbatim upstream license
  copies, preserved alongside the assets they cover (`assets/stages/m1/
  LICENSE.txt`, `assets/sprites/stages/m1/LICENSE.txt`, `assets/audio/
  sfx/LICENSE-kenney-impact-sounds.txt`, `assets/audio/sfx/
  LICENSE-kenney-ui-audio.txt`, `assets/audio/music/LICENSE-kenney-
  music-jingles.txt`).
- **Upstream Kenney info files** (`assets/stages/m1/tilemap/
  Tilesheet-Tiles.txt`, `assets/stages/m1/tilemap/
  Tilesheet-Backgrounds.txt`, and the byte-identical copies under
  `assets/sprites/stages/m1/tilemap/`) ship inside the *Pixel Platformer
  v1.2* pack and are covered by the Kenney CC0 entry above.
- **In-house metadata** (`assets/sprites/stages/m1/frames.json`,
  `assets/characters/*/frames.json`) — covered in the "Procedural fallbacks &
  in-house data" section above.

Re-run the audit whenever new files land under `assets/` or before
each milestone acceptance review.

Last verified: 2026-10-14 (removed fighters' sprite packs and the
build-time palette variants deleted with those fighters; their
attribution entries went with them).
