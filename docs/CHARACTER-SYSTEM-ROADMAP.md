# Character System Overhaul

2026-10-16. Workstream for a reusable character creation, animation and resource
system. First prepare the current code's rendering interfaces; then develop new
character representations in a standalone lab before deploying them in the game.
The current illustrated characters set the visual quality reference.
Memory efficiency and AI automation must be demonstrated alongside that quality.

The first implementation milestone, the
[character rendering refactor](CHARACTER-RENDERING-REFACTOR-PLAN.md), is complete:
the current sprite implementation uses a common appearance interface, and real
computed/mixed geometry passes through the same host. The
[qualification record](review/2026-10-16/character-rendering-refactor/README.md)
retains baseline comparisons, lifecycle checks and the unchanged asset/memory
baseline. Next is Phase 1: visual requirements and comparison motions before
developing the independent lab.

Agreed direction: the pipeline plans reusable artwork deliberately, and each
character can improve independently through versioned packages. One character
may use full drawings, another reusable 2D parts, and another a mixture. Future
3D support can implement the same presentation contract when its quality is
proven. The first package does not need a perfect decomposition into reusable
parts; later revisions can improve individual actions without replacing the
game engine or migrating the rest of the roster.

The existing code supports a staged migration: simulation and rendering already
have separate entrypoints. Character data still contains dependencies on sprite
sheet names and drawing indices, so replacing the complete character system is
not yet a matter of swapping one module.

## Direction and scope

Build a versioned character package, an evaluator for its poses and tracks,
replaceable visual implementations, and explicit resource ownership. The lab
must work without a running match, the game's roster, its UI or its physics
engine. A game adapter translates the host's action state into the package's
inputs. Keeping these boundaries explicit allows future use outside this game.

Retain illustrated sprites as the baseline. Compare appropriately sized sprites
with selective 2D deformation and hybrid animation. A hybrid may reuse suitable
parts while retaining full drawings for turns, contacts and major silhouette
changes. Live 3D remains an optional later experiment, conditional on matching
the illustrated reference; this roadmap does not select or require it.

Character handling includes identity, appearance, action and pose references,
equipment sockets, authored geometry tracks, asset compilation, previews,
loading and release. The host game continues to own inputs, combat state,
physics, damage and action transitions. Game-specific mechanics stay in an
explicit adapter/profile rather than becoming hidden assumptions in the portable
animation module. Replacing the entire combat engine is outside this workstream.

The [asset and memory proposal](CHARACTER-ASSET-SYSTEM.md) supplies the measured
baseline and budget discussion. Its 64/128 MiB figures remain candidate texture
targets; final per-character, match and peak budgets depend on the lab results.
The [add-character workflow](../.agents/skills/add-character/SKILL.md) remains the
current creation procedure until a replacement path passes the gates below.

## Requirements carried through every phase

| Requirement | Evidence needed |
| --- | --- |
| Preserve the illustrated appearance | Compare accepted art and candidates in motion at actual display size, supported zoom/DPR, both facings and light/dark backgrounds |
| Bound memory | Report compressed files, decoded sources, GPU payload and transient peaks separately; include shared assets and simultaneous unique characters |
| Budget drawings per action | Record distinct drawings, holds, protected samples, pixel area and packed bytes; preserve contacts, releases and readable movement |
| Plan reuse before generation | Identify shared drawings/components, view variants, transforms, joins and required replacement poses; measure unique resources separately from references |
| Automate creation | A scripted job can generate/import, validate, compile and preview a package, with resumable stages and visible review checkpoints |
| Keep gameplay consistent | Preserve authoritative timing, roots, geometry, sockets, protection and event ordering through representation changes |
| Make replacement possible | Core package/evaluation code imports no game, renderer, DOM or generation-provider implementation |
| Evolve characters independently | Replace one action's visual route through package changes using supported capabilities, with no shared-engine edits or changes to other fighters |
| Support complete characters | Account for equipment, captures, victim states, layered actions, special phases, menus, entry, respawn and results |

AI generates or assists with source assets offline. Gameplay does not depend on
model inference. Generation can be variable; compilation from accepted source
art and metadata must be reproducible. Human visual acceptance stays explicit,
and manual correction time is part of the automation assessment.

## What is modular today

The current presentation path is:

```text
MatchSim → SimView → MatchView → art selection and fighter poses
         → SpriteDraw → SpriteLayer and TextureStore
```

| Boundary | Current evidence | Consequence for migration |
| --- | --- | --- |
| Simulation to presentation | [MatchSim](../src/sim/MatchSim.ts) exposes a plain [SimView](../src/sim/view.ts); [MatchView](../port/src/match/matchView.ts) consumes it | A new appearance path can reuse the existing simulation |
| Draw commands to graphics | [Fighter poses](../port/src/fighters/poses.ts), [SpriteLayer](../port/src/engine/sprites/spriteLayer.ts) and [TextureStore](../port/src/engine/sprites/textureStore.ts) handle sprite submission and resources | Packing, texture formats and draw implementation have identifiable replacement points |
| Character construction | [Fighter registry](../src/characters/fighterRegistry.ts) and [factory](../src/characters/characterFactory.ts) centralize construction | A useful host adapter exists, but it imports concrete fighter classes |
| Authoring and identity | [Roster](../src/characters/roster.ts), [authorable registry](../src/characters/authorableCharacterRegistry.ts), [serializer](../src/characters/characterSerializer.ts) and [asset manifest](../src/assets/manifest.ts) remain separate | A saved character tune is not a complete portable appearance/motion package |
| Pose and gameplay geometry | [Character](../src/characters/Character.ts), [held-item sockets](../src/characters/heldItemSocket.ts) and [Final body poses](../src/finalSmash/finalBodyPose.ts) use drawing indices and sprite metadata | Decouple semantic pose/time from physical art selection before changing representation |
| Dependency enforcement | [Port layer checks](../port/scripts/check-layers.mjs) constrain `port/src`; the [simulation import test](../src/sim/importGraph.test.ts) excludes Phaser and host scene imports | Extend checks to the new module boundary; existing checks do not establish full character independence |

The important distinction is between renderer independence and representation
independence. Simulation can run without displaying textures, but some gameplay
geometry still uses sprite-oriented identifiers. A future renderer must consume
the same authoritative pose contract instead of becoming a second source of
combat timing or collision truth.

## Target module boundaries

| Module | Responsibility | Boundary |
| --- | --- | --- |
| Character package | Versioned identity, action/pose/component IDs, coordinate and clock conventions, motion/geometry tracks, visual routes, dependencies and provenance | Portable data; no imports of a game's fighter classes or global asset registry |
| Pose evaluator | Sample logical pose, root, sockets and authored geometry at an explicit action/phase age | Pure evaluation, or explicitly serializable state where required; no texture loading |
| Appearance implementation | Map the logical pose to full drawings, reusable layers, deformed meshes or future model rendering | Physical atlas indices and renderer objects stay here; the shared request does not require a bitmap result |
| Resource service | Resolve resources, share them by identity, prepare them, track bytes and release ownership | Renderer/context-specific storage behind an interface |
| Asset compiler | Build runtime packages, portraits, pages, mappings and validation reports | Consumes accepted masters; preserves logical identities when packing changes |
| Generation adapters | Submit and resume AI/import jobs; retain recipes, outputs and failures | Provider-specific code stays outside the compiler and runtime |
| Standalone lab | Preview, compare, inspect timelines/sockets/geometry and measure resources | Loads packages directly, without importing game simulation |
| Game adapter | Map game actions/clocks/equipment/context into evaluation and consume geometry using the game's rules | The only integration layer that knows the existing fighter IDs and mechanics |

The core contract names an action instance, phase, authoritative age, facing,
appearance revision, equipment and contextual variants. Different clock domains
must be explicit, including hitlag, charge holds, native motion samples and paired
actions. Define units, coordinate origin, scale, mirroring and sample numbering.
An exported drawing's position on an atlas must never identify gameplay geometry.

Game-authoritative tracks and visual tracks can share logical pose/time keys
without sharing their sampling density. The game evaluates root movement,
collision and release sockets during simulation; the renderer consumes the
corresponding visual pose. Rendering interpolation must not move a hitbox or
change a release time. Changes to anatomy or reach require a separate gameplay
adaptation record rather than being hidden inside a visual conversion.

Each package declares required capabilities and dependencies. Unsupported
actions, equipment or variants fail validation visibly. A package cannot declare
itself complete by substituting idle art for a missing move. Game-specific
extensions are versioned and validated by the host adapter.

A full appearance/motion package includes or declares every dependency needed
to evaluate and display it. It is distinct from a tuning override that inherits
a compiled fighter's defaults. A package referencing host mechanics can preview
in the independent lab, but playable behavior is qualified through that host's
adapter during integration.

## Reuse as an authoring decision

Add a reuse plan between the action inventory and generation. For each motion,
identify full drawings that can be referenced again, components that can be
repositioned/deformed, and regions that need distinct artwork. Record the
supported views, pivots, overlap/order, join coverage and corrective drawings.
A composition can use a shared base with changed parts or patches when those
regions actually remain compatible.

Give approved components stable IDs and immutable revisions. AI jobs reference
those components and request the missing artwork or view variants. Assembly and
animation use the accepted component pixels wherever reuse is declared; a
similar-looking regeneration is not counted as shared storage. Preserve full
drawings where decomposition would damage shading, contours or motion.

The compiler resolves component references and deduplicates compatible physical
resources by content and representation settings. Reports count each stored
resource once per actual allocation, including gutters and page padding, and
show which actions keep it resident. Shared resources across packages have
pinned dependencies and lifetime ownership; editing one component must not
silently change every character that references an earlier version.

Reusability is progressive. A first version can use a full drawing for an action;
a later version can replace only that action with a composition or computed
pose. Each version still needs complete declared routes, acceptable visuals and
its qualified budget. Reuse ratios are measurements, not acceptance targets
that justify forcing unsuitable body parts into a common template.

## Mixing stored drawings and computed poses

Use one logical presentation request containing the package revision, action,
phase, time, facing and equipment. The package maps that request to a stored
drawing, a pose computed from prepared 2D parts/meshes, or a composition of both.
Selection can vary by action, phase or layer within the same character. These
are explicit authored routes, not an attempt to generate missing art on demand.

Dispatch by declared, versioned rendering capability rather than by fighter
identity. Implementing a new backend, such as future 3D model rendering, requires
one shared integration and qualification. Once supported, changing a character's
art, reuse plan or visual routes should be package/compiler work. New gameplay
mechanics or unsupported rendering features remain explicit engine/adapter work.

For example, a candidate could compute a modest idle motion, display dedicated
drawings through a punch, then return to computed recovery. Another could draw
the body from an atlas while computing an accessory's transform. These examples
describe capabilities to test, not accepted replacements for current actions.

Both paths use resident resources. A stored drawing selects texture coordinates;
a computed pose changes transforms or vertices of reusable artwork. The
appearance interface must support both draw types rather than require every
result to become a new cached bitmap. Any optional rendered-pose cache has an
explicit byte allowance; storing every computed frame would recreate the
sprite-bank problem. AI image generation belongs to offline authoring, not to
the match's frame deadline.

Current Three.js scenes already combine sprites and geometry, and
[fighter drawing](../port/src/fighters/poses.ts) can compose upper/lower sprite
layers. The fighter interface still emits `SpriteDraw` records addressed by
texture key/frame; it has no generic skeletal-pose route today. Adding the
provider/appearance boundary is roadmap work, not an existing automatic switch.

Smooth switching requires the same root, world scale, facing, palette/shading
conventions, depth order, sockets and authoritative clock on both sides. Define
matching boundary poses and inspect silhouette continuity in motion. Crossfading
is optional and cannot substitute for compatible poses or alter contact timing.
Prepare every immediately reachable route's resources before play, budget their
combined residency and evaluate compute/draw cost within the frame budget.

The lab must exercise stored → computed → stored transitions inside one action,
mixed layers, interruption at each boundary, hitlag, facing changes and seeking.
Acceptance requires no visible pose/attachment jump, missing draw, load/upload
stall or changed gameplay track. This extends the representation comparison in
Phase 3 and the real-match checks in Phase 6.

## Milestones and completion gates

The rendering foundation is the first implementation milestone. Phases 1–7
follow it; no calendar estimate assumes a successful art experiment.

| Phase | Deliverable | Completion gate |
| --- | --- | --- |
| Foundation. Prepare rendering interfaces | Common appearance contract, legacy sprite adapter, independent authoritative pose interface, all display entrypoints and a computed-geometry test fixture | Current art/gameplay preserved; alternative and mixed output works behind the interface; see the [execution plan](CHARACTER-RENDERING-REFACTOR-PLAN.md) |
| 1. Define the quality and cost envelope | Representative reference motions, display/zoom requirements, hardware profile and metrics | Agreed comparison set and measurable quality, memory and automation criteria |
| 2. Establish the portable contract and lab | Package schema, validator, legacy sprite importer, evaluator and minimal standalone viewer | A package previews without game imports; logical timing and geometry survive import/export; dependency checks enforce the boundary |
| 3. Compare visual representations | Matched experiments with resized sprites, deliberate pose schedules and selective 2D/hybrid animation | At least one candidate meets the visual bar and demonstrates a plausible complete-character memory total |
| 4. Automate the chosen creation path | Reuse-aware generation/import jobs, deterministic compiler and review artifacts | A clean run reproduces compiled output from accepted components; failed stages resume without overwriting accepted art; reports reconcile shared references with actual allocations |
| 5. Qualify a complete package | One complete fighter plus a contrasting body-type sample in the lab | Full action/dependency coverage, supported variants and repeated resource lifecycle checks pass within the chosen budget |
| 6. Integrate through a game adapter | Legacy and candidate paths selectable per character/package | Gameplay parity, actual match visuals, saves and resource lifecycle pass; the legacy path remains available for rollback |
| 7. Migrate incrementally | Additional fighters, action-level improvements and documented package compatibility | Change one action's representation using an already supported backend through package edits alone; other fighters remain compatible; no roster-wide switch or legacy removal precedes equivalent coverage |

### Phase 1 reference selection

Include idle/run, a quick attack, a broad or multi-hit attack, a turn or spin,
recovery movement, a throw/capture, held-item motion and a costly Final phase.
Use an armed and an unarmed body type before generalizing the pipeline. At least
one difficult motion must appear early; a convincing idle is insufficient.

Measure visible body size on the actual drawing buffer. Atlas dimensions cover
many drawings and cannot establish whether individual poses are oversized.
Record per-action counts and pixel costs alongside frame time, load/upload time,
resident/peak memory, generation time and manual corrections. A smaller package
that needs extensive manual repair does not satisfy the automation requirement.

### Phases 2 and 3 independent experimentation

Start with a minimal character lab, using fixtures exported from accepted art
and metadata. The importer understands current formats; the portable evaluator
does not. The lab needs playback, stepping/seeking, facing, freeze/hold scenarios,
equipment, overlay comparison and memory diagnostics. It is a separate host,
not a new screen coupled to the current character editor.

Compare candidates against identical poses, timings and camera conditions.
Judge outlines, shading, silhouette, foot contact, weapon grips, occlusion and
motion readability. Deforming existing illustrations can distort baked detail;
allow full replacement drawings where required and count their real cost.
Record unsuccessful candidates as such. If none meets quality and memory
together, revisit the technique or envelope before producing a whole roster.

The lab can live in this repository as isolated packages and an application;
it does not need a second repository to be independent. Its own entrypoint and
dependency checks must allow it to build and run without launching the game.
Concrete package paths and runtime libraries are chosen during implementation.

### Phases 4 and 5 automated production

Use one pipeline: action inventory → reuse plan → generation/import recipes →
accepted components and full drawings → pose/socket/geometry metadata →
compilation → package validation → lab comparison. Keep stable action, pose and
component IDs throughout. Record provider,
model/workflow revision, seed where supported, inputs, hashes and review status.
Rebuilding from accepted masters must not require regenerating them.

Choose the visual backend only after Phase 3. Full sprites remain a valid result
if they meet the constraints. A 2D rig/hybrid needs explicit supported anatomy,
views, attachments and correction drawings; automated rigging is not assumed to
work for every body type. Generation and compilation expose bounded jobs, retry
and cancellation, with expensive work serialized using `.tmp/dk-heavy.lock`.

Qualify the full package's action inventory before advertising per-character
savings. Include load preparation, same-character sharing, multiple distinct
packages, portraits, cancellation, unloading and graphics-context recovery.
Separate known byte estimates from measured process/GPU usage. A compressed
format is accepted only with an explicit supported-device/fallback policy.

### Phase 6 game integration

Build on the foundation's legacy adapter and common display entrypoints.
Extract the remaining geometry/root/socket tracks from physical sheet selection
while keeping the existing semantic clocks and sampling behavior. Then allow
the candidate appearance implementation and portable package to consume that
contract. Preserve the foundation's compatibility checks during this migration.

Extend import checks across the portable package, evaluator, render adapters,
generation adapters and game bridge. Do not rely on the port's current downward
layer check, which permits imports from the root game modules.

Compare legacy and adapted results using the same recorded inputs and initial
state: action transitions, roots, hitboxes/hurtboxes, protection, captures,
equipment sockets, releases and damage. Include pause, hitlag, loops,
interruptions, respawns and checkpoint restoration. These are regression
fixtures; adding a user-facing replay player is not a prerequisite.

Two current details affect comparison design:

- [Building SimView](../src/sim/buildSimView.ts) drains one-shot events. Capture
  once per simulation tick and give the same snapshot to both visual paths.
- [The current art selector](../src/characters/artFrameSelector.ts) maintains
  elapsed state. Preserve its behavior in the legacy adapter; arbitrary seeking
  needs explicit canonical ages or restored evaluator state, not an assumption
  that a snapshot is already sufficient.

Validate the candidate in a real match, including a legacy/candidate mixture.
Check ordinary play and demanding moves, both facings, equipment, paired
interactions, menus, match transitions, context loss and resource release.
Account for the resource union when both implementations are present. Keep
package/schema revisions in saves and checkpoints, with explicit migration or
rejection for incompatible data. Switching back must recover the legacy
appearance and its compatible metadata together.

Pin the package revision for the duration of a match. Introduce accepted updates
at a defined loading boundary, preserving the previous compatible revision for
rollback. Verify a match containing different characters using different visual
backends and one character mixing routes within its actions. The same logical
action/pose and attachment contracts apply to every supported representation.

## Work status and resumption

| Item | Status on 2026-10-16 |
| --- | --- |
| Installed sprite memory audit | Complete for current DK, Pikachu and Link; [baseline](review/2026-10-16/character-memory-system/baseline.json) and [read-only tool](../tools/character-memory-audit.ts) |
| Current code boundary assessment | Recorded above; supports staged replacement with remaining pose/geometry coupling |
| Independent roadmap | Defined here |
| First rendering refactor | Implemented and qualified; [interfaces, runtime evidence and residual dependencies](review/2026-10-16/character-rendering-refactor/README.md) |
| Phase 1 texel density and compression | Probe recorded; [evidence](review/2026-10-16/texture-compression-probe/README.md). Art is already at the density the 1.4 match zoom needs on a 1920 buffer, so downscaling and residency changes (on-demand Final, lazy loading) were rejected as the memory answer. UASTC→BC7 cut sheet memory 4× on Iris Xe with ≤0.03% pixels visibly changed in the default costume and up to 0.74% in recoloured costumes; the user accepted this quality and may expose it as a texture-quality option in a future game-options menu, so the PNG path stays selectable. Full-character load, other devices and in-match acceptance remain open. The per-action resolution/zoom policy is an interim measure until the efficient display system exists |
| Texture quality option | Implemented as an opt-in Options-menu setting (default Full quality); [match evidence](review/2026-10-16/texture-quality-match/README.md). All 664 fighter sheets have compressed banks; in a 3-fighter Edge match fighter textures fall 1,248→313 MiB and Edge private memory 2.8→1.7 GB with equal frame times and identical gameplay. The user chose CI encoding over committing the banks: the Pages deploy builds the pinned encoder and the bank, with caches |
| Phases 1 through 7 | Planned; no portable package, standalone lab, candidate pipeline or game migration implemented by this roadmap |

The rendering foundation is integrated. Resume at Phase 1, which captures the
comparison motions and actual display requirements and sets
provisional acceptance limits. Each milestone retains its evidence, decision and
remaining work beside this roadmap. Current game maintenance can continue
independently while the later character experiments progress.
