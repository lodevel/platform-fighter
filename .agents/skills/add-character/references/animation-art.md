# Author animation and collision on the same timeline

Use this reference for the common downstream workflow of both pipelines.
For UFD-based moves, first follow [motion extraction](ufd-motion.md). For raster
generation, use [ComfyUI generation](comfyui-generation.md) or the user's selected
provider. Keep art direction per character; inspect `docs/ART-STYLE.md`, current
sprites and the current request before applying historical style prompts.

## 1. Write a concrete action specification

For each action/variant, fill the action block in
[the evidence template](../assets/character-evidence.md). Keep source facts,
proposed adaptations and observed runtime results distinct.

Required fields are: stable action ID and parent/variant relationship; legal
entry state and input/resource condition; duration or event-driven exit;
active intervals and strike groups; input/charge/landing branches; pose holds;
body/weapon anchors; collision records; spawned events; runtime route and checks.
Use explicit `not applicable` where a field does not apply. An unknown value
needs a named investigation, not a made-up default. This authoring record is
not a runtime API: inspect existing schemas before choosing implementation fields.

Use inclusive, one-based gameplay frames in human-facing authoring records.
When the consumer uses zero-based half-open intervals, source `[s, e]` maps to
`[s - 1, e)`. Record the conversion once and test both boundaries. Distinguish
total duration from the first actionable frame; inspect the runtime convention.
For loops/holds, specify the entry pose, loop or held pose, exit event and exit
pose. Do not assign a false fixed duration to charge or waiting for a projectile.

## 2. Build the pose schedule

Start with actual source motion or original choreography. Identify anticipation,
every contact arc, transitions between strikes and recovery. Allocate drawings
where silhouette or contact changes; do not select universal drawing counts
such as "12 frames for every attack". Holds can reduce drawings without changing
the gameplay duration. Do not stretch source startup/recovery to fit a generator.

| Pose key | Gameplay frames or state event | Source image / observed source frame | Body and equipment anchors | Contact or branch | Clip cell |
| --- | --- | --- | --- | --- | --- |
| Unique key | Inclusive hold or named event | File/index + inspected mapping, or authored | Root-relative values/guide | Group IDs, empty gap or exit | Planned; replace with actual index |

For a timed segment, cover its entire duration with ordered non-overlapping
holds; list all event branches separately. Keep all active boundary frames
visually inspectable. Preserve separate early/late collision properties even
when they share a drawing. For different strikes, author different poses where
the motion differs. A generic swing replayed for every hit is not a substitute.

Charge holds, follow-up windows and interruptions must match simulation state.
Hitlag/pause freeze the appropriate pose clock. Landing interrupts an aerial
according to its landing/autocancel rules; rebound and successful-hit branches
execute only when their conditions occur. Specify spawned-object release frames
and grip/muzzle anchors, not merely the body animation's name.

## 3. Fix coordinates before generating the pack

Record one base orientation and the transform into game coordinates. Normally
author right-facing sprites, with each pose registered to a fixed simulation
root on its canvas. Record neutral body height excluding weapons/capes, intended
world body size, and a uniform pixels-to-world scale. Name the origin and axis
directions. Root position is not necessarily the pelvis or alpha-box center.

Record relevant body/contact anchors per pose; add hand/grip and weapon base/tip
anchors only when that equipment is present. A body attack uses its striking
limb/body surface; weapon attack anchors are not applicable unless equipment also
attacks. Continue tracking any held/stowed equipment's attachment, visibility
and rendering, even during kicks or punches. Nonhuman anatomy uses
its actual contact parts, not an invented human skeleton or held weapon.
The agent creates these guides from the chosen target body and equipment metrics.
For a custom UFD fighter, map source contact roles onto that body, adapting
geometry rather than forcing source proportions. Keep the target's segment
lengths, equipment dimensions and proportions consistent across poses; record
resulting reach differences. A source replica retains source metrics.

Feet share a ground contact line only in poses that actually contact that
ground. Jumps, kicks, spins, rolls and rear strikes move body parts deliberately.
Do not force every foot or weapon to the same place. Distinguish visual motion
within the canvas from movement already applied to the simulation root.

Inspect facing transforms: fighter orientation and attack direction differ.
A rear aerial or rear strike may already reverse the attack axis in routing;
mirroring it again is a defect. Show both facings in contact inspection.

### Optionally adapt the reference form

When resolving a custom UFD fighter's appearance, expose two choices: **keep the
original form** (default) or **adapt selected proportions toward the donor**.
Reuse a choice already supplied; do not force a new question when keeping the
reference satisfies the task. Selecting a kit alone does not select a reference
redesign. The adaptation can be subtle or approach the donor's full proportions.
If no image exists yet, include the selected form in the initial identity brief
and bootstrap instead of requiring a preliminary image.

Before editing, inspect the original reference and relevant UFD views. Record
which features may change and their target values/ratios or landmark guides:
neutral height, head-to-body ratio, torso width, limb lengths or stance, as
applicable. Track equipment dimensions separately. Record estimated source
measurements as approximate; a generic "50% similarity" is not a geometry brief.
Preserve the target's named identity traits, such as face, palette, costume and
style, unless their change was requested. Do not import donor identity through
its motion reference or force an unselected change of body plan.

When image work is authorized, edit a versioned derivative through the selected
image workflow; preserve the original file/hash. Store the parent reference,
transformation brief, changed metrics and review status. Inspect the derivative
against the identity traits and selected form targets, accounting for pose/camera
and rendering scale. The agent performs corrections within the generation retry
budget; no extra approval is required for executing the selected adaptation.
During deferral, prepare this brief and its checks only; the derived reference
and dependent visual acceptance remain pending. Offering/selecting this option
does not itself end a generation deferral.

Lock the inspected final reference/version before producing the animation pack.
Use it for identity conditioning, target anatomy, pose guides, body-fit hurtboxes
and attack anchors. Closer proportions do not justify blindly copying source
collision or scaling movement/damage/projectile behavior. If the reference changes
after guides, clips or collision were authored, mark affected artifacts and prior
acceptance stale, reconcile them and recheck the pilot. Requalify affected identity
conditioning/LoRAs against the new reference; do not mix incompatible old/new forms.

### Declare anatomy and equipment per state

Create an anatomy/equipment table before pose authoring. Distinguish body parts
(including natural claws, tails, horns or wings), intrinsic held equipment,
defensive equipment, cosmetic attachments, temporary pickups and independent
projectiles/summons. A character may have no equipment; do not create dummy
weapon assets or anchors to satisfy a template. Preserve the actual kit's
contact type: owning a sword does not make its kicks sword attacks.

For UFD-based kits transcribe source contact roles, equipment and per-action
behavior, then map those roles onto the target's actual anatomy and dimensions.
Derive source entries/transitions from data and inspected animation, researching
gaps with supporting evidence; target body shape comes from the chosen identity.
Custom artwork retains equipment behavior and sourced vulnerability rules while
its hurtbox volumes follow its own body. For original kits, use the authored
design. Do not ask the user to reselect equipment supplied by a source fighter.

For each real object, record identity/dimensions, attachment or grip, handedness,
state-dependent visibility, renderer, collision owner and collision role. Record
each sourced or authored role separately: attack region, vulnerable region, defensive interaction,
cosmetic-only or none. A visible object is not automatically damaging or
damage-receiving. Source data or the original design determines these roles.
Do not give a weapon a hurtbox merely because it is visible, or assume every
weapon lacks one. Body attacks also do not imply every striking region is
vulnerable; preserve the move's actual vulnerability rules.

Specify the equipment state for each action/variant: absent, held, stowed,
swapped, hidden, dropped, thrown, returning or destroyed, as applicable. Record
transition frames/events, visibility/layer order, hand occupancy and the pose
needed when grabbing, carrying a pickup or changing tools. Check attached
equipment through jumps, hits, defense, landing and stock/reset states.

Choose rendering from the existing supported pipeline:

- **Baked into the fighter drawing:** appropriate equipment is drawn exactly
  once with that pose. Author alternate poses/visibility when it is absent or
  stowed; do not also overlay an independent copy.
- **Separate attached sprite:** the body drawing omits that object; its grip,
  rotation, facing and front/back layering track the same pose timeline.
- **Independent entity after release:** record the exact handoff event and
  entity transform. Remove the held visual at release, activate the entity's
  correct visual/collision state, and handle return/catch/destruction explicitly.
  Specify lifetime, hitability and any reflection/ownership-change rules from
  source or design; a detached object does not inherit them automatically.

Each object has one deliberate rendering owner per state. Multiple real objects
must have distinct identities; accidental duplicate swords/bombs are defects.
Raw animation mesh-visibility tracks do not establish the resolved equipment
state: held and stowed mesh sets can both be marked visible while a dynamic
part selector chooses one. Resolve captured expression commands and the actual
inventory/owner context before fitting or accepting contextual equipment pixels;
otherwise keep clearance explicitly limited to the body geometry reviewed.
Absent expression commands do not justify overriding an unambiguous motion
visibility program with a generic inventory default. Cross-read primary poses
and equipment placement before selecting that precedence, and label an
unrecovered common selector as an authored adapter.
For baked equipment, a runtime state field does not prove the drawing changed.
Bind conditional body/hand compositions to the actual source sample or joined
component tuple and live equipment context, then inspect the corresponding
pixels. Check post-release intervals as well: a source visibility restore can
occur later than physical item release or gameplay control unlock.
Keep gameplay actionability separate from continuing source body/expression
ownership. An interruptible natural tail can still own visibility callbacks;
control unlock does not itself invoke a native status-end callback. Before a
new owner captures its equipment baseline, reconcile the current inventory and
new source owner rather than inheriting a stale cosmetic tail.
Enumerate held-item hosts from actual live selectors and ownership exclusions,
including defense and receiving states where the item survives. A small audited
motion list or candidate superset cannot close that live context inventory.
Do not force all characters into separate weapon layers or all equipment into
body sprites. Choose the representation that supports the required transitions.

If anatomy or equipment appears broken, inspect actual part/material ownership,
alpha and occluding hands before filling a suspected hole. Decorative engraving
or contrasting interior colour can resemble missing silhouette. Simplify that
interior detail only when needed; do not blindly close source geometry or erase
real anatomy based on colour alone.

Keep carried physical shields and armor distinct from the game's general shield
action; decorative equipment does not inherit blocking or invulnerability.
Record any actual defensive behavior and source separately. Pickups retain the
existing item system's damage/range and ownership rules; verify grip/release
visuals without replacing the character's intrinsic kit.

For a UFD-based custom appearance, retain the source equipment and its role by
default. Only if the user requests removing/replacing it, resolve and record
the resulting adaptation before changing behavior. Do not erase a weapon while
leaving unexplained invisible reach or invent a replacement attack effect.
Retain documented attack/vulnerability roles and timing while fitting volumes
to the chosen target body/equipment. Record size/reach changes under the body
retargeting procedure. Baked versus attached-sprite rendering remains an
implementation choice that must reproduce the same equipment behavior.

## 4. Author gameplay geometry independently of raster pixels

Retain source numeric records when available, including region ID/priority,
damage, launch properties, ground/air masks and bone/part identifiers. Source
bone-local values require the matching animated transform to recover source
root/world coordinates; applying them directly to a different body is not
retargeting. Keep source records separate from authored target geometry.
If only the UFD visualization is available, first complete the
[overlay identification](ufd-motion.md#identify-the-overlays-before-tracing-or-preparing-guides)
record. Tracing its identified collision layer produces approximate source
geometry for comparison, not an automatic target hurtbox. Do not call traced
image outlines exact source geometry.

Keep collision data and sprite pixels separate, but register them to the same
root, anchors and gameplay frame. Fit simplified hurtbox volumes to the target's
posed vulnerable anatomy. Hit regions can deliberately extend beyond visible
contact surfaces; record those margins without requiring pixel-perfect outlines.

### Retarget collision to the target body

1. **Establish target anatomy once.** Record neutral height, torso/head widths,
   limb lengths, relevant equipment dimensions, root, axes and pixels-to-world
   scale from the selected final identity brief/inspected reference. It may keep
   the original custom form, adapt selected proportions toward the donor, or
   match source proportions when chosen. Record the selected version and metrics.
   During deferral specify target metrics and guides; actual art fit stays pending.
2. **Map source parts and poses.** For each action map source head/torso/limbs and
   contact equipment to target parts. Retarget the motion using target segment
   lengths; keep anticipation, strike order and source timing. Map each sourced
   vulnerability state to the corresponding part, including intangibility and
   invincibility intervals. Record unmatched target anatomy and its authored
   vulnerability role; do not silently omit a large new body part or grant attacks
   to a decorative appendage. Resolve absent required contact parts before batching.
3. **Author pose-following hurtboxes.** Use supported shapes such as capsules,
   circles or boxes around the target's head, torso and vulnerable limbs, as
   needed by its anatomy. Record pose/frame selection, local anchors, dimensions,
   margins and status. A wider torso needs a corresponding volume; an extended
   arm moves its vulnerable region, and retraction removes it from the old place.
   Follow crouch, airborne and recovery poses too. Exclude decorative trails,
   cosmetic-only accessories and non-vulnerable equipment from body fitting. Do not use
   the whole sprite bounding box or an automatically traced alpha mask.
   Compare each current posed anatomical region and its visible contour with its
   contact bounds, recording explicit cosmetic exclusions. An accepted pilot's
   bone offset and radius do not qualify the same template across other motions:
   a cap or back-skull fit can still miss the visible face and chin in walk or jab.
   Keep visible and occluded anatomy distinct. Where the actual mesh/retargeted
   body establishes hidden tissue, use its isolated posed anatomical projection
   for receiving geometry even when a shield or arm covers every visible pixel.
   A visibility mask does not grant invulnerability or erase the head; uncertain
   hidden anatomy in generated art still needs an explicit authored fit.
   Dominant Head-bone weighting alone can include cosmetic hair or hat extent;
   retain complete physical skull/face anatomy while excluding those cosmetics.
   Fit independent physical part surfaces before equipment occlusion, then use
   compact primitives measured for each pose. Record sampling-grid precision,
   full-corpus primitive counts and expected contact-processing cost before
   propagation. Hundreds of redundant contour strips are not a better fit;
   three reviewed pilots do not qualify a whole motion bank.
4. **Retarget attack regions separately.** Attach them to the target's actual
   striking limb or weapon and preserve source active windows, strike IDs,
   priority, damage/launch, masks and re-hit rules. Preserve the purpose of
   tip/hilt or early/late regions and deliberate reach margins. Do not copy stale
   source world offsets or scale every attack by the torso's width. Record target
   offsets/sizes and resulting reach. Retarget grab/release and projectile spawn
   anchors where needed; body reshaping alone does not scale projectile travel,
   movement speed, weight, damage or launch parameters.
5. **Lock and reconcile.** Store source-to-target part/region mapping and geometry
   deltas as authored/approximate data, retaining untouched source evidence.
   Inspect accepted sprites against the target body/pose guides. Correct accidental
   generation drift rather than silently resizing hurtboxes per random output;
   deliberate target-design refinements update the shared specification and all
   affected poses/geometry. Geometry adaptation for the chosen custom body is
   included in this workflow and needs no separate approval.
6. **Verify changed contact.** Check real hits on target limbs outside the movement
   body, misses through now-empty space vacated by retracted limbs, target reach edges,
   vulnerability-state boundaries and both facings. Compare source and target
   body/reach envelopes and record spacing/multihit consequences. Copied move
   values do not establish identical matchups or balance. Use the acceptance
   checks below and keep untested consequences explicit.

Use existing `hitWindows` / `collisionHits` for varying attack shapes. Sort
non-overlapping windows; group simultaneous regions within a window. Moving
shapes belonging to the same strike keep the same hit group, preventing extra
damage every frame. New groups permit intended new strikes only. Empty gaps
contain no attack regions. Test simultaneous regional priority and re-hit rules.

Hurtboxes describe damage-receiving anatomy or explicitly vulnerable objects;
the Matter movement body describes stage movement contact. Configure its size
and ground offset deliberately for the target, separately from attack/hurtbox
volumes. Do not distort the movement body to approximate every animation.
Animated hurtboxes need a frame-aware consumer, facing transform and
candidate collision coverage outside the movement body. Check actual damage
delivery against an extended limb; drawing an overlay is insufficient.

## 5. Check runtime capability before claiming integration

Inspect the current implementations, since these limitations may change:

| Check | Repository entrypoint / action if insufficient |
| --- | --- |
| Distinct move routing | `src/characters/spriteAnimationDriver.ts`: `attackMoveToSheets` tries dedicated `utilt` / `usmash` / `dsmash` / `dash_attack` strips and, for a move the runtime tagged with `sheetVariant`, `<special>_air` / `<special>_ground`, before the shared tilt / smash / special sheet. Register the fighter's keys in `MOVE_SHEET_KEYS` and `MOVE_SHEET_SPECS` (plus the manifest) or the move keeps using the shared strip; do not claim fallback art is complete. Ledge and getup attacks still have no dedicated sheet state. |
| Exact pose holds | `src/characters/simulationSpriteAnimation.ts`, `moveSchema.ts`: phase counts may repeat art across strike windows. Add optional explicit pose selection when counts cannot represent the schedule; keep existing fallback for unaffected data. |
| Animated hurtboxes | `src/characters/Character.ts`, `src/match/HitboxDamageHandler.ts`: phase-level modifiers and physical-body candidate contact cannot prove per-pose extended-limb coverage. Implement the needed selection/contact path and test it. |
| Shared authored data | `characterSerializer.ts`, `characterFactory.ts` under `src/characters/`, plus Lab: new data must survive save/load and drive both preview and match. |
| Display registration | `src/characters/visualScale.ts`, `src/scenes/MatchScene.ts`: canvas/root metadata must use the same transform in preview and match. |

Do not introduce a parallel character engine. Implement the smallest shared
extension needed by the requested action; add regression checks for old data.
If extending the engine is outside the requested scope, record the required
integration as unfinished and complete other authorized work.

## 6. Pack accepted poses and wire every consumer

### CPU batch processing

Before a substantial CPU export, render, fit or packing batch, detect available
logical CPU threads, process affinity, container CPU quotas and available RAM
(including any memory limit). Default to filling independent CPU work up to
that effective thread capacity; do not impose an arbitrary four-worker ceiling.
For Python CPU work, use process workers when the GIL prevents useful thread
parallelism. Give each worker one BLAS/OMP thread to avoid nested
oversubscription, and retain its compiled model, rig, operators and immutable
input caches across cells instead of rebuilding them for every frame.

Use disjoint small chunks and dynamically refill idle workers. Give writers
private output paths and reconcile committed artifacts through the existing
ledger; eligible immutable readers may share a read lease. Overlap eligible
processing and integration when their ownership and dependencies permit it.
Stagger worker startup to avoid simultaneous model-loading memory bursts.
Reduce concurrency only for measured resource pressure or degraded throughput,
and record the measured CPU/RSS, limit and reason. GPU/ComfyUI submissions retain
their existing queue policy; permission for CPU workers does not authorize more
GPU jobs or deferred build, browser or verification work.

Measure completed cells per second, CPU utilization, worker/aggregate RSS and
the actual remaining count for each stage. Distinguish a stage ETA from the
whole delivery ETA, including remaining fitting, integration and verification.
Profile representative actual costly frames before optimizing an operator.
Cache invariant geometry, exact coverage masks or parsed resources only when
controlled comparisons preserve ordered outputs, tie choices and proof metadata.
Report which stages were measured and their limits; an isolated fit speedup is
not a whole-pipeline or delivery speedup.
For integer-grid fitting, separate squared X/Y score arrays can avoid a large
coordinate tensor while retaining strict radius comparisons, first-candidate tie
order and the selected capsule tolerance. The [V7 frozen-mask qualification](../../../../docs/review/2026-10-12/link-character/rework/performance/compact-physical-operator-audit-v1/scores-v7/qualification.json)
compared original ordered chains, proofs and committed WORLD geometry; it measured
only four Link poses, one Pika tail and one complete DK pose. Use fresh-child
`/proc` peak RSS for the fit stage; inherited process highwater or model-loading
projection peaks cannot establish that fitter's memory cost. Qualify any new
operator against actual costly masks before freezing a new writer; preserve
already-running operators and completed banks.
For a later gear or hand batch, reuse a completed fit only when the exact part
mask, whole physical union, margin and operator/configuration identities match.
Keep local chain/proof reuse separate from its ROOT/scale/support conversion.
Reprove a changed subset before refitting; unchanged joint names or cosmetic
visibility alone do not establish equality of the physical fitting inputs.
When an anatomical envelope changes, check every dependent part chain against
the new whole union before reusing it; the visibly bad poses are not the complete
dependency set. Reuse passing chains exactly and refit only failures, retaining
the old journals. The [DK selective audit](../../../../docs/review/2026-10-12/link-character/rework/art/final-dk-selective-crown-repair-v3/completion-receipt.json)
covered 521 derivative rows: 6,103 chains reused, 1,191 parts refitted by eight
workers in about 208 seconds, with no failures, projection or render work. These
are that batch's measured counts, not a universal reuse rate or runtime proof;
the whole-union, margin and operator/configuration identities remain required.
Preserve source inputs, pixels, clocks, geometry and deterministic output when
changing execution strategy; qualify a controlled artifact comparison before
replacing a pipeline. Do not reduce quality or sampling to make it faster.
Retain actual live PID/session/job-handle and ledger evidence before calling a
worker stalled or failed. Resume failed or unfinished chunks from committed
progress; a timeout alone does not justify restarting completed cells.

### Sharp, clean raster acceptance

For this project, characters must look polished, sharp and uncluttered unless
the user explicitly chooses another direction. Keep a clear silhouette,
deliberate outline weight, readable face and equipment, and restrained shading
and texture. Retain identity-defining details without adding visual noise,
muddy surfaces or fine detail that turns into speckles at gameplay size.
Intentionally chosen pixel art is a separate direction; accidental low-resolution
exports do not satisfy the default.

Before approving bulk packing, inspect actual packed idle and contact poses,
including wide reaches and small face/hand/weapon details. Compare them with
accepted roster sprites, such as Pikachu, at their intended world sizes under
the same viewport, zoom and filtering; transparent canvas size is not body
resolution. Record the visible neutral body bounds, packed pixels per world
unit, renderer sampling and intended display scale. Choose sufficient density
to retain clean edges and readable details at normal gameplay and supported
close views. Pixel density is evidence, not a substitute for looking at the
result, and different anatomy may need different export sizes.

Inspect the final cells at 1:1 and at actual display size on light and dark
backgrounds. Reject visibly jagged or blurred contours, lost facial detail,
merged fingers/equipment, dirty alpha edges and inconsistent outline weight.
An enlarged chat preview or an unresized source render cannot qualify the
shipping sprite. Record source-quality review, packed-quality review and final
in-game review separately; a static pilot does not prove runtime rendering.

When downsampling loses quality, re-export from the retained full-resolution
originals or regenerate insufficient source art. Enlarging an already degraded
sprite does not recover its detail. Keep physical body size, world root,
collision and sockets unchanged during a resolution-only correction: adjust
pixel metrics and pixels-to-world scale together, then remeasure fit against
the new packed pixels. Do not normalize individual poses to their alpha bounds.

#### Display target and memory (decided 2026-10-18)

The shipping form of every fighter is fixed by [Phase 3](../../../../docs/review/2026-10-18/phase3/README.md):
full drawings, stored at the size a match shows them, held where motion allows, and
reduced to one palette per character. Generate and accept art at full resolution as
above, then derive the shipping package; never ship the generation resolution.

- **Density:** one stored pixel per screen pixel on a 1080p screen at the match
  camera's closest zoom (1.4); drawings shown only by Final Smashes at their close-up
  zoom (2.8). Keep the accepted full-resolution originals so a later density change
  re-exports instead of regenerating.
- **Holds:** allocate drawings where silhouette or contact changes (section 2). For
  Final Smashes and other dense sequences, the holds pass at limit 0.12 drops
  near-identical neighbours, never holding a drawing past 8 ticks or the action's
  longest window. Check that idles and loops still move.
- **Palette:** one palette per character, 256 entries including transparent; each
  costume is another palette. Keep fills clean and outlines deliberate so the
  palette does not band; avoid noisy gradients and texture that needs thousands of
  colours.
- **Commands:** `npm run character:export`, then
  `npm run character:holds -- <id> --max-diff 0.12`, then
  `npm run character:shrink -- <id>~holds-0.12`. Review `<id>~holds-0.12~small-c256`
  in the character lab (`npm run lab`) beside today's art and the Ultimate recording,
  and record the GPU memory from its `candidate-report.json` (reference: DK 82.5,
  Link 30.9, Pikachu 18.8 MiB at one byte per pixel).
- **Loading:** a fighter's art loads when a player selects it and unloads when no
  player has it; keep a fighter within the roster budget (8 fighters under 1 GB)
  instead of trimming drawings to fit.

Until the game reads character packages (roadmap Phase 6), the game still displays the
packed sheets described below; the package path is what the lab shows and what the
game will display. Shrinking to this density is the accepted target, not the "quiet
lowering" forbidden below.

Resolve texture limits with multirow or multipage packing and, for large banks,
bounded texture residency. Keep logical drawing/native sample identity separate
from page-local texture coordinates. Do not quietly lower accepted resolution,
drop drawings or alter timing to make a bank fit. During final verification,
check actual uploads, page transitions, cold texture loads and memory behavior
on the target renderer while preserving the accepted visual quality.

Inspect actual image dimensions and alpha. Keep immutable accepted originals,
final prompts/workflows, selected frame order and a manifest. Pack with a fixed
root and uniform scale; never independently normalize each alpha bounding box,
compress wide poses, or resize a fighter to fit a sword. Increase canvas
clearance with matching anchor metadata when needed.

Measure registration and body/equipment fit against the final packed pixels
after resizing or resampling. An earlier full-resolution measurement does not
automatically qualify the reduced cell. For an anatomical sole measurement,
inspect visible antialiased edges and record the alpha cutoff, local foot region
and excluded resampling fringe; a high opaque cutoff can omit visible support.
Any resulting uniform registration shift must update drawing ROOT, receiving,
outgoing and sockets together. Preserve independent motion/physics displacement,
and do not floor-snap airborne poses or widen tolerance to hide a packing error.

When using a rendered native model as a pose guide, distinguish material alpha
from the intended target silhouette. DK's recovery guides retained transparent
fur texture inside the head, arms and cloth; smooth generated RGB then appeared
striped on a dark background. Inspect alpha and dark/light composites before
generation or receiving fitting. If the chosen target has opaque cartoon skin,
author that interior opacity within reviewed anatomical regions while retaining
real limb/finger/garment gaps, exterior contour, root and floor. Record changed
pixels and immutable before/after hashes, then fit receiving to the corrected
target alpha. This is target authoring, not recovery of native collision data.

`tools/pack-clips.cjs` keys the background, despeckles isolated pixels,
aligns frames rendered on different canvas sizes by canvas centre and bottom
(the pose tool's shared registration), takes ONE union rect over every frame
of the fighter and fits it into the fixed 256² cell on both axes,
bottom-pinned (it used to clamp width independently of height, squashing
wide-reach kits). That keeps the body scale uniform across
clips, and it also means the widest or tallest pose of the whole kit decides
how tall the standing pose is inside the cell (Donkey Kong: about 100 px of
256). Use a different packing path when this fixed-cell reduction cannot meet
the accepted sharpness target; increasing display scale cannot restore lost
detail. Calibrate `src/characters/visualScale.ts` from the packed idle cell after
every repack (`display = bodyHeight / (standing px / 256)`) and check the
sprite's feet sit on the platform in a match. After packing, set every
attack move's `animation` counts (drawings per startup / active / recovery)
from the pose schedule — which source frame each drawing came from, against
the move's hit windows — so they sum to the strip's cell count; the frame
selector only honours the schedule when they match, otherwise it spreads the
drawings evenly and the contact frame shows the wrong pose (DK forward smash,
2026-09-25). Guard it with a test against `frames.json`. Packing tools write gameplay rows
(hurtboxes, grips, Final rows) into `frames.json`; run `python3 tools/split-gameplay-data.py`
afterwards so they land in `gameplay.json`, which the simulation reads. A global repack requires
verifying every affected strip; prefer isolated clip packing for a targeted
change.

The actual strips, `assets/characters/<id>/frames.json`, `src/assets/manifest.ts`,
animation specs/key maps, sprite routes and frame selector must agree on cell
size/count/order. `frames.json` alone does not register gameplay animation.
Final runtime assets must be in the repository's shipping paths. `assets/gen/*`
is mostly ignored: keep indispensable prompts/metadata and accepted assets in
trackable locations or record a deliberate reproducible external source.

## 7. Verify visuals with gameplay

Use Character Lab -> Move Data for supported normals: Q/E selects, comma/period
steps. Inspect startup, every first/last active frame, inter-hit gaps and recovery
at actual match scale. Its cyan physical-body proxy is not proof of animated
hurtboxes. Test unsupported Lab branches separately in a match.

For every applicable action compare source motion, target pose and runtime
regions at the same game frame, in both facings. Include moving targets, misses
at reach boundaries, actual damage/shield contact, hitlag/pause and landing or
follow-up transitions. Rendered overlays and passing constant-based unit tests
do not prove collision delivery. See [runtime acceptance](integration-verification.md).

Verify visible projectiles, bombs, summons, tethers and held objects at their
simulation positions, including appearance/attachment/release/cleanup. Check
grabs/throws with the victim and existing `src/items/` pickup interactions. Keep
item damage/range in the item system; add body grip/clip support where required.
Do not expand this task into designing new unrelated weapons.
Include equipment absence, correct limb contact on unarmed moves, held/stowed
switches, attachment in both facings and single-render ownership at release or
catch in the applicable acceptance rows. Scope these checks to actual kit
features; an unarmed fighter need not acquire an intrinsic weapon for testing.
