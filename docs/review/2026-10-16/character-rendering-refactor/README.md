# Character rendering foundation

2026-10-16. Implementation of the [rendering refactor plan](../../../CHARACTER-RENDERING-REFACTOR-PLAN.md),
launched by the user's continuation. Implementation and qualification are complete.
The [qualification summary](qualification.json) binds the passing reports to the
verified source/build hashes and records 2,247 baseline-matched ticks plus 450
mixed-match authoritative frames.

## Interfaces and ownership

- `src/characterPresentation/contracts.ts` defines actor/profile identity,
  action instance and phase, explicit source clock domain, transforms, attachment
  coordinates, equipment, palette, visibility, world/screen pass and restoration.
- `registry.ts` validates capabilities and immutable profile revisions, rejects
  missing/ambiguous routes and resolves explicit per-layer action/phase routes.
  A declared wildcard is the only core fallback.
- `legacy/bridge.ts` translates one simulation snapshot into a portable request.
  Private weak associations retain the old snapshot for the legacy adapter.
  The bridge publishes simulation-owned source roots and item grips; it does
  not sample display geometry to drive gameplay.
- `legacy/poseProvider.ts` pins installed gameplay metadata independently of
  appearance registration. Capture selection, roots, receiving geometry,
  attack/catch contact, head contact, held sockets and Final poses keep their
  original sampling algorithms. The old socket and Final module entrypoints
  remain compatibility exports.
- `port/src/fighters/appearance.ts` owns instances, selected profiles, route
  updates, readiness, reset/disposal and preview dispatch. The legacy backend
  owns sprite selectors, placement, layers and sprite-specific diagnostics.
- `port/src/engine/presentation/` hosts real managed geometry and composite
  previews. Geometry and sprite meshes share stable depth/submission order;
  instance disposal releases owned geometry/materials, not shared textures.
- Resource providers are registered alongside capabilities. The match owns a
  cancellable preparation lease combining resource availability, backend and
  shader readiness. Shared items remain available for geometry-only profiles.
  Existing six-worker decoding, 64 MiB startup warming and cache retention stay
  in the legacy provider; that allowance is not a resident-memory limit.
- Match, lineups, stages/results, menu cards, viewer and costumes now use the
  appearance service. Card cache identity includes profile revision and route
  capability. Single legacy cards retain their previous native-resolution
  snapshot path; composite previews use the common host.

Portable import checks run in `npm run typecheck`. The headless MatchSim graph
rejects renderer, browser host and visual-registry dependencies. The facade's
state inputs are plain values; no backend receives a Character instance.

## Baseline

The dirty workspace was retained. `before-identity.json` hashes 1,274 source
files and 785 installed character assets; `before-workspace.txt` records the
pre-existing changes. A separate source copy at `.tmp/rendering-baseline` was
built and served on port 4186 so ongoing implementation could not change the
reference. The baseline game bundle is `game-Bn_dJ2Cd.js`.

`before-browser/report.json` records 360 simulation ticks for each of DK,
Pikachu and Link, their submitted appearances and gameplay digests, repeated
draw stability, actual saved-key jump input, character cards and viewer/costume
pages on disposable Windows Edge. These are regression scenarios, not a fresh
source-fidelity audit. Early probe corrections supplied the required `moveX`
input field, settled the actor before the separate DOM jump check, and selected
the card's `.art` child rather than its button background; no game behavior was
changed to satisfy those fixtures.

`before-memory.json` retains the existing measured PNG-header payload baseline:
681.95 MiB DK, 194.65 MiB Pikachu, 275.41 MiB Link. These are RGBA8 page estimates,
not physical RAM/VRAM measurements. This refactor does not reduce those banks.

## Integrated qualification

The qualified static build has game bundle `game-CDiv0wP3.js` (SHA-256
`203a5bc93ebe1fba3ec10080fd1a8d8e06ca4431f598cc836995532876926977`) and source identity
`platform-fighter-sha256-8801bf0c4941c9a7c639cf2e69652ebf398af18acdabbc36bd02a82cb722b757`.
`after-identity.json` records 1,300 source-file hashes, the build bundles, and the
49 source files added or changed since the preserved baseline. All 785 installed
character asset hashes are unchanged. `before-memory.json` and `after-memory.json`
are byte-for-byte equal.

| Check | Result and evidence |
| --- | --- |
| Combined unit/integration suite | 565 files, 12,110 tests passed; [log](full-tests.log) |
| Final repository export | After all source changes, 566 files / 12,115 tests and the default standalone build pass using only packaged source/assets/fixtures; [checkpoint verification](../repository-checkpoint/verification.json) |
| Focused rendering/gameplay suite | 23 files, 205 tests passed; [log](focused-tests.log) |
| Later attachment/lifecycle fixes | 17 focused tests and 7 host lifecycle tests passed after the full run; [attachment log](final-attachment-tests.log), [host log](final-host-tests.log) |
| Static build | Type checks, port layer rules, portable-core import rules, Vite build and 723 runtime asset copies passed; [log](build.log) |
| Ordinary match regression | [Candidate report](after-browser/report.json) matches all 1,080 baseline ticks across DK, Pikachu and Link, including selected/submitted appearance fields, simulation hashes, positions, damage and receiving geometry; repeated draws are inert and each fighter passes a real saved-key DOM jump |
| Ordinary resource comparison | [Comparison](resource-comparison.json) finds identical resident page metadata, decoded payload totals, renderer geometry/texture counts and empty pending queues at the end of each fighter trace |
| Final/item/capture regression | [Candidate report](after-interactions/report.json) matches 965 authority ticks and 30 sampled appearances: each fighter's Final owner/victim sequence through release, Link raygun pickup and moving layered shooting, grab/pummel/forward throw |
| Stage/results lineups | [Candidate report](after-menus/report.json) matches 10 lineup samples and 30 fighter draws: all three fighters on flat/lava stage selectors, Link victory entry/wait and loss on actual results screens; no faults or page errors |
| KO flights and first-use work | [Candidate report](after-ko/report.json) matches 202 ticks and 600 submitted flight appearances across two Inferno KO sequences with all three fighters, including flight expiry; WebGL API deltas and resident/renderer allocations match the baseline |
| Computed/mixed host | [Fixture report](geometry-browser/report.json) passes stored → computed → mixed → stored routes, both facings, common ordering, world/screen transitions, freeze/restore, 20 creation/disposal cycles, unchanged shared textures, and stored/computed/mixed previews |
| Computed/mixed real match | [Match fixture report](mixed-match-browser/report.json) matches 450 simulation hashes and authoritative frames with Link switching routes and Pikachu retaining the legacy backend; both facings, pause, restore and disposal pass |
| Shader preparation on hardware | [Report](shader-lifecycle/report.json): all four cases pass—real completion gates loading, pending preparation cancels on exit, injected link failure recovers on restart, real context loss cancels pending preparation and recovers |
| Match recovery | [Report](recovery-browser/report.json): all eight cases pass, covering load failure/retry, controller reconnect, manual pause, frame failure/restart, real context loss/restore and cleanup failure with working navigation |

The final build used Node 20.20.2 and `PF_PRESENTATION_FIXTURE=1` to include the
two qualification pages alongside the normal game. The default build excludes
those pages; neither fixture is registered by the production game. Compiler,
test, build and browser jobs ran under `.tmp/dk-heavy.lock`. The full suite ran
before the final small host lifecycle fixes; the affected focused suites and the
production build/browser checks ran after them.
The subsequent repository-export check reran the complete final suite and the
default build after all fixes; its record above also verifies fixture-page exclusion.

Rendering, interaction, geometry and mixed-match checks used disposable Windows
Edge 155.0.4283.45 on Intel Iris Xe / ANGLE Direct3D11. The shader lifecycle run
used native `KHR_parallel_shader_compile`; its report records the exact wrappers
used to hold completion or inject one link failure. Those are lifecycle checks,
not performance measurements. The separate recovery harness used software
rendering. Expected injected failures and optional favicon requests are recorded
separately from unexpected errors.

The KO check also used hardware Edge. Both builds made zero shader compilation
or link calls during the cold KO sequence, with the same three first-use texture
allocations/uploads. The warm repeat made no shader or texture calls. Resident
page metadata and renderer allocation counts stayed identical across the two
runs. These counters cover the measured KO sequences; they count WebGL API
invocations, not driver time, physical memory or JavaScript heap collection.

The mixed match covered 285 stored, 131 computed and 34 mixed frames. Maximum
source-root error was zero; maximum attachment error was approximately
`1.005e-14` world units. Its `contactFrames` field counts frames with compared
debug contact geometry, not 450 successful strikes. Screenshots of computed and
mixed frames, Final capture, layered shooting, menu cards, stage/results lineups
and KO flight were inspected.

Browser traces are controlled regression scenarios, not a complete new fighter
audit: the Final cases cover grounded/right-facing activation with a hit, and
the item case covers raygun rather than every item. No source-fidelity or new-art
acceptance claim follows from matching the preserved build.

The stage/results harness controls display time through an injected RAF clock
so load timing cannot select different animation frames. The preserved host
reports selected draw fields; the candidate reports the corresponding submitted
quads. The harness compares their common fields and retains screenshots of both.
Four settled screenshots are pixel-identical in the unfiltered
[pixel comparison](after-menus/pixel-comparison.json). Native CSS transitions
and some stage pixels differ in other captures; no claim of universal pixel
identity is made. A duplicated strip in one original baseline screenshot was
resolved in the separately retained [recapture](before-menus-recapture/report.json).

## Reproduction

Use the preserved baseline on port 4186 and the candidate on port 4173, both with
the `/platform-fighter/` base. The browser tools accept explicit `--url`, `--out`
and (where applicable) `--compare` paths. Run each heavy command under the shared
lock; do not run competing browser sessions or replace the candidate build while
qualifying it.

```sh
flock .tmp/dk-heavy.lock npm test
flock .tmp/dk-heavy.lock env PF_PRESENTATION_FIXTURE=1 npm run build:static
flock .tmp/dk-heavy.lock node tools/character-rendering-acceptance.mjs --edge \
  --url http://127.0.0.1:4173/platform-fighter/ --out .tmp/rendering-recheck \
  --compare docs/review/2026-10-16/character-rendering-refactor/before-browser/report.json
```

Additional tools are `tools/character-rendering-finals.mjs`,
`tools/character-rendering-menus.mjs`,
`tools/character-rendering-ko.mjs`,
`tools/character-appearance-fixture.mjs`, `tools/character-appearance-match.mjs`,
`tools/match-freeze-acceptance.mjs` and
`tools/match-shader-preparation-acceptance.mjs`. The shader harness requires the
owned Edge CDP endpoint plus the expected bundle and build identity; its
[bridge record](shader-lifecycle/bridge.json) and
[cleanup record](shader-lifecycle/cleanup.json) identify the disposable session.

## Residual dependencies

This is rendering extensibility with existing gameplay pose data preserved.
The facade still reads installed `frames.json` drawing schedules, source sample
indices, capture calibration identifiers, root deltas, posed receiving and
outgoing geometry, item socket rows and per-native-frame axes. Final rendering
addresses coexist with paired Final geometry in the compatibility data module.
Pikachu's existing specialized protection/movement/receiving readers remain
inside gameplay. None of those tracks becomes portable merely by wrapping it.

Later package work must separate logical motion/geometry tracks from physical
drawings before changing drawing density, anatomy or source motion. New rigs,
AI authoring, compression, bank budgets and earlier unverified gameplay issues
are outside this milestone. The computed geometry is qualification material,
not accepted roster art; its pages are built only with
`PF_PRESENTATION_FIXTURE=1` and are absent from production registrations.
