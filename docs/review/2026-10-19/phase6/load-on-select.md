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
- Picking does not stall the menu: no long task. Parsing and validating character.json and
  decoding pages run on workers; menu art never reads back from the GPU.
- Once a page is uploaded, the GPU holds its only copy: resident fighters cost about 1 MiB of
  JS heap instead of their texel bytes. A lost WebGL context decodes the pages again.
- A pick dropped before its package finished loading stops loading pages at once and unloads
  after the grace period; picked again in time, it carries on where it stopped.

## Code

| File | Change |
| --- | --- |
| `src/config/gameSettings.ts` | `fighterDisplay: 'legacy' \| 'packages'`, saved with the other options; old saves keep working |
| `port/src/ui/screens/options.ts` | The "Fighter art" row |
| `port/src/fighters/appearance.ts` | `packageFighters` (setting + flag) and `applyFighterDisplay`, the one place that picks each fighter's profile. Entries call it at start, Options when it changes, never during a match |
| `port/src/fighters/artHold.ts` | `FighterArtHold`: leases for the picked fighters drawn from packages; inert once disposed |
| `port/src/ui/screens/fighters.ts` | Holds the picks on every render, releases on leave |
| `port/src/fighters/packageLibrary.ts` | Uploads ≤ 512 KiB per frame; `flushUploads`; a page's bytes are dropped once uploaded (`onUpdate`, `source.dataReady = false`); on `webglcontextrestored` (or another renderer) the dropped pages are fetched, decoded and uploaded again and new leases wait for them; an unheld loading package pauses page loading until held again or unloaded; `borrow` decodes only the asked pages for the CPU; load times, load count, CPU/GPU bytes, restored pages in `diagnostics()` |
| `port/src/fighters/packageDecoder.ts`, `packageDecoder.worker.ts` | Worker pool (2–4): `describe` (parse, validate, pin-check, palette rows; back as compact JSON bytes) and `page` (`decodeIndexedPng`); in place without workers (Node) |
| `port/src/fighters/packageDescription.ts` | `describePackage` and its worker encoding, shared by the worker and the in-place decoder |
| `port/src/fighters/backends/packageSprite.ts` | Menu art borrows only the page it draws; the match lease flushes uploads and waits for the GPU fence before play |
| `port/src/engine/sprites/spriteSnapshot.ts` | Indexed menu art is composed on the CPU (`indexedPixels`) into a CPU-backed canvas (`willReadFrequently`) |
| `port/src/ui/assets/fighterArt.ts` | Trims on CPU-backed canvases and encodes the PNG with `toBlob` (object URL) instead of `toDataURL` in the frame |
| `port/src/engine/gpuFence.ts` | `gpuFinished`: polls a WebGL2 fence |
| `port/src/match/preloadMatchArt.ts` | No longer selects profiles |
| `port/src/entries/game.ts`, `costumes.ts`, `viewer.ts` | Apply the choice at start; the game attaches the library to its renderer |
| `port/src/ui/screens/match.ts`, `game.ts` | `renderDiagnostics().packages`, `__menu.packages()` with renderer texture count |

## Browser check

`tools/package-load-on-select-probe.mjs` on the production build in Windows Edge (real GPU,
144 Hz display, 1920×1080). Real DOM input only: mouse clicks on Options, Versus, portraits,
the CPU › button and stage row; keys C, Esc and Enter. The same flow ran with Classic.
Frames are `requestAnimationFrame` intervals over 2 s from the input. Reports:
[load-on-select/report.json](load-on-select/report.json) (this version) and
[report-before.json](load-on-select/report-before.json) (the first version, same session and
machine, from `HEAD`'s probe on a build of `HEAD`). The probe now also drops a pick within the
grace period and loses the WebGL context in a match.

### Loads and unloads

Joining picks the slot's default fighter (P1 DK, P2 Pikachu, P3 Link), so a join is a pick.
Before → after, one probe run each.

| Step | Pages | Load | Input to loaded | Frame max (before → after) |
| --- | ---: | ---: | ---: | --- |
| P1 picks DK (portrait click) | 213 | 948 → 1,291 ms | 1,006 → 1,388 ms | 41.5 → 62.3 ms |
| CPU P2 joins on Pikachu (C) | 209 | 876 → 804 ms | 893 → 846 ms | 41.5 → 34.8 ms |
| CPU P2 → Link (› click) | 232 | 1,104 → 862 ms | 1,185 → 925 ms | 62.2 → 27.7 ms |
| P1 picks DK again | 213 | 1,227 → 1,061 ms | 1,294 → 1,117 ms | 20.9 → 27.8 ms |

Load times vary ±25 % between runs either way. No long task (> 50 ms) in any pick.

| Unload | After the input |
| --- | ---: |
| Pikachu, when P2 changed to Link | 3,052 ms |
| DK, when P1 dropped its pick (Esc) | 3,019 ms |

A second CPU on Link added no load (one lease).

### Pick dropped while loading

P2 (CPU on Link) steps back to Pikachu (‹), then forward to Link (›) 250 ms later:

| Pikachu | Before | After |
| --- | --- | --- |
| At the drop | loading | 104 / 209 pages, paused |
| 1.5 s later | still loading, then 209 / 209 | 107 / 209 (the pages already in flight finish) |
| Unloaded | after loading and the grace period | 3,001 ms after the drop |

### First pick of a fighter

What held the worst frame, from Edge traces (`disabled-by-default-v8.cpu_profiler`) of the
same three first picks, before and after:

| Main-thread work in the pick | Before | After |
| --- | --- | --- |
| Card art: `getImageData` on a GPU canvas, waiting behind the queued uploads | 17–31 ms, plus `toDataURL` 3–4 ms | gone (CPU canvases, `toBlob`) |
| character.json: `response.json()` + `validatePackage` + palette rows | on the main thread | on a worker; the main thread parses the compact JSON it sends back, 2–4 ms |
| Select screen layout on the click (text shaping, `InlineNode::ShapeTextIncludingFirstLine`) | 14–56 ms | 8–30 ms; the same with Classic |
| One frame's uploads (`texSubImage2D`, 512 KiB) | 6–10 ms | 8–18 ms |

Sending the description as a structured clone instead cost 10–18 ms in `onmessage` for Link;
in Edge, a structured clone of a package deserializes in 3–11 ms, its compact JSON parses in
2–4 ms.

Worst frame per first pick, five fresh contexts each, untraced
([first-picks.json](load-on-select/first-picks.json)). The display runs at 144 Hz, so frames
are multiples of 6.9 ms; run 1 is the first context after Edge starts.

| Pick | Before | After | Classic (after) |
| --- | --- | --- | --- |
| DK | 103.9, 27.7, 20.8, 34.6, 34.5 | 62.4, 41.5, 28.5, 34.6, 27.7 | 55.4, 34.6, 34.6, 34.7, 13.9 |
| Pikachu | 34.0, 13.9, 13.9, 27.5, 20.9 | 41.5, 20.8, 14.0, 14.0, 20.8 | 55.3, 41.6, 27.8, 20.8, 13.8 |
| Link | 20.8, 20.7, 14.0, 27.7, 13.9 | 34.6, 14.0, 15.0, 20.8, 27.6 | 34.6, 13.9, 27.8, 13.9, 20.8 |

Not met: no frame over 20 ms. The package work left on the main thread is small, but the worst
frame of a first pick is as noisy as Classic's, and DK's first pick (the first card to appear)
stays at 28–62 ms, like Classic's, from the select screen's own layout. Uploading 256 KiB per
frame instead of 512 KiB did not change the worst frames (DK 20.8–55.6, Pikachu 7.3–62.3,
Link 13.9–48.5 ms over five runs) and would double the load time, so it stays 512 KiB.

### Match start

| Case | Stage click → ready (before → after) |
| --- | ---: |
| Compact, DK and Link loaded on the select screen | 632 → 703 ms, no new load |
| Classic, same fighters | 4,575 → 4,150 ms |
| Compact, stage chosen 0.6–0.9 s after picking | 1,719 → 1,449 ms |

In the match, after the first second: median 6.9 ms either way, max 20.8 → 27.7 ms (Classic
13.6 → 34.7 ms in the same runs).

### Lost WebGL context

In the match (DK and Link, 445 pages), `WEBGL_lose_context.loseContext()`, 300 ms, then
`restoreContext()`; the match screen stops on the loss as before, and "Restart match" starts it
again.

| | |
| --- | --- |
| Pages fetched, decoded and uploaded again after `webglcontextrestored` | 445, in 1,874 ms |
| Page bytes on the CPU before the loss, and after the pages went up again | 16 KiB (the two palettes) |
| Restarted match, frame 90 | both fighters `visible`, the same drawings as before the loss |
| Pixels differing from frame 90 of a fresh start | 1.4 %, all background motion ([before](load-on-select/packages-context-before.png), [after](load-on-select/packages-context-restored.png)) |

A lease taken while the pages are being decoded again waits for them, so the restarted match
does not start with empty textures.

### Memory

`gpuBytes` is texels handed to WebGL. `cpuBytes` is page and palette bytes still held in the page:
before, every decoded page stayed as its texture's CPU copy; now only pages not yet uploaded and
the palettes (8 KiB per fighter) do. JS heap measured after a forced collection.

| Moment | Resident | Package GPU bytes | WebGL textures | Package CPU bytes (before → after) | JS heap (before → after) |
| --- | --- | ---: | ---: | ---: | ---: |
| Select screen, nothing picked | – | 0 | 14 | 0 → 0 | 38.2 → 37.7 MiB |
| DK | DK | 83.2 MiB | 228 | 83.2 MiB → 8 KiB | 122.2 → 39.0 MiB |
| DK, Pikachu, Link | all | 134.0 MiB | 671 | 134.0 MiB → 24 KiB | 175.3 → 40.9 MiB |
| Pikachu dropped | DK, Link | 114.3 MiB | 461 | 114.3 MiB → 16 KiB | 154.9 → 40.2 MiB |
| DK dropped | Link | 31.1 MiB | 247 | 31.1 MiB → 8 KiB | 70.9 → 39.4 MiB |
| In the match | DK, Link | 114.3 MiB | 461 | 114.3 MiB → 16 KiB | 156.3 → 41.7 MiB |
| Back at the menus after 3 s | – | 0 | 14 | 0 → 0 | 44.4 → 46.4 MiB |

### What made picking smooth

| Change | Effect measured in Edge |
| --- | --- |
| Decode on workers | Before: 0.75 s of row unfiltering and PNG parsing on the main thread per DK load, a 109 ms long task, a 145 ms frame |
| Uploads ≤ 512 KiB per frame | Four pages in one frame blocked 15–19 ms in `texSubImage2D` (command buffer waits) |
| GPU fence before play | Without it, a match started from the title screen held its first frame 290–430 ms while the GPU finished the uploads; now 170–240 ms, like Classic (0–220 ms) |
| CPU menu art | Card art no longer reads back from a second WebGL context |
| CPU-backed canvases, `toBlob` | Trimming card art no longer waits 17–31 ms for the GPU behind queued uploads |
| Description on a worker | Parsing and validation off the main thread; compact JSON back (2–4 ms to parse) |
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
- Menu art loads character.json (shared with a loaded package) and only the one page it draws,
  decoded for the CPU: a resident package's pages are on the GPU only.

## Checks

- `npm run typecheck` (layers ok), `npm run build`.
- Targeted tests (`port/src/fighters`, `engine`, `match`, `ui`, `src/config`, `character/render`).
  New: `packageDescription.check.ts`; library cases for dropping uploaded bytes, decoding again
  on `webglcontextrestored`, and pausing then cancelling an unheld load.
- `tools/package-load-on-select-probe.mjs` in Edge as above, under `.tmp/dk-heavy.lock`.

## Open

- First picks still reach 28–62 ms on DK's first pick and up to ~40 ms otherwise, as with Classic.
  The largest remaining part is the select screen's layout and text shaping on the click
  (8–30 ms), then single upload frames (`texSubImage2D` up to 18 ms) and GC (5–8 ms).
- Restoring after a lost context refetches the pages (from the HTTP cache when the browser kept
  them) and takes about 2 s for two fighters.
- The 404 in every run, Classic too, is the browser's `/favicon.ico` request (the build has none).
  The extra console error in the Compact run is the game's own message for the lost context.
