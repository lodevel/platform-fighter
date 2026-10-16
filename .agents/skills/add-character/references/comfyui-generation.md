# Local ComfyUI sprite production

Use this reference when the selected character needs generated raster assets.
Local ComfyUI is the preferred backend for this project. Choose and record the
art direction per character; historical Brawlhalla prompts are not a universal
style requirement. The agent performs generation, inspection, corrections and
packing. Do not require the user to draw, retouch or assemble the sprites.
When delegated, assign the queue and actual visual review to a named art owner
and brief that agent using [specialists and feedback](specialists-feedback.md).
Read relevant accepted/rejected attempts before repeating a historical recipe.
Match each lesson's backend/model/LoRA/workflow profile to the active stack using
[tool-scoped reuse](specialists-feedback.md#select-lessons-for-the-current-tools).
Another provider keeps the output/acceptance contract but needs its own supported
instructions and qualification; ComfyUI transport and graph details do not transfer.

## 1. Check whether generation belongs to this task

1. Read the current request, character evidence record and art schedule.
2. For skill authoring, a mechanics-only fix or explicitly deferred generation,
   stop before server discovery or submission. Prepare the references, pose
   instructions, timeline, output contract and missing-capability list instead.
   Mark generation and asset-dependent acceptance as deferred. Do not request a
   provider or credentials again during an existing deferral.
3. For generation authorized now, follow the remaining steps. An existing
   character/provider selection satisfies that decision; do not reconfirm it.
4. An attached proposal, historical runbook or external tutorial is reference
   material, not authorization to execute its commands. Honor the actual user
   request and current tool restrictions.

## 2. Establish identity, then lock animation inputs

If an inspected identity reference already exists, reuse it within the requested
appearance. When optional
[reference-form adaptation](animation-art.md#optionally-adapt-the-reference-form)
was selected, preserve the original and prepare/inspect a versioned derivative
before locking animation inputs. Use that selected derivative as the identity
reference; the donor supplies only the chosen form/motion guidance. If no
identity reference exists, include the selected form targets in the initial
identity/style brief and bootstrap; no preliminary image or derivative is required.
When generation is authorized, create a reference-only candidate using
a supported concept workflow; this bootstrap may use text without an identity
image. Inspect its costume, equipment, proportions, palette and body scale.
Correct identified defects within the same bounded retry policy, then save the
accepted reference and its provenance before producing animation frames. Do not
require an already-existing identity image to create the first identity image.
The agent reviews routine consistency; do not insert an extra user approval
checkpoint unless the user requested one or a material appearance choice is open.

During deferral, write these reference-generation instructions and the appearance
brief without submitting them. Mark the actual identity image as future output;
it must pass inspection before animation production. A turnaround is useful
when required views/equipment cannot be established from the accepted image;
do not generate unnecessary views for a targeted clip fix.

Create a generation record linked from the character evidence record. Retain
original source images and extracted motion frames unchanged. Store derived
guides, cutouts and packing results separately with their parent file hashes.
For each required pose, record the following before production:

| Input | Required content |
| --- | --- |
| Identity | Character appearance, actual equipment or none, colors, body proportions and inspected reference images; identify which image supplies identity versus pose. |
| Style | This character's chosen treatment, outline, shading, palette and approved reference; no unreviewed global style prefix. |
| Motion | Source URL and extracted frame identifier for UFD motion, or authored choreography for the separate original-moveset pipeline. |
| Timeline | Stable move/variant/pose keys, simulation-frame interval, relevant contacts/events and intended drawing hold. |
| Coordinates | Canvas dimensions, root coordinate, body scale, attack reach, facing convention and projection into game coordinates; equipment metrics only where applicable. |
| Guide | Actual body/contact landmarks; add grip/weapon landmarks only for present equipment. Include equipment state, visibility/occlusion and baked/separate render ownership. |
| Deliverable | Ordered filename, clip route, sprite or separate entity role, and objective acceptance checks. |

For a custom appearance using a UFD moveset, define the target's own body metrics
and retarget source poses to them using the
[body-retargeting procedure](animation-art.md#retarget-collision-to-the-target-body).
Provide guides matching the final selected target form. Source references must
not impose unselected donor proportions; deliberately chosen form adaptation is
part of the target contract. Hurtboxes follow target anatomy; attack regions
follow mapped contact limbs/equipment. Record geometry/reach adaptations while keeping source
move timing and properties. Once fixed, maintain target proportions across the
pack; do not stretch bodies or alter collision to rescue inconsistent outputs.

Source timing controls the simulation. Neither a GIF's playback delay nor a
generator's image count defines game frames. Keep the inspected source-image
mapping and simulation timeline separate; carry unresolved mappings as gaps.

For a UFD-based kit, build the pose guides from the extracted source frames
with `tools/ufd-pose-canny.py` (see `docs/ART-PIPELINE.md` §2b) rather than
from text-to-image drafts: on Donkey Kong (2026-09-25) drafts ignored the
all-fours stance and two-handed contact in both pilot moves, while frame-derived
silhouettes reproduced them; render silhouette guides at ControlNet strength
≈0.9. Inspect the tool's review sheets per clip; overlaid strike frames rely on
overlay-free neighbours and limb reconstruction from the overlay centres, so
record those poses as approximate.

The tool uses one scale per batch (reference standing height 600 px — the
size the model obeys; at 325 px it ignored the outline in most frames) and
gives each pose the smallest canvas its reach fits on; read and record the
canvas distribution it prints, and check the renders on large canvases first.
Never mix guides built at different scales in one batch. Clips the source
does not show take
`--fallback-frames` silhouettes with a per-entry `heightRatio` relative to the
reference stance — upright poses against a hunched reference need ratios above
1, or the body comes out half-size. Add ground-shadow terms to the negative
prompt; the renderer's shadow survives the chroma key.

Inspect and correct the actual guides before generation. A pose detector may
miss an occluded arm, misread an overlay or lack the joints for a nonhuman body.
OpenPose alone does not constrain a sword, shield, cape or projectile. Supply
the necessary weapon/shape guides using a supported conditioning mechanism.
Remove source hitbox overlays from the generation guide without treating that
cleanup as collision reconstruction. Keep the unmodified source for comparison.

Use the equipment table from [animation and collision](animation-art.md) in
each pose instruction. For unarmed actions name the contact limb/body part;
do not hallucinate a weapon from another character's prompt or LoRA. For armed
actions state what is held, stowed or absent and which objects are rendered
separately. A character-level "no weapons" negative prompt must not suppress
an intentional pickup state. Reject duplicated or wrongly baked equipment.

## 3. Inspect the real installation and choose a supported graph

1. Discover the configured endpoint and local installation from current project
   configuration, running-process information or an existing user-supplied
   address. The client's `127.0.0.1:8188` default and historical WSL/Desktop
   paths are candidates, not evidence of the active server. Do not start a
   second server on an assumed port. If discovery finds no usable endpoint,
   report the missing connection information and continue independent work.
2. When generation is in scope, read `/system_stats`, `/object_info` and the
   relevant loader-node input lists. Record the observed server version,
   selected device, node classes and available model filenames. Inspect the
   current queue before submitting. These GET requests do not render images.
3. Check the selected base model, text/image encoders, VAE, conditioning models
   and custom nodes against their primary documentation and actual installed
   input schemas. A node existing in `/object_info` does not establish that its
   weights are compatible with the chosen model. Do not attach an arbitrary
   OpenPose ControlNet or IP-Adapter to Z-Image merely because both names appear
   in a tutorial.
4. For animation production, require a verified identity-control mechanism and
   a pose/weapon guide path in the saved graph. Use compatible reference-image
   conditioning, or a character LoRA for the actual target identity that passes
   the pilot against inspected identity references. The reference-only bootstrap
   in step 2 is the exception. Trace all selected conditioning/adapter outputs
   into the sampling result. A fixed seed plus an identity prompt does not prove
   consistency; a style LoRA alone is not character identity control. Accept
   either identity mechanism only after the pilot demonstrates identity and motion.
5. If the installation cannot satisfy those requirements, name the missing
   nodes/models or capabilities precisely. Do not submit an unsupported graph
   as a speculative full-pack run. Do not install nodes, download model weights,
   change server exposure or switch to a paid/cloud provider unless that scope
   is already authorized. Prepare the concrete setup change before requesting
   any necessary authorization; keep independent work moving.

ComfyUI documents the inspection, submission and retrieval endpoints in its
[server route reference](https://docs.comfy.org/development/comfyui-server/comms_routes).
Validate request shapes against the installed version instead of inventing
parameters from a different hosted service.

### Select and verify LoRAs explicitly

Record whether the character needs a **style LoRA**, **identity LoRA**, both,
or none. LoRAs are optional; this selection and compatibility check is required.
Use none when the chosen workflow already passes identity/style/motion checks,
and record that evidence. LoRAs do not replace UFD motion guides, timing or
collision authoring. A ControlNet model patch is not a style/identity LoRA.

1. Check each candidate's author/model card and metadata for its base-model
   family, supported variant/checkpoint, components, loader requirements,
   trigger words and recommended strength/sampling recipe. The repository's
   current Z-Image-Turbo graph cannot assume compatibility with an SDXL, SD1.5
   or Flux LoRA. Even related base/Turbo variants need documented support and
   a successful pilot. A filename, file extension or style preview is not proof.
2. Match the LoRA to the target appearance. A custom robot inheriting Link's
   moves should not acquire Link's costume/face through a Link identity LoRA.
   Reject pixel-art styling for a character whose chosen direction is non-pixel.
   Confirm the file is present in the actual loader's discovered inventory;
   historical documentation does not prove the weights are installed.
3. Use the supported loader and trace its patched model into the sampler,
   alongside the required pose controls. Route patched text conditioning when
   the adapter affects it. Model-only loaders need no invented CLIP-strength
   parameter. Check load diagnostics for unapplied target weights; a loader
   node that is bypassed or silently ineffective does not satisfy this check.
4. Within the existing pilot/attempt budget, compare controlled settings with
   the same pose, references and seed. Change one adapter or strength at a time;
   qualify the actual combined stack before using it across clips. Do not reset
   the retry budget for each candidate. Reject improvements in style that break
   identity, locked target proportions, authored contact reach or pose-guide agreement.
5. Lock accepted LoRA file/hash, author/source, base-model compatibility,
   role, trigger words, supported strengths and application order in the saved
   workflow and generation record. Do not change the stack between clips without
   rechecking continuity. Record `none` explicitly if no LoRA is used; record
   `undecided/deferred` when its selection still awaits capability or pilot checks.

If no suitable LoRA exists, use verified reference conditioning when it meets
the target, or record the missing capability. Character-LoRA training is a
separate production step requiring a curated, inspected identity dataset and
compatible training/inference setup within the authorized scope. Do not train
on inconsistent rejected frames or silently add training/model downloads while
generation is deferred.

Use the [official LoRA workflow](https://docs.comfy.org/tutorials/basic/lora)
and the installed loader's schema. A
[model-only loader](https://docs.comfy.org/built-in-nodes/LoraLoaderModelOnly)
has different inputs from a model-and-text-encoder loader.

### Existing repository tools are starting points, not acceptance evidence

- `tools/comfy-style.ts` builds text-to-image graphs with historical style/model
  defaults. Its prompt and negative prompt can conflict with a chosen character
  style; inspect the resolved values before use.
- `tools/gen-frames.ts` generates a pose draft, extracts Canny edges and samples
  with a repeated identity prompt/seed. `tools/gen-frames-cn.ts` loads cached
  Canny maps. Neither production graph currently supplies an identity image
  or applies a LoRA; their Union `ModelPatchLoader` loads a ControlNet patch.
  Their comments claiming constant identity are not a proven guarantee.
- The cached-guide script can skip missing guides and still finish. Treat each
  missing pose as an incomplete inventory row; a zero exit code is insufficient.
- `tools/comfy-client.ts` provides transport but its convenience method fetches
  the first saved output. A graph with multiple output nodes requires explicit
  final-node selection. The client does not supply a durable job ledger,
  ambiguous-submission recovery or per-frame visual validation.
- `tools/pack-clips.cjs` uses a global alpha-bound crop, square cells and an
  automatic idle fallback. Its width clamp can compress a wide pose while
  keeping height fixed. Do not use it unchanged for the anchored contract below
  or allow another fighter's fallback idle to satisfy this fighter's coverage.

## 4. Save a reproducible job before queueing it

Save the exact API-format workflow and resolved prompts, not just a screenshot
of the node editor. Record graph hash, all node/model identifiers, available
model versions or hashes, sampler settings, dimensions, seed values, reference
and guide hashes, intended output node and pose key. Record unknown version
information as unknown. Reusing the same seed is useful for comparison but is
not a guarantee of identical output across environments.

Allocate a unique job/attempt identifier and task-specific output names before
uploading or submitting. Retain prior attempts and accepted files. Prefer the
server's supported image-upload route when needed; retain its returned image
identifier rather than assuming a Windows path is visible from a WSL process.
Do not overwrite unrelated files in the server input/output directories.

Create or update a durable job ledger with one entry per attempt containing:
pose key, attempt number, graph hash, state, server URL, submission time,
prompt ID when returned, final output references/hashes, inspection result and
specific rejection reason. Useful states are `prepared`, `submitted`,
`running`, `succeeded`, `accepted`, `rejected`, `failed` and `unresolved`.
These are production records, not a new game-runtime schema.

## 5. Qualify the workflow with a small pilot

1. Generate one pose exposing body scale, equipment and the main contact region.
   Inspect it against the identity image and guide before generating a sequence.
2. Produce one complete representative move. For Link, use the up tilt's weapon
   arc. If the kit has separate strikes, also qualify a multi-strike move such
   as forward air, including the inactive gap and visibly distinct strikes.
   For another fighter select equivalent tests from its actual inventory.
3. Apply the [packed-art quality gate](animation-art.md#sharp-clean-raster-acceptance)
   to actual exports before committing to bulk packing. Inspect every pilot
   drawing, its timed playback and the sprite/collision
   overlay at gameplay scale. Check both facings through the actual renderer.
   For UFD kits, compare the action's recorded source recognition cues with the
   target sequence; correct generic/replaced motion even when timing matches.
   An idle-only pilot does not qualify attack motion or equipment alignment.
4. Apply steps 7 and 8 to the pilot's rows before accepting the pilot; full-kit
   reconciliation follows production of the remaining inventory. If engine
   routing or frame inspection cannot express the authored sequence, record
   that dependency and resolve it within the authorized implementation scope.
   Do not approve production on the assumption that it will be integrated later.
5. Expand to the complete required move/state/entity inventory one reviewed
   batch at a time. A pilot is an early gate, not completion of the character.

## 6. Submit, wait and recover without duplicate jobs

Use one outstanding task-owned render at a time unless the user has selected
another concurrency limit. Respect any user cost/time/job budget. Plan the
remaining job count before expanding a batch; do not create a new budget merely
because a row failed inspection.

1. Submit the saved graph once using `/prompt`. Persist the returned prompt ID
   immediately. Validation errors are failures, not successful queue entries.
2. Track that ID through `/history/{prompt_id}` and `/queue`; retrieve only the
   intended final node's files through `/view`. For polling, default to a
   5-second interval, a 10-second per-request timeout and a 15-minute deadline
   per attempt unless the recorded workflow/task budget specifies otherwise.
   Perform waits in tool calls short enough to report progress at least once
   per minute. A nonempty image list alone does not mean visual acceptance.
3. A client timeout does not cancel the server job. On timeout or restart, first
   reconcile the stored ID with queue/history and resume observation or fetch
   its completed output. Never blindly submit it again. If the submission
   response was lost before an ID was recorded, inspect queue/history using
   the saved graph and unique output prefix; ambiguous ownership remains
   `unresolved` and must not trigger another submission.
4. An absent history entry does not prove a job failed: it may still be queued,
   running or unavailable after a server restart. Preserve this uncertainty.
   Once the deadline expires, checkpoint the known state and continue other
   work; do not poll indefinitely or turn the timeout into a new render.
5. If using WebSocket events, filter by prompt ID. `executed` is a node UI event,
   not whole-graph completion. Confirm final success/history and expected
   output-node data. See [ComfyUI server messages](https://docs.comfy.org/development/comfyui-server/comms_messages).
6. Do not clear the queue, delete history or use the server-wide interrupt to
   stop somebody else's render. Cancel a task-owned job only after checking
   current ownership and the endpoint's actual behavior. A shared server-wide
   interruption is not safe merely because our client is waiting.

## 7. Inspect each output and make bounded corrections

For every image, verify decodable PNG, expected dimensions, output identity,
pose order, real alpha, unclipped equipment and correspondence with its guide.
Render contact sheets and timed playback. Inspect identity, anatomy, weapon
continuity, silhouette, root stability, scale, unwanted duplicates and motion
continuity visually; a file checker cannot certify those properties.

Check body/weapon landmarks against the contract's recorded tolerances. Root
registration must be exact in packing metadata. Feet match the ground only
during intended ground contact; jumps, kicks and rolls must not be forced onto
a common foot baseline. Rear-facing weapon motion must not be mistaken for an
unwanted reversal of fighter orientation.

If transparency is not produced natively, apply a recorded compatible cutout
process to a derived copy. Inspect thin weapons, hair, outlines, interior holes
and edge fringes over light and dark backgrounds. Chroma-key colors must not
erase costume colors. A drawn checkerboard or magenta background is not alpha.
Neither background-removal nor resizing may alter the authored root/body scale.

Reject poses with concrete reasons. Permit at most **five generation attempts
per pose: the initial attempt plus four targeted corrections**, within the task
budget. Change only the relevant guide, conditioning or prompt parameters and
record the change. Do not rerender accepted clips to fix one rejected image.
Transport observation/recovery is not an image retry and must not create a new
GPU job. Stop the affected batch immediately on systemic failures such as
missing models, incompatible nodes, service rejection or device failure; do not
repeat the same failure for every pose. Report unresolved rows and continue
independent work. Never replace a rejected asset silently with a generic move.

Use bounded correction masks when a local defect can be repaired without
regenerating the accepted anatomy when the chosen tool supports that operation.
The observations below apply to Pikachu's local ComfyUI Z-Image-Turbo int8 graph,
Fun-ControlNet-Union, colored seed/masked composite and **no LoRA**, not an
arbitrary LoRA stack or another provider. In those reviewed runs, cheek colors
drifted despite palette prompts; excluding inspected cheek pixels from the
render/composite mask preserved them. An eye-like nose required a nose-only
seed/guide/mask correction, not regeneration of the whole face. Apply such
protection only where the inspected seed already supplies the correct feature;
retain unchanged-pixel checks and inspect the actual correction. These are
conditional techniques, not evidence that a mask fixes every identity defect.
Treat them as candidates requiring a new pilot on a changed tool profile.

When reach clips the canvas, increase padding and update root metadata while
preserving the locked body scale and game-space root. Do not shrink the fighter
to make the output fit. Qualify tiled/multi-pose generation with a small pilot
before expanding it: inspect every cell for pose/root preservation, identity,
detail and cross-cell contamination, then compare actual time and quality.
Fewer submissions alone do not justify replacing a qualified single-pose graph.
Keep model-specific settings and evidence in the character's generation record.

## 8. Pack, integrate and accept the actual result

1. Pack only accepted images in the declared pose order. Use the shared canvas,
   fixed root and uniform body scale from the coordinate contract. Padding may
   increase for reach; independently centering alpha bounds, stretching axes,
   or fitting each pose to its own bounding box is prohibited. Preserve a
   reproducible transform from generated pixels through packing to game space.
2. If the current packer cannot honor that contract, use or implement a focused
   packing path within scope. Do not run the global repacker merely to replace
   one clip. Keep unmodified originals and previous accepted assets recoverable.
3. Confirm PNG cell dimensions/count/order, manifest entries and `frames.json`
   agree. Include required root/display metadata in both MatchScene and the
   Character Lab; an unsupported metadata field is not an integrated feature.
   For the actual WebGL renderer, query `MAX_TEXTURE_SIZE` and keep both atlas
   axes within the observed limit; a valid PNG or texture handle does not prove
   successful upload. Pikachu's linear sheets exceeded an observed8192 limit
   and rendered black quads. Row-major multirow packing preserved every cell's
   pixels/root/order; Phaser `endFrame` had to cap the declared frame count to
   exclude padded cells. That measured limit is environment-specific. Verify
   loaded cell coordinates/counts and actual visible first/last bodies against
   the new build, then inspect legal gameplay poses. Hit effects or a nonempty
   screenshot alone can hide a failed body upload. This is renderer guidance,
   independent of which provider generated the PNGs.
4. Connect all poses to the actual state/move/variant timeline. Show that
   separated strikes use their assigned drawings, inactive gaps have no attack
   regions and charge/landing/follow-up/hitlag branches select the intended
   poses. Do not add startup or recovery to fit the sprite count.
5. Compare art and authored collision together at contact boundaries, during
   travel, gaps and recovery. Confirm both facings and real contact in the
   running game. Keep source-derived and visually calibrated geometry distinct.
6. Store final shipped assets and essential reproducibility metadata in tracked
   locations. `assets/gen/` is generally ignored; a local generated file is not
   a delivered game asset. Keep references to larger raw artifacts accessible
   and identify any that are not part of the repository delivery.
7. Reconcile every required inventory row with an accepted asset, an explicit
   mechanically appropriate reuse, or an unresolved/deferred gap. Report full
   completion only when all requested visual and runtime gates pass. Passing
   generation, packing or TypeScript checks alone does not complete a fighter.

When changing TypeScript generation tools, include their separate type-check
configuration, `tools/tsconfig.json`; the root application type check does not
cover them. Skill-only and deferred-handoff changes require link/structure and
record-consistency checks, not a live generation call.
