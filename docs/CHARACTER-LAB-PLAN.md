# Character package and lab plan (roadmap Phase 2)

2026-10-18. Execution plan for Phase 2 of the
[character system roadmap](CHARACTER-SYSTEM-ROADMAP.md): a portable character
package, its validator, an exporter for today's fighters, a pose evaluator and a minimal
standalone lab. Phase 1 fixed the [reference set](review/2026-10-18/phase1-reference-set/README.md):
ten DK and ten Link motions, scored against the original Ultimate move (20/20).

**Why:** today every movement is stored as full PNG drawings, which is why one
fighter needs 280–680 MiB uncompressed. That does not scale to a larger roster.
The package is the container in which cheaper ways to encode movement (reused
parts, deformation, computed poses) are tried in Phase 3 and then adopted. The
memory each character needs is therefore the lab's central measurement.

Scope is display only. Fighter mechanics (hitboxes, damage, physics, special
clocks) are independent and stay in the game.

**Gate (roadmap):** a package previews without game imports; logical timing and
geometry survive import/export; dependency checks enforce the boundary. For
this display-only package, "geometry" means drawing placement and sockets.

Phase 2 changes no game behaviour, asset or menu. The game keeps reading
`frames.json` through `src/characterPresentation/legacy/` until Phase 6.

## One method for every character

The package is meant to become the **only** way a character is *displayed* in
this project. The [add-character skill](../.agents/skills/add-character/SKILL.md) will
produce packages directly once the generation path is automated (Phase 4) and the
game loads them (Phase 6). Three consequences:

- **One display method.** Drawing schedules, layers, root placement, sockets for
  held items and the shapes shown in overlays work the same way for every
  character. Display differences between the three dialects are resolved in the
  importer; a missing display concept becomes a general one, not a per-fighter mode.
- **Fighters keep their own mechanics.** Special gameplay cases stay legitimate
  and stay in the fighter's game code or a versioned host extension: Pikachu's
  special clocks, DK's paired cargo timelines, capture calibration, Final Smash
  victim profiles. The game turns them into a plain request (action, phase, age,
  facing, equipment) and the display answers it the common way.
- **The importer is a one-time migration.** It exists to move DK, Link and Pikachu
  over. Once the game reads packages, the importer, the three `frames.json`
  dialects and the legacy readers that consume them are deleted together.
- **The format must cover creation, not only playback.** Fields the skill needs
  (provenance of each drawing, the source move it follows, review status) belong
  in the format from the start, so the skill does not grow a side format later.

## What the import has to absorb

Each fighter's `frames.json` is a different dialect of the same ideas:

| Concept | DK | Link | Pikachu |
| --- | --- | --- | --- |
| Drawing timing | `nativeSampleIndices` (195), some `frameWindows`, `actionFrameStarts` | `nativeSampleIndices` (225), `actionFrameStarts` | `frameWindows` (184) + `nativeWindows`, hold rules, special clocks |
| Atlas | packed `trims` | packed `trims`, 7 grid sheets | packed `trims`, separate Final display pages |
| Gameplay geometry | hurtbox, attack, catch and capture-grip poses, root deltas, paired timelines | root deltas only | hurtbox, attack-by-role poses, effect points, root deltas |
| Held items | `itemAttachmentPoses` (63) | (222) | (89) |
| Finals / victims | `runtimeFinal*Profiles` | `runtimeFinalVictimProfiles` | both, plus `final-visual-frames.json` |

The package states these once, in one vocabulary. Converting the three dialects
is the importer's job, and proving nothing was lost is the main Phase 2 risk.

## Modules

All new code lives under `character/`, outside `src/` and `port/`:

| Folder | Contents | May import |
| --- | --- | --- |
| `character/package/` | Types for format `character-package/1`, the validator, the canonical serializer, window compression and memory estimates | nothing outside the folder |
| `character/evaluator/` | Pure sampling of an action at a tick: drawing, its source frame, body-centre offset and sockets | `package/` |
| `character/render/` | Costume recolour: the colour shifts of a costume and the GLSL that applies them; the game's sprite layer uses the same file | `package/` |
| `scripts/character-package/` | Temporary exporter turning today's fighters into packages (deleted in Phase 6) | The game and `character/package/`; it is game-side code |
| `character/candidates/` | Phase 3 candidate generators (Node): retiming, hold selection, drawing signatures, page packing, area shrink, per-character palette, shared report writer | `package/`, `evaluator/`, `node:`, pngjs |
| `character/lab/` | Standalone Vite app with its own HTML entry | `package/`, `evaluator/`, `render/`, three |

A vitest boundary test, like `src/sim/importGraph.test.ts`, walks each folder's
import graph and fails on any other edge. In particular `src/`, `port/` and fighter
classes are unreachable from the package, evaluator and lab. `npm run typecheck`
covers the new folders.

## Package format `character-package/1`

One directory per character revision:

```text
<id>/character.json      identity, conventions, actions, drawings, resources
<id>/pages/*.png          atlas pages (unchanged pixels from the import)
<id>/references.json      optional, local only: Ultimate reference media per action
```

`character.json` contains:

- **Identity and conventions:** `id`, `revision` (content hash), units (design px,
  +X right, +Y down, origin at the root), clock (`native` ticks at 60 Hz), and how
  mirroring works.
- **Actions:** duration, loop flag, phases, and tracks keyed by native tick:
  - drawing schedule per layer, as hold windows;
  - root offset;
  - sockets: held-item grip position and angle, effect points.

  Gameplay shapes (hurtbox, attack, catch, capture poses) that live in
  `frames.json` today are game data, not display, and are not imported. They move
  to the fighter's game data before `frames.json` is deleted in Phase 6.
- **Drawings:** stable logical IDs (`<action>/<n>`), each pointing at a page
  rectangle with an offset and pivot. A page position never identifies geometry.
- **Resources:** each page's file, size, SHA-256 and byte cost.
- **Costumes:** colour regions of the art (slot, colour as drawn, HSV tolerance; at
  most four) and the costume list (name, colour per slot). Costume 0 is the art as
  drawn; costume N moves each region by its slot's colour relative to costume 0.
- **Host extensions:** display data that only this game's mechanics use, if any
  survives the inventory, under `extensions["platform-fighter/1"]`, validated by the
  host adapter, not the core.
- **Provenance:** source file hashes and importer version.

The validator rejects:
- missing or overlapping schedule windows;
- references to drawings or resources that don't exist;
- an action with no route (no silent idle fallback);
- tracks outside the action's duration;
- unknown fields outside `extensions`.

Serialization is canonical (sorted keys, fixed number format), so the same input
produces byte-identical output.

## Evaluator

```ts
evaluate(pkg, { action, tick, facing }) → {
  drawing, sample, bodyCentreFromRootY, sockets }
```

The evaluator is pure, takes an explicit age in native ticks, and is mirror-aware.
Its display timing is common to all characters: hold windows over native ticks,
phases, loops, and phases whose length the game decides (charge holds, playable
cutoffs). A fighter's special gameplay clock, such as Pikachu's, stays in that
fighter's game code and supplies the age it asks for; the evaluator only displays it.

## Export from the game, exact by construction

Today's display timing is spread over five data encodings and several tables in
game code (Pikachu's getups, techs and item motions, DK's Final victim and
effect banks). Re-implementing each rule in an importer would duplicate them.
Instead, the exporter asks the game's own selection functions, per clip and per
tick, which drawing is shown, and compresses the answers into windows:

| Clips | Game function sampled |
| --- | --- |
| DK and Link body clips | `selectPackedDrawing` (packed windows and native-sample clocks) |
| DK Final clips | `sampleFinalBodyPose` |
| Pikachu reviewed clips | `getPikachuReviewedStateClock` |
| Pikachu table-timed clips | `selectPikachuAuxiliaryBody` |
| Pikachu Final display | `pikachuFinalVisualPose` |
| Final victims and effects | the victim and effect profile selectors |
| Clips timed only by a fixed frame rate in code | a nominal schedule, flagged in the report |

Drawing placement comes from the game's render-metric functions, and held-item
sockets from the same reader the game uses, which is refactored to expose a
clip-level entry point (one implementation for both).

**Checks.** For every exported action, `evaluate` must equal the game's function
at every tick up to twice the sampled horizon, so the loop, hold and stop rules
are verified beyond the sampled range. Export → canonical JSON → parse → export
must be byte-identical. Anything the window model cannot express is listed in the
export report, never approximated silently.

## Lab (minimal, Phase 2)

A separate page, `character-lab.html`, with its own Vite entry. It must build and
run without the game bundle:
- **Load:** open a package folder (dev server path or folder picker).
- **Browse and play:** action list with the reference set pinned on top; play,
  pause, step, seek on a tick timeline showing phases and drawing holds; loop.
- **Display conditions:** facing flip, dark/light stage, zoom 1.4 and 2.8 at real
  match pixel size.
- **Overlays:** root and sockets, toggled separately.
- **Ultimate reference:** when `references.json` maps the action to a local UFD
  recording, it plays beside the package in the same tick time. This is the 20/20
  comparison the user scores against. Missing references are shown as missing.
- **Memory panel:** per action and total. Counts drawings, page bytes,
  uncompressed and BC7 estimates, and resources shared across actions.

Recoloured costumes were added at the start of Phase 3: the palette shader moved
into `character/render/` and the lab has a costume picker
([record](review/2026-10-18/phase3/README.md)).

## Steps

1. Package types, validator and canonical serializer, with unit tests.
2. Evaluator with the common timing model, with unit tests.
3. Exporter for DK, Link and Pikachu, plus the equivalence and round-trip
   checks on every action. Expect most of the effort and most of the findings here.
4. Boundary test and typecheck coverage.
5. Lab app with the features above; `references.json` for the reference set from
   the local UFD recordings.
6. Evidence record under `docs/review/<date>/character-lab/`, containing:
   - equivalence and round-trip results;
   - package sizes;
   - boundary test output;
   - lab screenshots in Edge for both fighters, both facings, both zooms and with
     the UFD reference side by side;
   - a production build of the lab alone.

## Later, outside Phase 2

- Phase 4 rewrites the add-character skill to create packages. Phase 6 switches the
  game to packages and deletes the importer and the legacy `frames.json` readers.

## Out of scope

- Game integration (Phase 6). The game does not load packages in Phase 2.
- New art or representations (Phase 3).
- Generation jobs (Phase 4).
- Compressed pages in packages. The lab estimates BC7 cost; the compressed bank
  stays a game build artefact.
- Shipping UFD media. References stay git-ignored, local review material.
