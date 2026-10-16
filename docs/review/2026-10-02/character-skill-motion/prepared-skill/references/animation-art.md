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
Do not force all characters into separate weapon layers or all equipment into
body sprites. Choose the representation that supports the required transitions.

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

Inspect actual image dimensions and alpha. Keep immutable accepted originals,
final prompts/workflows, selected frame order and a manifest. Pack with a fixed
root and uniform scale; never independently normalize each alpha bounding box,
compress wide poses, or resize a fighter to fit a sword. Increase canvas
clearance with matching anchor metadata when needed.

`tools/pack-clips.cjs` keys the background, despeckles isolated pixels,
aligns frames rendered on different canvas sizes by canvas centre and bottom
(the pose tool's shared registration), takes ONE union rect over every frame
of the fighter and fits it into the fixed 256² cell on both axes,
bottom-pinned (it used to clamp width independently of height, squashing
wide-reach kits). That keeps the body scale uniform across
clips, and it also means the widest or tallest pose of the whole kit decides
how tall the standing pose is inside the cell (Donkey Kong: about 100 px of
256). Calibrate `src/characters/visualScale.ts` from the packed idle cell after
every repack (`display = bodyHeight / (standing px / 256)`) and check the
sprite's feet sit on the platform in a match. After packing, set every
attack move's `animation` counts (drawings per startup / active / recovery)
from the pose schedule — which source frame each drawing came from, against
the move's hit windows — so they sum to the strip's cell count; the frame
selector only honours the schedule when they match, otherwise it spreads the
drawings evenly and the contact frame shows the wrong pose (DK forward smash,
2026-09-25). Guard it with a test against `frames.json`. A global repack requires
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
