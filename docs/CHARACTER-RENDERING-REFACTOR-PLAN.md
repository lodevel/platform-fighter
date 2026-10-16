# Character rendering refactor implementation plan

2026-10-16. First implementation milestone of the
[Character System Overhaul](CHARACTER-SYSTEM-ROADMAP.md). Prepare the existing
code for interchangeable and mixed character rendering before developing the
new character lab or producing new art.

Status: **implemented and qualified**, launched by the user's continuation on
2026-10-16. The [implementation record](review/2026-10-16/character-rendering-refactor/README.md)
records the integrated interfaces, preserved baseline, runtime comparisons and
remaining drawing-linked gameplay dependencies. Continue the broader roadmap at
visual requirements and the independent lab; memory reduction remains later work.

## Result required from the first refactor

The current three fighters keep their existing drawings, motion, gameplay and
presentation. Match rendering, menus and previews request character appearances
through one interface. The existing sprite path becomes its first production
implementation. A small test-only computed-geometry implementation proves that
the interface supports something other than a sprite image, including mixed
layers and transitions.

The engine selects a registered visual capability; a character's presentation
profile selects routes per action, phase or layer. Improving content using an
already supported capability must require profile/package changes rather than
new fighter-specific branches in shared rendering code. Future 2D rig or 3D
implementations can register through that boundary. They still require their
own implementation and qualification; this milestone does not build them.

Full portable character packages, AI generation, reuse extraction, resolution
changes, frame thinning, compression and roster migration remain later work.
The memory baseline is retained for comparison, not reduced by this refactor.
Keep provisional memory targets out of admission rules for existing banks.

## Existing boundaries and integration sites

| Area | Existing files | Required treatment |
| --- | --- | --- |
| Simulation output | [view.ts](../src/sim/view.ts), [buildSimView.ts](../src/sim/buildSimView.ts), [MatchSim.ts](../src/sim/MatchSim.ts) | Keep game authority; capture each tick once and translate at the game bridge |
| Pose selection | [simulationSpriteAnimation.ts](../src/characters/simulationSpriteAnimation.ts), [artFrameSelector.ts](../src/characters/artFrameSelector.ts) | Preserve headless simulation evaluation; wrap display selection and clocks in the legacy visual adapter |
| Fighter sprite placement | [poses.ts](../port/src/fighters/poses.ts) | Wrap current roots, pivots, layered shooting, facing and knockout-flight placement |
| Live match presentation | [matchView.ts](../port/src/match/matchView.ts) | Use appearance instances; retain cameras, effects, events, sound and diagnostics |
| Render host | [presenter.ts](../port/src/arena/presenter.ts), [spriteLayer.ts](../port/src/engine/sprites/spriteLayer.ts) | Admit sprite submissions and managed geometry with explicit pass/order rules |
| Preparation and ownership | [preloadMatchArt.ts](../port/src/match/preloadMatchArt.ts), [textureStore.ts](../port/src/engine/sprites/textureStore.ts), [match screen](../port/src/ui/screens/match.ts) | Put preparation/cancellation/lifetime behind an interface while preserving current policy |
| Menu images | [fighterArt.ts](../port/src/ui/assets/fighterArt.ts), [spriteSnapshot.ts](../port/src/engine/sprites/spriteSnapshot.ts) | Request a character preview; keep sprite-specific snapshotting inside the legacy implementation |
| Other character displays | [lineup.ts](../port/src/fighters/lineup.ts), [gazeDemo.ts](../port/src/fighters/gazeDemo.ts), [viewer](../port/src/entries/viewer.ts), [costumes](../port/src/entries/costumes.ts), [backdrop contract](../port/src/ui/shell/app.ts) | Route character appearances through the same service, including stages/results consumers |
| Gameplay tied to pose metadata | [Character.ts](../src/characters/Character.ts), [heldItemSocket.ts](../src/characters/heldItemSocket.ts), [finalBodyPose.ts](../src/finalSmash/finalBodyPose.ts) | Introduce the authoritative pose-provider facade below; preserve existing calculations and metadata internally |

Use a separate visual registry. The existing gameplay fighter registry and
factory determine behavior and must not start selecting different gameplay
classes because a visual backend changes.

## Proposed ownership of new code

These paths establish a concrete starting structure; combine small files when
that improves clarity without weakening the boundaries.

| Proposed location | Owns |
| --- | --- |
| `src/characterPresentation/contracts.ts` | Renderer-neutral identity, revision, action/phase/time, coordinate, attachment and visual-capability contracts |
| `src/characterPresentation/registry.ts` | Validated presentation-profile and capability registration, with deterministic route lookup |
| `src/characterPresentation/legacy/` | Game bridge and legacy selection/clock compatibility; this explicit boundary may import current fighter metadata |
| `src/characterPresentation/legacy/poseProvider.ts` | Authoritative pose facade: semantic state/time in, roots, geometry and attachment data out; independent of visual backend selection |
| `port/src/fighters/appearance.ts` | Character-appearance orchestration for match, lineup and preview consumers |
| `port/src/fighters/backends/` | Legacy sprite implementation and backend-specific visual evaluation |
| `port/src/engine/presentation/` | Three.js host facilities for managed geometry, sprite submission, passes and resource handles |
| Beside the modules above | Contract, compatibility, lifecycle and computed-geometry fixture tests |

Keep Three.js objects in renderer adapters. The portable contracts/registry may
not import the game roster, fighter classes, global asset manifest, DOM, Three.js
or generation tools. The legacy bridge is an explicitly allowed compatibility
layer, not an excuse to let those imports spread into the portable core.

Do not create a framework for arbitrary future graphics APIs. Support the current
Three.js host with a neutral request contract and narrow, testable backend hooks.

## Contract and lifecycle requirements

Before moving consumers, specify these together and map every currently used
field. Preserve source clock conventions rather than converting everything into
an ambiguous animation frame number.

- A request identifies the actor instance, character/profile revision, logical
  action instance, phase, age/clock domain, facing, body/root transform,
  equipment/context, palette and visibility. Include freeze/hitlag and restore
  semantics needed by current poses. Legacy-only fields stay inside the bridge;
  do not rename `SimulationAnimationSnapshot` and call it a portable contract.
- A profile declares supported routes and resource requirements. A sprite route
  may resolve to physical sheet/frame coordinates privately. A computed route
  may manage scene geometry directly; the common result must not require
  `SpriteDraw[]`, a texture, an image or a baked bitmap.
- Backend lifecycle covers create/prepare, update at an authoritative tick,
  submission, reset/restore as needed, diagnostics and idempotent disposal.
  Use cancellation and instance/revision identity so stale preparation cannot
  attach resources to a replacement match or preview.
- Preparation distinguishes decoded/available resources, shader readiness and
  GPU warming. Preserve the current 64 MiB startup warming allowance; it is
  not a resident-memory limit. Do not pre-upload today's complete banks.
- Track instance-owned nodes/materials separately from shared texture resources.
  Destroying one instance must not destroy another instance's assets. Preserve
  current menu/match cache and eviction behavior in this compatibility milestone;
  the existing delayed match-bank release remains separate optimization work.
- Preview requests use the same route/profile contract. Backend-specific drawing
  and snapshots live behind the preview service. Include profile revision and
  visual capability in cache identity so a changed implementation cannot return
  a stale character card.
- Unsupported capabilities fail during preparation. Any fallback must be
  explicitly declared and tested; missing routes must not silently become idle
  poses or trigger runtime AI generation.

Define stage/world/screen pass ownership, clipping, transparency and depth
ordering. Existing fighter sprites share a queue with items and effects; moving
all future geometry into an unconditional extra overlay would change occlusion.
Keep legacy submission ordering identical and prove mesh/sprite interleaving
with the fixture. Each supported mixed composition needs compatible roots,
scale, palette/shading and attachment coordinates.

## Scope of pose and gameplay decoupling

Visual routing must never select authoritative collision or movement. The
legacy game bridge continues to evaluate current pose metadata for roots,
hurtboxes, contacts, protection and equipment/release sockets. New appearance
implementations consume the resulting semantic state and attachment contract;
they do not call `Character` or reinterpret sprite indices to drive gameplay.

For this milestone, current metadata can remain behind that bridge and inside
the existing game implementation. Preserve its algorithms and sample schedule.
The authoritative pose-provider facade is a required deliverable: it accepts
semantic action/state/time and exposes gameplay roots, geometry and sockets,
never a renderer-selected frame as input. Its legacy implementation may resolve
old frame indices internally. Route the affected gameplay readers through this
facade with targeted changes; avoid a simultaneous rewrite of `Character.ts` or
the Final system. Keep dependencies acyclic: callers provide plain state rather
than passing a `Character` instance into the provider.

Pin the legacy gameplay pose profile independently of the visual profile. A
test must switch visual routes and drawing schedules while checking identical
authoritative results for the same state/time, including headless execution.
Rendering may consume anchors, but neither a visual backend nor its preparation
or display clock may drive the simulation's pose selection.

Completion therefore means **rendering extensibility with legacy gameplay pose
data preserved**. It does not mean that changing source motion, drawing-linked
geometry or anatomy is already safe through package edits. Before such content
migrations, the later package work must detach geometry/root/socket tracks from
physical drawing density and establish stable logical pose/time identities.
Record remaining dependencies explicitly rather than claiming complete character
independence after wrapping `MatchView`.

## Implementation sequence

| Step | Work | Gate before proceeding |
| --- | --- | --- |
| A. Preserve the baseline | Inventory existing changes; record source/build identity, relevant asset hashes, representative views and memory diagnostics | A reproducible pre-change reference exists; unrelated work remains intact |
| B. Define contracts and guards | Add neutral requests, profiles/capabilities, lifecycle interfaces and import checks; enumerate current fields/consumers | Core validates without game/renderer imports; unknown capabilities and invalid routes fail explicitly |
| C. Wrap the legacy path and isolate authority | Wrap display selection/clocks and pose helpers; introduce the independent authoritative pose-provider facade | The same inputs yield identical drawings/transforms and gameplay poses; changing a visual route cannot change roots, collision or sockets |
| D. Connect rendering and consumers | Wire MatchView, render host, menus, previews, lineups and entrypoints to appearance instances | All production fighters still use the legacy backend; no presentation consumer needs its sheet/frame internals |
| E. Prove extensibility | Register test-only computed geometry; mix it with stored artwork, switch at action/phase boundaries and run two capabilities together | Works through the real host without changing MatchView, gameplay classes or unrelated character profiles |
| F. Qualify and document | Run focused/full checks, production browser comparisons and lifecycle scenarios; record residual coupling | Current appearances/gameplay preserved, lifecycle checks pass, assets unchanged and next-package work is explicit |

For Step A, retain the dirty workspace. Do not reset, discard or commit unrelated
changes. Earlier evidence in the
[shader-preparation record](review/2026-10-16/shader-preparation/README.md) and
[memory baseline](review/2026-10-16/character-memory-system/baseline.json) provides
reference points; record a fresh candidate identity during execution instead of
claiming those historical runs validate the new build.

For Step E, a tiny procedural mesh or articulated shape is sufficient. It is a
test fixture, not new roster art or proof of 2D/3D character visual quality.
Verify stored → computed → stored transitions, a mixed composition, both facings,
attachment continuity, pause/hitlag, seek/restore and repeated create/dispose.
The test must exercise real geometry submission, not merely a mock that returns
another sprite. Keep fixture code out of production character registrations.

## Regression and runtime checks

The following commands describe the implementation's validation requirements.
Use the repository's supported Node environment and run from its root. Existing
root [Vite/Vitest configuration](../vite.config.ts) includes both `*.test.ts` and
`port/src/**/*.check.ts`; older comments claiming otherwise are stale.

Serialize compiler, test, build and browser jobs with `.tmp/dk-heavy.lock`.
The focused suite should include the new module tests and these existing routes:

```sh
flock .tmp/dk-heavy.lock npm test -- \
  src/characterPresentation \
  port/src/engine/presentation \
  port/src/fighters/appearance.check.ts \
  port/src/fighters/backends \
  src/assets/packedFrames.test.ts \
  src/characters/artFrameSelector.test.ts \
  src/characters/simulationSpriteAnimation.test.ts \
  src/characters/spriteAnimationDriver.test.ts \
  src/characters/heldItemSocket.test.ts \
  src/characters/upperBodyLayer.test.ts \
  src/sim/importGraph.test.ts \
  src/sim/MatchSim.test.ts \
  src/sim/goldenReplays.test.ts \
  port/src/fighters/poses.check.ts \
  port/src/engine/sprites/spriteLayer.check.ts \
  port/src/engine/sprites/textureStore.check.ts \
  port/src/engine/prepareShaders.check.ts \
  port/src/match/preloadMatchArt.check.ts \
  port/src/match/matchView.check.ts
```

The first four filters target proposed new modules; adjust them if the agreed
file layout changes. Add affected capture, Final, geometry, preview and restore
tests when their adapters change. Once integrated, the shared presentation
change requires the full suite and one fresh standalone build:

```sh
flock .tmp/dk-heavy.lock npm test
flock .tmp/dk-heavy.lock npm run build:static
```

`build:static` includes type/layer checks. Extend the existing
[layer checker](../port/scripts/check-layers.mjs) and/or add a root import-graph
check covering the new boundary; the current port check alone allows all root
game imports. Once the selected checks pass, repeat them only for new changes or
unresolved failures. Do not refresh expected outputs just to hide divergence.

Record new before/after outputs from the
[memory audit](../tools/character-memory-audit.ts); it reports decoded payload
estimates, not measured physical RAM/VRAM. Preserve the existing baseline files.
Start a preview of the fresh build and use the existing
[recovery harness](../tools/match-freeze-acceptance.mjs) and
[shader-preparation harness](../tools/match-shader-preparation-acceptance.mjs)
with explicit `--url` and separate `--out` directories. Shader pending-completion
cases also require `--cdp` pointing to the owned Edge session with actual
`KHR_parallel_shader_compile` support. A software-renderer pass does not qualify
those cases. Keep source/build identity in each new evidence record.

Browser qualification must use the actual new production bundle and the target
Edge setup, with screenshots and submitted-appearance diagnostics:

- Compare all three fighters through ordinary movement, attacks, holds, held
  items, layered shooting, captures, Final owner/victim phases and KO flights.
  Include palette, facing, pivots and relevant camera scales. Use identical
  input traces to check roots, contacts, sockets, events and damage independently.
- Exercise character cards, stages/results lineups, viewer and costumes pages,
  and the computed-geometry fixture's mixed rendering and ordering.
- Check pending preparation cancellation, failed load/retry, match replacement,
  menu navigation, context loss/restoration and disposal. Preserve shader
  preparation before play and current sharing across identical fighters.
- Confirm no new action-time uploads/compiles, missing appearances, duplicate
  submissions, resource growth or retained disposed instances relative to the
  baseline. Existing first-use behavior and unrelated open bugs must remain
  distinguished from new regressions.

Two specific traps need tests. `buildSimView` drains one-shot events: capture once
and distribute that view to comparison consumers, with one owner for sound and
other side effects. The art selector is stateful: preserve its freeze, hitlag,
loop, rewind and action-instance behavior; repeated renders of the same simulation
tick must not advance animation. Checkpoint/restore tests do not require building
a new user-facing replay feature.

## Collaborating agent ownership for execution

The coordinator first agrees the contracts and records the baseline. After
that, delegate distinct files and reconcile changes to shared code serially.

| Owner | Files and responsibility |
| --- | --- |
| Core/legacy agent | New `src/characterPresentation/` contracts, registry, bridge and tests; preserve existing selector behavior |
| Render integration agent | New `port/src/engine/presentation/`, `port/src/fighters/appearance.ts`, backend implementations, `matchView.ts`, `arena/presenter.ts`, existing `spriteLayer.ts`/`textureStore.ts` and their tests |
| UI/resources agent | Menu art/snapshot wrappers, lineups/demos/entrypoints, backdrop contract, `preloadMatchArt.ts`, match-screen lifecycle and their tests |
| Coordinator | Interface integration, import guards/config, any necessary shared simulation/pose-helper changes, browser fixture and final validation/evidence |

`port/src/fighters/poses.ts`, shared simulation modules and asset manifests stay
coordinator-owned. Backend/UI agents use the agreed wrappers instead of editing
them concurrently. The UI/resources agent consumes agreed render-resource
interfaces; changes inside the existing sprite layer/store belong to the render
integration agent. No agent owns art generation or installed asset rewrites in
this milestone. Heavy jobs run one at a time under the shared lock; agents do not
launch competing browsers or overwrite a shared build.

## Completion and handoff

The implementation is complete only when the legacy sprite backend serves all
current character display entrypoints, the computed-geometry fixture passes
through the same public boundary, authoritative pose evaluation is independent
of visual routing, and the compatibility/runtime checks above pass on the
integrated build. Deliver the final interfaces, touched-file summary, evidence,
measured regressions or improvements, and an explicit inventory of remaining
drawing-linked gameplay metadata.

Then resume the broader roadmap at visual requirements and the independent lab.
Keep existing character art, generation workflows and qualified gameplay as the
reference. This milestone makes later improvements possible; it does not claim
to have implemented new character rigs or solved the memory budget.
