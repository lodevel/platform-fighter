# Link visual redesign implementation handoff

Implement a less cartoonish Link using the original Smash Ultimate appearance as the visual direction. Use the **middle `native-blue` column** of the completed pilot as the starting target: blue Champion tunic, original hair, face, clothing and equipment textures, with crisp rendering at game scale. Remove the added green cap, palette flattening, exaggerated ink and cartoon shading. Keep Link's existing motions, mechanics and source coordinate contracts.

The user requested this document so another AI can carry out the change. The pilot establishes feasibility and a timing baseline; production integration and visual acceptance remain to be done. Its approximate lighting should be refined enough for readable faces, limbs and blades at game scale, without rebuilding Ultimate's entire shader system. Do not describe the result as exact native rendering unless that is separately demonstrated.

## Read these records first

Work from `/mnt/c/Workspace/platform-fighter`; the lowercase `/mnt/c/workspace/platform-fighter` path resolves to the same workspace in this session. Revalidate paths in your environment.

- [Character skill](../../../../.agents/skills/add-character/SKILL.md): apply the relevant art, collision, integration and verification steps.
- [Full project handoff](../../2026-10-12/link-character/rework/WORK_HANDOFF.md) and [source handoff](../../2026-10-12/link-character/rework/SOURCE_WORK_HANDOFF.md): retain the broader unfinished Link, DK and Pikachu objective.
- [Pilot README](README.md): appearance, measurements, limitations and reproduction commands.
- [Comparison at game scale](comparison-game-scale.png), [closeups 1](comparison-closeups-1.png), [closeups 2](comparison-closeups-2.png), [closeups 3](comparison-closeups-3.png).
- [Pilot inputs](plan.json), [summary](summary.json), [visual review](coordinator-four-sheet12-pose-scoped-review.json) and [completion receipt](completion-receipt.json).
- [Corpus scope](../../2026-10-12/link-character/rework/runtime/visual-style-rerender-scope-v1.json).

Use specialist agents, with the main agent coordinating and reviewing. Give art an exclusive private output directory; give integration ownership of shared production files. Other AIs are working in this repository. Preserve their changes, historical assets and evidence; do not reset, clean, discard, commit or push unrelated work.

The user requested **one complete verification phase at the end**, rather than tests after each edit. Static inspection, image review, artifact accounting and this requested art benchmark are allowed during implementation. Defer game tests, type checks, builds and browser acceptance until the full implementation is ready. Do not remove the final acceptance requirements to save time.

## Current assets and redesign scope

At this document's checkpoint, `assets/characters/link/frames.json` contains **1,842 drawings, 41 body families and 507 pages**, with SHA256:

```text
4ff62c26be04a9b5e21ae5b558da8ece87fc03e7d559dc761daebc2e0f1a5ce1
```

Read and hash the actual current installation before editing. A different hash can mean another AI has advanced the work; reconcile that change instead of restoring this historical checkpoint.

The [installation receipt](../../2026-10-12/link-character/rework/art/first1842-c17-staged-v1/guarded-install-v1/installation-receipt.json) records the current staged bank and its preserved predecessors. Start the redesign with this installed set, then apply the same qualified style to the remaining Link banks as they are integrated. Do not produce a mixed cartoon/original character across ordinary, held-item, special, Final Smash, entry and results states.

| Selected Link bank | Known pose outputs |
| --- | ---: |
| Ordinary, including the genuine Uair sample 14 supplement | 9,513 |
| HAND contexts | 596 |
| Conditional contexts | 730 |
| Current composed body and equipment tuples | 9,638 |
| Private Link Final body and Bow bank | 234 |
| Known total | **20,711** |

The installed 1,842 are a subset of that total. Superseded banks and corrected gear derivatives must not be counted again. Additional planned Bow, cargo, article, equipment and victim outputs remain incompletely counted. DK/Pikachu bodies and effects are outside this Link appearance change. Track newly completed Link artwork in the same visual style rather than treating 20,711 as a final completion ceiling.

## Reuse the completed pose work

Original assets are under `assets/gen/link-native-reference/`. Decoded body textures are in `decoded-c00/body`; meshes, skeletons and motions are in the extracted source tree. Original article textures require their own corresponding article records and texture directories.

The current cartoon pipeline is described in `tools/link-render-clip.py`: native poses, authored atlas colours, palette flattening, two-tone depth shading, garment and silhouette ink, an added cap, gear colouring and packing. The efficient alternative is demonstrated by [operator.py](operator.py).

For each actual selected source/context tuple:

1. Obtain its immutable source record, retained pixel-to-UV map, texture IDs, depth, source RGBA, current gear context and registered source ROOT. `plan.json` contains twelve concrete examples, including two composed HAND/ShieldBACK tuples.
2. Sample the corresponding original decoded textures through those saved UV maps. Retain the actual selected equipment visibility and composition. Raw native visibility can contain duplicate held/stowed shields; do not reintroduce the duplicates that were already corrected.
3. Apply restrained continuous lighting and preserve readable original detail. The pilot's camera-depth lighting is an authored approximation. Inspect eyes and their UV/decal layers explicitly; do not blindly recolour them or invent pupils. Improve the pilot's dark blade/low contrast where needed, using a small representative batch before expansion.
4. Produce original-texture sprites without the added cap and expanded cartoon ink. The right `fixed-alpha` pilot column is a diagnostic control, **not the production target**: it deliberately retains green cap and border remnants where original UV coverage is absent.
5. Pack using the recorded source ROOT and scale. Preserve source pose identities, clocks and equipment bindings. Keep the original source evidence immutable and write a new versioned derivative bank.

The pilot assumes compatible retained maps. Only its twelve were checked; audit map availability across each batch before scheduling conversion. For missing or incompatible maps, generate only the missing source captures using the existing compiled guide and caches. Do not rerender or refit the entire completed corpus automatically. Inspect the current `tools/link-authored-guide.py`, `tools/link_author_raster_v2.py` and contextual guide variants before reuse.

The pilot scripts are **examples, not a production batch or installer**. They use hardcoded twelve-pose selection and write their own pilot directory. Adapt them into a separate versioned production operator rather than rerunning them over completed pilot evidence. Preserve original receipts and operators.

## Preserve registration and review collision reuse

Keep source ROOT, camera, per-pose scale, facing, equipment sockets and composed child transforms consistent. Do not recenter on the alpha bounds, floor-snap each drawing, apply source motion twice, or alter body physics to compensate for a visual offset. Preserve independently selected body and SCRIPT clocks, including the three normal charge holds: actual held frame 1 presents raw 0, and held 61 onward presents terminal raw 60. See the full handoff for existing authored adapters.

The cached conversion changes no raw source alpha. Removing the cartoon cap and ink changes the **current packed silhouette**, however: the twelve native-blue samples differ at 125,388 alpha values. Original physical part masks and recorded rig/root values were retained. This supports targeted reuse review; it does not automatically approve every receiving shape or scalp contact against the new appearance.

Compare the new appearance with its current posed receiving geometry, Head contact, active outgoing packets, grip sockets and Foot/Toe support. Reuse exact existing fits where the relevant physical mask, whole physical union, registration and fit configuration are unchanged. If actual body shape or occlusion changes, refit only affected dependencies; a changed union can invalidate neighbouring part fits. Cosmetic cap or ink removal is not permission to enlarge or silently shrink the head collision.

One fresh Fsmash sample 14 reproduction differed by **eight quiver/feather alpha pixels**, despite equal recorded rig/root/mesh inputs. It is quarantined in `fresh-source/` and `fresh-source-measurement-v2/`, with [timing evidence](fresh-map-timing.json). Do not admit that sample as an exact replacement. Fresh Uair sample 14 matched source alpha. Diagnose differences locally and retain evidence instead of weakening equality guards.

## Pack and integrate the new art

Create a separate complete stage for each qualified batch. Preserve the current animation and source family IDs, per-drawing native samples, intervals, rendering coordinates, aliases, equipment composition and mechanics. Update every changed image, page, hash and texture-source binding coherently. If cropping or page layout changes, derive origins and indices from the same registered pose; do not copy incompatible old render coordinates.

The current Link transport uses `tools/encode-fresh-rgba-pages.mjs`. Inspect its current interface before using it: it takes a frames file, separate destination and explicit encoded byte budget. Do not assume another similarly named conversion tool is this encoder; other AIs are changing integration tools in the shared tree.

The current 1,842 bank is **121,133,362 encoded bytes** under a **128 MiB partial admission budget**. The same twelve standalone samples grew from 866,914 to 1,350,678 encoded bytes with detailed textures, **55.8% larger**, while decoded dimensions stayed equal. See [the codec receipt](analysis/standalone-codec-same12-v1.json). This is not an atlas forecast. Measure the actual new packed bank, record a justified updated partial budget when needed, and retain decoded-page, GPU, scratch and full-corpus memory requirements. Do not reduce resolution or hide missing contexts to fit the old compressed-size limit.

Install with guards against the actual current frames/hash and only after qualified staging. Preserve previous versions for comparison. Synchronize preview/status with the actual installed drawing set and hash. Inspect the current renderer and asset consumers first; source installation alone does not update a copied served game build. Retain unrelated publication and other AI sessions.

Update roster portraits, match entry, Lab reference/move previews, results and article visuals as appropriate so they consume the new registered appearance. Verify pickup weapon layering, grips, Bow ownership and projectiles remain aligned. The redraw must retain the user's existing gameplay fixes, including hidden attack rings/hitbox circles, charge feedback/cancels, quick turn-and-fire, Pikachu alignment and falling items landing on platforms.

## Measure throughput and maintain checkpoints

The measured retained-map conversion took 0.320–0.387 seconds per pose, including three PNG outputs. Four persistent workers completed a warm twelve-pose batch in 3.189 seconds, about **3.76 poses per second**. This conditionally extrapolates to **8.2 minutes for 1,842** or **91.7 minutes for 20,711**, excluding packing, integration, review, missing maps and corrections.

The scheduling estimate given to the user was **roughly 1–3 hours for the installed set**, and **several hours for the larger collection**. Treat those as planning estimates, not finish promises. Fresh-map samples took 4.61 and 2.93 seconds wall; two samples cannot establish full-bank rates. See [four-worker measurements](four-worker-timing.json), [initial timings](timing-receipt.json) and [fresh-map timings](fresh-map-timing.json).

Detect available cores, memory, CPU quota and competing jobs. Use persistent process workers with numeric libraries limited to one thread per worker. Increase workers based on measured sustained throughput and memory rather than assuming linear scaling: the pilot showed significant file load/write waits. Cache immutable textures and source inputs, use private writers, preserve qualified output equality, and report actual live PIDs and completed counts. Never describe a launch record as a running pool after its process has exited.

Keep checkpoints in a new stage manifest and the existing full project handoff. Record which families are converted, visually accepted, installed and gameplay-verified separately. Save failed rows and the next concrete action so another AI can resume without repeating successful work.

## Completion and final verification

The visual change is complete when all applicable Link appearances use the qualified style, source registration and paired geometry remain correct, new asset bindings/transport are installed, and the final verification observes the exact resulting build. Preserve the broader unfinished character requirements; completing this style change does not finish Link's full moveset or DK/Pikachu verification.

At the user's final verification phase, inspect the exact production build at game scale: both facings; movement and defense; attacks, charging and releases; landings; held weapons while moving and turning; specials/articles; entry/results; Final Smash and victim contexts; and saved Lab characters in a match. Check actual contact, misses, terrain support, asset loading/residency and relevant regressions against independent requirements. Passing manifests or unit tests alone does not establish visual or match acceptance.

Deliver the updated previews, exact installed/build identity, conversion and review accounting, remaining explicit gaps, and verification evidence. Use the user's chosen sharpness standard throughout; original textures must remain readable and crisp at the actual game scale.
