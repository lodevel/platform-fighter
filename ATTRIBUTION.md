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

- **Cat Fighter Sprite Sheet** — dogchicken
  Source: https://opengameart.org/content/cat-fighter-sprite-sheet
  License: CC-BY 3.0 — https://creativecommons.org/licenses/by/3.0/
  Used in: `assets/characters/cat/cat_source_sheet.png`,
  `assets/characters/cat/animations/{idle,run,jump,attack}.png`,
  `assets/sprites/characters/cat/animations/{idle,walk,jump,jab,tilt,smash,aerial,shield,dodge}.png`,
  `assets/sprites/characters/cat/frames.json`,
  `assets/generated/sprites/cat/{0_sky,1_fuchsia,2_mint,3_lavender,4_coral,5_lime,6_teal,7_shadow}.png`
  Notes: Powers the **Cat** M1 fighter. 50×50 cells, 10×10 grid; only the
  upper 6 rows hold sprite data (the remainder of the sheet is blank).
  Idle / run / jump / attack strips are extracted into
  `assets/characters/cat/animations/` per the layout in `frames.json`.
  The full M1.5 moveset taxonomy (idle, walk, jump, jab, tilt, smash,
  aerial, shield, dodge) is extracted from the same source sheet into
  `assets/sprites/characters/cat/animations/` — see
  `scripts/extract-move-strips.py` for the cell-by-cell mapping and
  `assets/sprites/characters/README.md` for a one-glance row/col table.
  The 8 PNGs under `assets/generated/sprites/cat/` are **palette-swap
  derivatives** of the same source sheet, produced by the M1.5 hue-shift
  batch script (`scripts/hue-shift.ts`) using the colour mappings in
  `assets/palettes/cat.json`. Index 0 (`0_sky.png`) is byte-identical to
  the canonical source palette; indices 1–7 remap the body / accent /
  highlight slots only. As derivative works of a CC-BY 3.0 original they
  carry the same licence and the same attribution to dogchicken.

- **Dog Fighter (Cat Fighter Remix Base + Add-on One)** — IsometricRobot
  (remix derived from dogchicken's *Cat Fighter Sprite Sheet*, also
  CC-BY 3.0; both authors are credited)
  Source: https://opengameart.org/content/dog-fighter-cat-fighter-remix-base-add-on-one
  License: CC-BY 3.0 — https://creativecommons.org/licenses/by/3.0/
  Used in: `assets/characters/wolf/wolf_source_sheet.png`,
  `assets/characters/wolf/animations/{idle,run,jump,attack}.png`,
  `assets/sprites/characters/wolf/animations/{idle,walk,jump,jab,tilt,smash,aerial,shield,dodge}.png`,
  `assets/sprites/characters/wolf/frames.json`,
  `assets/generated/sprites/wolf/{0_crimson,1_cobalt,2_sunburst,3_forest,4_royal,5_ember,6_lagoon,7_rose}.png`
  Notes: Powers the **Wolf** M1 fighter — gray-furred bipedal canine
  with a blue bandana, drawn in the same Cat-Fighter style so the M1
  roster reads as a matched pair. 64×64 cells, 16×16 grid; the source
  PNG ships with a flat white backdrop instead of true transparency,
  so the M1.5 strip extractor chroma-keys `R, G, B ≥ 250` to alpha=0
  for use under `assets/sprites/characters/wolf/`. Strip layout for the
  legacy idle/run/jump/attack subset documented in
  `assets/characters/wolf/frames.json`; the full moveset
  (idle/walk/jump/jab/tilt/smash/aerial/shield/dodge) is documented in
  `assets/sprites/characters/wolf/frames.json`.
  The 8 PNGs under `assets/generated/sprites/wolf/` are **palette-swap
  derivatives** of the same source sheet, produced by the M1.5 hue-shift
  batch script (`scripts/hue-shift.ts`) using the colour mappings in
  `assets/palettes/wolf.json`. Index 0 (`0_crimson.png`) is byte-identical
  to the canonical source palette; indices 1–7 remap the body / accent /
  highlight slots only. As derivative works of a CC-BY 3.0 original they
  carry the same licence and the same attribution to dogchicken
  (original) and IsometricRobot (remix base).

- **Bearsum (pixel-art bear)** — doudoulolita
  Source: https://opengameart.org/content/bearsum-pixel-art-bear
  License: CC-BY 3.0 — https://creativecommons.org/licenses/by/3.0/
  Used in: `assets/characters/bear/animations/{idle,run,jump,attack}.png`
  Notes: Powers the **Bear** M2 fighter. Upstream pack ships individual
  per-frame PNGs (variable size, RGBA with true alpha). Frames are
  composed into Phaser-friendly horizontal strips with a uniform 60×72
  cell, bottom-aligned and horizontally centred:
  idle = `static1`+`static2` (2 frames), run = `walk1`–`walk4` (4),
  jump = `jump1`–`jump3` (3), attack = `kick1`–`kick4` (4).

## OGA-BY 3.0 (attribution required)

- **Free 3 Cyberpunk Characters Pixel Art** — CraftPix.net 2D Game Assets
  Source: https://opengameart.org/content/3-cyberpunk-characters
  License: OGA-BY 3.0 — https://static.opengameart.org/OGA-BY-3.0.txt
  Used in: `assets/characters/blaze/animations/{idle,run,jump,attack}.png`,
  `assets/characters/blaze/frames.json` (in-house metadata describing the cuts)
  Notes: Powers the **Blaze** post-M5 fighter (rushdown archetype).
  The pack ships three side-view 48×48-cell characters (Biker / Punk /
  Cyborg), each with idle / run / jump / punch / attack1-3 / hurt /
  death strips. Blaze uses character 2 **Punk** — the athletic
  street-brawler silhouette. The four repo strips are **verbatim
  copies** of the upstream strips:

  | Repo file                                      | Upstream source filename        |
  |------------------------------------------------|---------------------------------|
  | `assets/characters/blaze/animations/idle.png`   | `2 Punk/Punk_idle.png` (4 fr)   |
  | `assets/characters/blaze/animations/run.png`    | `2 Punk/Punk_run.png` (6 fr)    |
  | `assets/characters/blaze/animations/jump.png`   | `2 Punk/Punk_jump.png` (4 fr)   |
  | `assets/characters/blaze/animations/attack.png` | `2 Punk/Punk_punch.png` (6 fr)  |

- **Owl Animated person** — Vander96
  Source: https://opengameart.org/content/owl-animated-person
  License: OGA-BY 3.0 — https://static.opengameart.org/OGA-BY-3.0.txt
  Used in: `assets/characters/owl/owl_source_sheet.png`,
  `assets/characters/owl/animations/{idle,run,jump,attack}.png`
  Notes: Powers the **Owl** M2 fighter. Source is a 180×20 horizontal
  strip of 12 frames at 15-px stride. Each animation strip is a
  re-extraction of the same source: idle = frame 0, run = frames 0–7,
  jump = frame 8, attack = frame 11; frames are bottom-aligned in clean
  15×20 cells. Original strip preserved at
  `assets/characters/owl/.opaque_originals/owl_vander.png`.

## CC0 1.0 / Public Domain (attribution optional, listed for traceability)

- **Adventurer and Slime game Sprites** — Segel (Segel2D)
  Source: https://opengameart.org/content/adventurer-and-slime-game-sprites
  License: CC0 1.0 — https://creativecommons.org/publicdomain/zero/1.0/
  Used in: `assets/characters/aegis/animations/{idle,run,jump,attack}.png`,
  `assets/characters/puff/animations/{idle,run,jump,attack}.png`,
  `assets/characters/{aegis,puff}/frames.json` (in-house metadata
  describing the cuts)
  Notes: One CC0 pack powers **two** post-M5 fighters:
  - **Aegis** (sword-spacing archetype) uses the pack's ADVENTURER —
    a slender sword-wielder. idle (12 fr), run (10 fr),
    jump = JumpUp + JumpFall poses (2 fr), attack = the 8-frame sword
    slash.
  - **Puff** (floaty balloon archetype) uses the pack's SLIME04 — a
    small round blob. idle (12 fr), run = the 10-frame hop-scoot Move
    cycle, attack = the 8-frame hop-lunge Attack, jump = re-extraction
    of that lunge's airborne frames 1-4 (the slime has no dedicated
    jump upstream — same single-source re-extraction approach as the
    Owl pack's jump frame).
  Upstream ships per-frame 1333×936 RGBA canvases (true alpha). Each
  used frame was cropped to a per-character fixed union bounding rect
  and box-filter downscaled (Adventurer ÷6 → 128×130 cells; Slime ÷4 →
  136×89 cells), bottom-baseline preserved, then composed into
  Phaser-friendly horizontal strips. Exact rects + frame mappings are
  recorded in each character's `frames.json`. The large upstream
  canvases are not kept in-repo (9.4 MB zip); re-derivation is a
  re-download plus the documented crop/scale parameters.

- **Tiny Kitten Game Sprite** — Segel (Segel2D)
  Source: https://opengameart.org/content/tiny-kitten-game-sprite
  License: CC0 1.0 — https://creativecommons.org/publicdomain/zero/1.0/
  Used in: `assets/characters/volt/animations/{idle,run,jump,attack}.png`,
  `assets/characters/volt/frames.json` (in-house metadata describing the cuts)
  Notes: Powers the **Volt** post-batch-2 fighter (Pikachu-inspired tiny
  combo rushdown) — a small chibi creature standing in for the electric
  mouse. Upstream ships per-frame ~489×461 RGBA canvases (true alpha):
  idle (12 fr), run (10 fr), jump = the JumpUp pose (5 fr),
  attack = re-extraction of the JumpFall pounce pose (5 fr — the pack
  has no dedicated attack, the same single-source re-extraction approach
  the Owl/Puff packs used for a missing slot). Each used frame was
  cropped to a fixed global union bounding rect and box-filter
  downscaled into 64×80 cells (see `frames.json` +
  `tools/build-newchar-sprites.cjs`). The large upstream canvases are
  not kept in-repo; re-derivation is a re-download plus the documented
  crop/scale parameters.

- **CC0 2D Douche Cyborg (Jump, Run, Shoot, Idle)** — Darius Guerrero
  Source: https://opengameart.org/content/cc0-2d-douche-cyborg-jump-run-shoot-idle
  License: CC0 1.0 — https://creativecommons.org/publicdomain/zero/1.0/
  Used in: `assets/characters/nova/animations/{idle,run,jump,attack}.png`,
  `assets/characters/nova/frames.json` (in-house metadata describing the cuts)
  Notes: Powers the **Nova** post-batch-2 fighter (Samus-inspired ranged
  zoner) — an armoured cyborg ('CyborgMark') with an arm-cannon. Upstream
  ships per-frame ~114-139 px-wide RGBA canvases (true alpha): idle
  (15 fr), run (15 fr), jump (15 fr), attack = the pack's Shoot
  animation (9 fr — the cyborg fires its arm-cannon, fitting the zoner's
  projectile identity). Each used frame was cropped to a fixed global
  union bounding rect and box-filter downscaled into 72×96 cells (see
  `frames.json` + `tools/build-newchar-sprites.cjs`).

- **Generic Platformer Pack** — bakudas
  Source: https://opengameart.org/content/generic-platformer-pack
  License: CC0 1.0 — https://creativecommons.org/publicdomain/zero/1.0/
  Used in: `assets/characters/bruno/animations/{idle,run,jump,attack}.png`,
  `assets/characters/bruno/frames.json` (in-house metadata describing the cuts)
  Notes: Powers the **Bruno** post-batch-2 fighter (Mario-inspired
  all-rounder) — the pack's main 'Player' character, a compact
  cap-and-jumpsuit humanoid. Upstream ships native pixel-art per-frame
  PNGs on a 22×32 canvas (true alpha): idle (4 fr), run (8 fr),
  jump (2 fr), attack = re-extraction of the run lunge frames (8 fr —
  the pack has no dedicated attack). Each used frame was cropped to a
  fixed global union bounding rect and re-laid near 1:1 (light box
  filter) into 28×36 cells (see `frames.json` +
  `tools/build-newchar-sprites.cjs`).

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

The palette-definition JSON files under `assets/palettes/` (`cat.json`,
`wolf.json`, `owl.json`, `bear.json`, `palette.schema.json`) are
**in-house** colour-mapping specifications authored by this project.
They contain hex-RGB triples and JSON Schema metadata only — no
third-party pixel data — and therefore require no upstream attribution.
The PNGs they drive (`assets/generated/sprites/<character>/`) ARE
derivative works of the upstream sprite sheets and are credited under
the corresponding CC-BY 3.0 entries above.

The build-cache file `assets/generated/sprites/.palette-cache.json` is
a machine-written incremental-build manifest emitted by
`scripts/hue-shift.ts` (SHA-256 fingerprints of source sheets +
palette JSONs, used to skip work when neither input has changed). It
contains no third-party pixel data and is regenerated from in-house
TypeScript on every run.

The `frames.json` files under
`assets/characters/{cat,wolf,blaze,puff,aegis,volt,nova,bruno}/`,
`assets/sprites/characters/{cat,wolf}/`, and
`assets/sprites/stages/m1/` are **in-house** strip-extraction /
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
| `assets/characters/cat/`         | *Cat Fighter Sprite Sheet* (dogchicken)            | CC-BY 3.0                                  |
| `assets/characters/wolf/`        | *Dog Fighter (Cat Fighter Remix Base + Add-on One)* (IsometricRobot, remix of dogchicken) | CC-BY 3.0 |
| `assets/characters/owl/`         | *Owl Animated person* (Vander96)                   | OGA-BY 3.0                                 |
| `assets/characters/bear/`        | *Bearsum (pixel-art bear)* (doudoulolita)          | CC-BY 3.0                                  |
| `assets/characters/blaze/`       | *Free 3 Cyberpunk Characters Pixel Art* (CraftPix.net) — Punk character | OGA-BY 3.0            |
| `assets/characters/puff/`        | *Adventurer and Slime game Sprites* (Segel) — SLIME04 character | CC0 1.0                        |
| `assets/characters/aegis/`       | *Adventurer and Slime game Sprites* (Segel) — ADVENTURER character | CC0 1.0                     |
| `assets/characters/volt/`        | *Tiny Kitten Game Sprite* (Segel)                  | CC0 1.0                                    |
| `assets/characters/nova/`        | *CC0 2D Douche Cyborg* (Darius Guerrero) — 'CyborgMark' | CC0 1.0                                |
| `assets/characters/bruno/`       | *Generic Platformer Pack* (bakudas) — main 'Player' character | CC0 1.0                         |
| `assets/sprites/characters/cat/` | *Cat Fighter Sprite Sheet* (dogchicken) — full M1.5 moveset strips derived from the same source sheet | CC-BY 3.0 |
| `assets/sprites/characters/wolf/`| *Dog Fighter (Cat Fighter Remix Base + Add-on One)* (IsometricRobot) — full M1.5 moveset strips derived from the same source sheet | CC-BY 3.0 |
| `assets/generated/sprites/cat/`  | *Cat Fighter Sprite Sheet* (dogchicken) — 8 palette-swap derivatives produced by the M1.5 hue-shift script | CC-BY 3.0 |
| `assets/generated/sprites/wolf/` | *Dog Fighter (Cat Fighter Remix Base + Add-on One)* (IsometricRobot, remix of dogchicken) — 8 palette-swap derivatives produced by the M1.5 hue-shift script | CC-BY 3.0 |
| `assets/palettes/`               | _in-house — hex-RGB colour-mapping JSON, no third-party pixel data_ | Procedural / in-house          |
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
- **In-house metadata** (`assets/palettes/*.json`, `assets/sprites/
  characters/*/frames.json`, `assets/sprites/stages/m1/frames.json`,
  `assets/characters/*/frames.json`, `assets/generated/sprites/
  .palette-cache.json`) — covered in the "Procedural fallbacks &
  in-house data" section above.

Re-run the audit whenever new files land under `assets/` or before
each milestone acceptance review.

Last verified: 2026-06-13 (post-batch-2 roster art drop — Volt / Nova /
Bruno sprite packs sourced and entered above: *Tiny Kitten Game Sprite*
(Segel, CC0), *CC0 2D Douche Cyborg* (Darius Guerrero, CC0), and
*Generic Platformer Pack* (bakudas, CC0); coverage table extended with
the three new `assets/characters/{volt,nova,bruno}/` directories. All
three packs are CC0, so attribution is listed for traceability only.
Prior 2026-06-10 entry: post-M5 Blaze / Puff / Aegis packs — *Free 3
Cyberpunk Characters Pixel Art* (OGA-BY 3.0) and *Adventurer and Slime
game Sprites* (CC0).
