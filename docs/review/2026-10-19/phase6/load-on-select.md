# Phase 6, step 2: fighter art loads when a player picks it

Part of the [Phase 6 plan](PLAN.md). Date: 2026-10-19.

## Result

- A new option chooses the fighter art: **Options → Fighter art: Classic / Compact (new)**.
  Classic (legacy sheets) stays the default. The probe flag `?packages=all|<id>,…|none` still
  overrides it.
- With Compact, a fighter's package loads in the background as soon as a player or CPU has it
  on the fighter select screen. It unloads 3 s after nobody has it. Players on the same fighter
  share one copy.
- The match start reuses what is loaded: no second load, and it waits only for the rest.
- Portraits, card art, the stage lineup, results, the match HUD and the costume page all draw
  from packages when Compact is chosen.
- Picking does not stall the menu: no long task, and decoding runs on workers.

## Code

| File | Change |
| --- | --- |
| `src/config/gameSettings.ts` | `fighterDisplay: 'legacy' \| 'packages'`, saved with the other options; old saves keep working |
| `port/src/ui/screens/options.ts` | The "Fighter art" row |
| `port/src/fighters/appearance.ts` | `packageFighters` (setting + flag) and `applyFighterDisplay`, the one place that picks each fighter's profile. Entries call it at start, Options when it changes, never during a match |
| `port/src/fighters/artHold.ts` | `FighterArtHold`: leases for the picked fighters drawn from packages; inert once disposed |
| `port/src/ui/screens/fighters.ts` | Holds the picks on every render, releases on leave |
| `port/src/fighters/packageLibrary.ts` | Pages decoded on workers; uploads ≤ 512 KiB per frame; `flushUploads`; `borrow` (one drawing's pages); load times, load count and CPU/GPU bytes in `diagnostics()` |
| `port/src/fighters/pageDecoder.ts`, `pageDecoder.worker.ts` | Worker pool (2–4) running `decodeIndexedPng`; in place without workers (Node) |
| `port/src/fighters/backends/packageSprite.ts` | Menu art borrows only the page it draws; the match lease flushes uploads and waits for the GPU fence before play |
| `port/src/engine/sprites/spriteSnapshot.ts` | Indexed menu art is composed on the CPU (`indexedPixels`): no GPU readback |
| `port/src/engine/gpuFence.ts` | `gpuFinished`: polls a WebGL2 fence |
| `port/src/match/preloadMatchArt.ts` | No longer selects profiles |
| `port/src/entries/game.ts`, `costumes.ts`, `viewer.ts` | Apply the choice at start; the game attaches the library to its renderer |
| `port/src/ui/screens/match.ts`, `game.ts` | `renderDiagnostics().packages`, `__menu.packages()` with renderer texture count |

## Browser check

`tools/package-load-on-select-probe.mjs` on the production build in Windows Edge (real GPU,
144 Hz display, 1920×1080). Real DOM input only: mouse clicks on Options, Versus, portraits,
the CPU › button and stage row; keys C, Esc and Enter. The same flow ran with Classic.
Frames are `requestAnimationFrame` intervals over 2 s from the input. Report:
[load-on-select/report.json](load-on-select/report.json).

### Loads and unloads

Joining picks the slot's default fighter (P1 DK, P2 Pikachu, P3 Link), so a join is a pick.

| Step | Pages | Load | Input to loaded | Frame median / p95 / max | Frames > 33 ms |
| --- | ---: | ---: | ---: | --- | ---: |
| P1 picks DK (portrait click) | 213 | 1,008 ms | 1,085 ms | 7.0 / 13.9 / 41.6 ms | 1 |
| CPU P2 joins on Pikachu (C) | 209 | 851 ms | 871 ms | 7.0 / 13.9 / 48.4 ms | 1 |
| CPU P2 → Link (› click) | 232 | 849 ms | 927 ms | 6.9 / 13.8 / 34.6 ms | 1 |
| P1 picks DK again | 213 | 1,214 ms | 1,281 ms | 6.9 / 13.9 / 27.9 ms | 0 |
| Same picks, Classic | – | – | – | 6.9 / 7.1 / ≤ 20.8 ms | 0 |
| Idle select screen, either | – | – | – | 6.9 / 7.1 / ≤ 13.9 ms | 0 |

No long task (> 50 ms) in any pick. Over seven runs, the first DK pick held one frame for
42–76 ms and Pikachu or Link picks 28–56 ms. Classic picks peaked at 14–42 ms across runs.

| Unload | After the input |
| --- | ---: |
| Pikachu, when P2 changed to Link | 3,074 ms |
| DK, when P1 dropped its pick (Esc) | 3,044 ms |

A second CPU on Link added no load (`loads` stayed 3, one lease).

### Match start

| Case | Stage click → ready |
| --- | ---: |
| Compact, DK and Link loaded on the select screen | 693 ms, no new load (`loads` 4 before and after) |
| Classic, same fighters | 4,598 ms |
| Compact, stage chosen 1.1 s after picking (DK 54/213, Link 42/232 pages loaded) | 1,710 ms |

In the match, after the first second: median 6.9 ms, max 27.6 ms (Classic 13.8 ms).

### Memory

`gpuBytes` is texels handed to WebGL. The decoded pages also stay in the page as the textures'
CPU copy (`cpuBytes`, same amount). JS heap measured after a forced collection.

| Moment | Resident | Package GPU bytes | WebGL textures | JS heap |
| --- | --- | ---: | ---: | ---: |
| Select screen, nothing picked | – | 0 | 14 | 37.9 MiB |
| DK | DK | 83.2 MiB | 228 | 122.2 MiB |
| DK, Pikachu, Link | all | 134.0 MiB | 671 | 175.3 MiB |
| Pikachu dropped | DK, Link | 114.3 MiB | 461 | 154.9 MiB |
| DK dropped | Link | 31.1 MiB | 247 | 70.9 MiB |
| In the match | DK, Link | 114.3 MiB | 461 | 156.3 MiB |
| Back at the menus after 3 s | – | 0 | 14 | 44.4 MiB |

### What made picking smooth

| Change | Effect measured in Edge |
| --- | --- |
| Decode on workers | Before: 0.75 s of row unfiltering and PNG parsing on the main thread per DK load, a 109 ms long task, a 145 ms frame |
| Uploads ≤ 512 KiB per frame | Four pages in one frame blocked 15–19 ms in `texSubImage2D` (command buffer waits) |
| GPU fence before play | Without it, a match started from the title screen held its first frame 290–430 ms while the GPU finished the uploads; now 170–240 ms, like Classic (0–220 ms) |
| CPU menu art | Card art no longer reads back from a second WebGL context |
| One description per load | `borrow` reuses the loading package's character.json |

## Menus

| Screen | Evidence |
| --- | --- |
| Options | [packages-options.png](load-on-select/packages-options.png) |
| Fighter select | [packages-select-ready.png](load-on-select/packages-select-ready.png), [legacy](load-on-select/legacy-select-ready.png), [crops](load-on-select/compare-select.png) (top Compact, bottom Classic) |
| Stage lineup | [packages-stages-lineup.png](load-on-select/packages-stages-lineup.png) |
| Match and HUD | [packages-match.png](load-on-select/packages-match.png) |
| Results (Link's victory motion) | [packages-results.png](load-on-select/packages-results.png) |
| Costumes | [packages-costumes.png](load-on-select/packages-costumes.png), [legacy](load-on-select/legacy-costumes.png), [crops](load-on-select/compare-costumes.png) (left Compact, right Classic) |

- Portraits and cards look like Classic. Shown larger than in a match, the package art is a
  little softer (Pikachu's outline, Link's sword), as expected from match-density drawings.
- Costumes are clean. Classic's recolour leaves a light fringe on DK's "Necktie"; the palette
  row does not.
- Menu art for an unpicked fighter loads only character.json and the one page it draws.

## Checks

- `npm run typecheck` (layers ok), `npm run build`.
- Targeted tests, 178 in 33 files (`port/src/fighters`, `engine`, `match`, `ui`, `src/config`,
  `character/render`). New: `artHold.check.ts`, `gpuFence.check.ts`, `spriteSnapshot.check.ts`,
  library cases (borrow, borrow while loading, upload pacing, diagnostics), settings cases.

## Open

- The first pick of a fighter still holds one frame for 28–76 ms. Parsing and validating
  character.json (1–2 MB) on the main thread is the largest remaining part, 10–20 ms.
  Moving it to a worker costs about as much in structured cloning.
- Resident memory is twice the GPU bytes: the CPU copy is kept for context loss and menu art.
- A pick dropped within the grace period still finishes loading, then unloads.
- The 404 in every run, Classic too, is the browser's `/favicon.ico` request (the build has none).
