# Phase 6: the game displays fighters from character packages

Started 2026-10-18 evening, after the [Phase 3 decision](../../2026-10-18/phase3/README.md#step-5-decision-smaller-drawings-held-one-palette-per-character).
Roadmap: [Phase 6, game integration](../../../CHARACTER-SYSTEM-ROADMAP.md).

## Target

- DK, Link and Pikachu are drawn from `character-package/1` packages built with the decided
  settings: drawings at match-size density, held drawings (0.12, max hold 8 ticks), one
  256-colour palette per character on indexed pages (one byte per pixel on the GPU).
- Costumes are palette rows (`character/render/palette.ts`).
- A fighter's art loads in the background when a player selects it and unloads when no
  player has it; players on the same fighter share it.
- The legacy path stays selectable per character until the user accepts the result in real
  matches. Then the legacy readers, sheets, manifest entries and the temporary exporter are
  deleted, so one display method remains.
- Gameplay data (hurtboxes, catch shapes, held-item grip used for hits, root motion, Final
  and victim profiles) stays in game code; it moves out of `frames.json` before that file is
  deleted.

## How the game asks a package for a drawing

The legacy selector (`src/characters/artFrameSelector.ts`) already decides which action and
which age it shows before it looks up a frame: frozen poses, hitlag pauses and rewinds are
handled there. It gains a `display` result `{ action, tick, facing, … }` and the package
backend calls `evaluate(pkg, display)`. The exporter already proved `evaluate` equals the
game's per-clip sampler at every tick; step 0 proves the runtime choice of (action, tick)
matches what the legacy path draws, frame by frame, in real simulations.

## Steps

| Step | Content | Check |
| --- | --- | --- |
| 0 | `display` from the selector; fix the cases where the legacy frame is not a clip tick (Pikachu specials, smash charge, directional air dodge, generic fallbacks); equivalence test over simulated matches | Zero mismatches, fallbacks listed |
| R | Renderer: shipping packages in `assets/characters/<id>/package/` (`npm run character:package`), package library with leases, R8 index textures + palette texture, palette shader with manual bilinear, package backend behind a dev flag | GPU bytes match the estimate; a drawing renders |
| 1 | Link from its package in a real match (dev flag), legacy beside it | Probe screenshots, action/tick/drawing diagnostics |
| 2 | Load on select: the fighter select screen leases the picked fighters; portraits and previews from packages | Load timing, unload on deselect, memory |
| 3 | DK and Pikachu; per-character legacy/package setting; mixed match | Same checks per fighter |
| 4 | Effects (12 strips: Finals, arrows, boomerang) as package actions | Effects visible and aligned |
| 5 | After the user accepts: gameplay data out of `frames.json`; delete legacy display code, sheets, manifest entries, compressed banks and CI step, and the exporter | Full suite, golden scenarios, probes |

Each step: `npm run typecheck && npx vitest run && npm run build`, then a browser check.

## Known risks

- **Held drawings vs held items.** Gameplay keeps the per-tick grip for item hit areas; the
  package holds a drawing longer, so a held item can sit slightly off the hand during a
  held drawing. Option: draw the item at the package socket (display only).
- **Menu art** at match density looks softer when shown larger than in a match.
- **Load time** if a match starts right after selection (DK's pages are 19 MB of PNG).
- **Transition memory**: a mixed match holds legacy sheets and packages together.
- **Tooling** reading legacy diagnostics (`__sim.presentation`) needs package fields.
