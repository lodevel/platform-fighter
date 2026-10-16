# Three.js live host and root cutover

The root app now uses Three.js + HTML over the production `MatchSim`; `npm run
build` writes the app to `dist/`, and the preview runs at
`http://localhost:4173/platform-fighter/`. The frozen Phaser comparator on 4300
was left intact.

## Implemented

- Real fixed-step simulation, source-bound replay/history identity, exact
  checkpoint reconstruction and one authoritative fixed-clock accumulator.
- Actual DOM keyboard + browser gamepads through the shared saved-profile
  resolver, pause/resume/restart, paused profile editing, reconnect handling,
  intro, GAME hold, canonical results/stats and rematch flow.
- Actual source fighter/Final/recipient art and event snapshots; HUD, camera,
  Web Audio, debug collision areas, source shields, held items, projectiles,
  specials, ScreenKO, spawn platforms and traps.
- Procedural blue Remote Bomb and luminous sword beam art; collision/debug
  geometry remains separate and unchanged.
- Authoritative moving/crumbling platform positions and activity; hazard
  visuals use the simulation's stage clock and freeze with gameplay.
- Sandbox uses the same live host. Public probes expose `window.__sim`
  including `ready`, `manual`, `step`, `advance`, `draw`, `view`, `state`,
  `presentation`, `checkpoint`, `restore` and the actual `match` instance.
- Root no longer depends on Phaser. Retired host, renderers, editors and
  plugin-only glue are listed in `step9-deleted-files.txt`. Pure menu state,
  schemas and every current gameplay/physics module remain.
- `npm run build:static` includes only manifest runtime assets (717 before
  the later DK Final bank), with private personal images excluded. Local
  preview serves shared assets without copying source capture folders.
- Vendored Matter can be rebuilt/verified from committed source, without
  reinstalling Phaser: `node port/scripts/vendor-matter.mjs --check`.

## Evidence

- `port-live/report.json`: 20 actual browser checks, zero page errors. Includes
  real keyboard/gamepad movement and attacks, profile rebinding, pause,
  checkpoints, Link articles, all six CPU-match stages and actual result flow.
- `dk-jostle/observations.json`: 4 cases/16 checks pass through actual host.
- `link-playable/report.json`: 47 diagnostic scenarios, zero page errors or
  invisible fighter frames. This records contact/article/clock behavior;
  its old static normal-damage table is diagnostic and is not a pass gate.
  It records 3 expectation mismatches: jab123's finisher did not connect in
  that fixture, the second forward-smash contact is stale, and the back-air
  fixture did not connect. These are retained observations, not passed cases.
- `visual-parity/report.json`: 18 exact recorded-frame comparisons against
  frozen Phaser, produced by the root agent after the root cutover.
- Parent golden reports cover 55,800 identical simulation frames before the
  intentional Pikachu Final fixes and Inferno gaze gameplay extension.
  The historical 3,600-frame Final-ball scenario exercised meter/ball state
  without activating a Final; it is not choreography evidence. Actual Final
  choreography is qualified by the production contact suites and real-key
  browser cases, with a longer current golden recorded separately.
- Focused cutover recovery: 44 tests pass across real match ending, pure lobby
  handoff and genuine packed/authored asset coverage. Final full-suite and
  production-build qualification are recorded separately after the Final
  owner art merges.

Maintained browser qualification entrypoints are listed in root README and
share `tools/browser-match-host.mjs`. Retired Phaser/Lab/preview probes are
explicitly archived under `tools/archive/phaser/INDEX.json`; specialized old
visual qualification does not automatically transfer to the new renderer.
Completed one-time migration tools live under `port/scripts/archive/gate/`.

Headless browser evidence does not establish human control feel or human
visual acceptance.

## Corrected production candidate

`game-BYOl1XlT.js`, simulation identity
`platform-fighter-sha256-aedf4dbb82fd1923b83d2bf316a65c22b6839b12d4d82d604606e4f15282af86`.
The root strict build and `build:static` pass, including 723 runtime assets.
The all-tests gate passed 12,027 tests/548 files; the subsequent cinematic
same-tick pocket-fit correction passed 52 targeted tests, including genuine
whole-history reconstruction and 281 matching Pikachu continuation hashes.
The final all-tests rerun on the corrected source also passes 12,027 tests /
548 files in 108.75 seconds (`final-tests.txt`).

`final-live/report.json` passes 24 checks with no page errors, including saved
profile use in the same match, actual keyboard and simulated gamepad input,
disconnect pause, reconnect at a different device index, unchanged checkpoint
restoration, all six arenas, procedural articles and genuine Link result art.
`final-audio.json` observes 600 actual CPU-match frames, 39 decoded buffer starts
and one looping music track, with no page errors. Both bind the current
production build or its exact simulation identity.

The final current golden matrix passes all 11 comparisons / 36,600 frames:
8 historical ordinary-combat scenarios, plus the new 7,200-frame Final case
at default timing, after a 600-frame warm-up, and at 144 Hz. The new reference
actually activates Finals (controller sequence 3, including Pikachu), so this
extends the resource-only historical record with current choreography coverage.
Targeted browser acceptance independently covers all three Final owners.

`final-menus/report.json` completes the actual keyboard/simulated-pad menu
round trip with 25 recorded observations and no page errors. The same
UI-selected three-player one-stock match produces the saved canonical payload:
Donkey Kong wins at frame 27, stocks `[1, 0, 0]`, on Lava Stage. The fixture
places both opponents beyond a real blast boundary; normal stock, GAME hold
and results logic produce the payload. The report retains the exact match
configuration and production identity. Saved custom controls are present,
the player profile chip cycles, and the 390 px phone layout has no horizontal
overflow. Screenshots remain alongside the report.

`final-dk-mechanics/observations.json` passes all 67 consumer/mechanics checks
on this bundle. Its explicit pending anatomical receiving/protection
qualification is retained. The 47-scenario Link diagnostic also retains its
three contact-expectation mismatches described above; neither report claims
unperformed source-fidelity or human acceptance.

Production build output is preserved in `production-build.txt`; the final
full-suite output is preserved in `final-tests.txt`. No further source or
build edits followed these acceptance gates.
