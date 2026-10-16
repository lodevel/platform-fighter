---
name: add-character
description: Create, complete, or audit playable fighters in platform-fighter, with explicit UFD or original-character pipelines, complete contextual movesets, sourced motion, sprites, collision, and running-game verification. Apply only affected steps for a targeted fix.
---

# Create or complete a fighter

Deliver the requested playable fighter, including its applicable full moveset,
visible animations, collision and evidence from the running game. Use Ultimate
Frame Data (UFD) as the primary source for a UFD-based kit. A successful build,
generated sprite sheet or completed sample attack does not establish completion.

Work from the repository root. Repository paths are relative to that root;
links in this skill are relative to this skill directory. Follow the ordered
steps below for full creation. For an audit, report findings without changing
behavior unless asked. For a targeted fix, run the affected steps and regression
checks; do not turn a one-move task into a roster rebuild.

## 1. Select the pipeline and the fighter

Resolve the following from the current request, prior user choices and existing
character records. Ask only for a missing choice that changes the result.

| Choice | Required decision |
| --- | --- |
| Pipeline | **UFD-based** or **original/non-UFD moveset** |
| UFD-based source | Specific game and fighter from the actual [UFD roster](https://ultimateframedata.com/smash); default game is Ultimate. If unspecified, ask the user to choose before authoring the kit. Never silently choose Link. |
| Original source | Follow [original-character](references/original-character.md); do not assign a UFD donor unless the user requests one. |
| Appearance | Existing fighter appearance or custom identity; art direction is chosen per character, then kept consistent. |
| Reference form (custom UFD) | Keep the original form by default, or optionally adapt selected proportions toward the donor before locking the reference. Reuse the user's choice; follow [reference adaptation](references/animation-art.md#optionally-adapt-the-reference-form). |
| Delivery | Full implementation, scoped fix/audit, or generation handoff; preserve any explicit generation deferral. |

A custom appearance using a selected UFD fighter's kit remains **UFD-based**.
Its fidelity target is "recognizably the same moveset": the donor should be
recognizable from the actions and their execution despite different identity
and proportions. Preserve distinctive motion, rhythm, strike sequences and
special behavior alongside the move data. Apply the
[recognition checks](references/ufd-motion.md#retarget-the-motion-preserve-the-chosen-character)
without forcing the target into the source's body shape.
The selected source fighter determines whether it is armed, its equipment and
projectiles, and how each move uses, holds, stows or releases them. Extract those
facts from its UFD data/animations and supporting source evidence; do not ask
the user to redesign or reselect them. Custom appearance preserves that behavior.
Record explicitly requested equipment-behavior changes separately from the
body-geometry adaptation below. Original fighters define their equipment
through the original-character design workflow.
An original or deliberately mixed kit uses the original pipeline, with any
borrowed moves identified individually. An unavailable UFD page is a source gap,
not permission to change pipelines or fabricate values.

For a custom character using a UFD kit, fit animated hurtboxes to the target's
actual body shape and retarget contact geometry to its limbs/equipment. Different
proportions are expected and this workflow includes that geometry adaptation;
do not require another approval to fit the chosen character. Preserve sourced
move rules, timing, damage/launch, movement parameters and equipment behavior
unless their adaptation is requested. Record changes in reach and vulnerability;
copied attacks do not imply identical balance. Target proportions come from the
selected reference, including an optional adaptation toward the donor's form.
Exact donor proportions are optional; a visual match alone does not establish
identical collision geometry.
Use the [body-retargeting procedure](references/animation-art.md#retarget-collision-to-the-target-body).
Local ComfyUI is this project's preferred generator; an explicit user provider
choice overrides it. Selecting a provider does not cancel a generation deferral.

**Output:** record the chosen pipeline, source fighter/page, appearance,
fidelity target and delivery scope at the top of the evidence record.

## 2. Inventory the whole requested kit before producing assets

Read [source coverage](references/source-coverage.md) for UFD work, or
[original-character](references/original-character.md) for original work.
Inspect the existing fighter and relevant review records. Use
[the evidence template](assets/character-evidence.md) in
`docs/review/YYYY-MM-DD/<fighter>-character/README.md`, or continue its existing
record. Do not duplicate the same facts across competing inventories.

Create one action row for every applicable move/state/variant. Expand generic
headings such as "specials" into their actual actions. Include locomotion,
defense, grabs/throws, ledge/getup states, character-specific mechanics and
spawned objects. Account for every source entry. Mark genuine non-applicability
with a reason; an unsupported engine feature stays missing, not non-applicable.
Do not impose three jabs, four identical special templates or a fixed clip count.

For each action record: entry state/input, source or design target, timing and
branches, motion reference, pose/clip route, collision/events, and verification.
Keep these independent: source fidelity (**sourced/authored/approximate/missing**),
implementation status, visual acceptance status, and runtime evidence. A value
can be implemented and still approximate. A unit test cannot upgrade provenance.

**Gate:** no full-pack generation until the applicable inventory is explicit.
Unknown source values remain visible; investigate them without inventing zeroes.

Record target anatomy and source-to-target contact-part mappings for custom UFD
fighters, retaining source equipment and its behavior; original kits use authored
design. Include **no equipment** when true.
For each move identify the actual striking limb/object and equipment state.
An armed fighter can kick; an unarmed fighter can pick up an item. Weapon/grip
requirements throughout these references apply only where present: use explicit
non-applicability, not invented weapons or empty unexplained fields. Follow the
equipment contract in [animation and collision](references/animation-art.md).

## 3. Acquire mechanics and motion evidence

For UFD work, open the chosen character page, [stats](https://ultimateframedata.com/stats)
and [legend](https://ultimateframedata.com/smash). Record URLs, check dates,
native values and unit/frame conversions. Research missing input/engine rules
using primary material or reproducible measurements; the user need not teach
the agent rules that can be researched.

Read [move behavior](references/move-behavior.md) before choosing runtime move
kinds. Each applicable action/variant needs a movement and state contract;
simple actions may cite a reviewed shared profile. A generic impulse followed
by ordinary gravity is insufficient evidence for a source recovery move.

When a UFD animation exists, follow [UFD motion extraction](references/ufd-motion.md):
download the linked asset, extract it with the bundled helper, inspect the
frames, and map source image indices to gameplay frames and target poses.
Do this before finalizing sprite choreography or submitting generation.
Do not infer movement from an attack name or from startup/active/recovery counts.
Keep pending visual review explicit when preparing a deferred handoff. Identify
the particular GIF's attack/hurtbox overlays before tracing collision or preparing
pose guides; follow the overlay-reading procedure in that reference.

**Gate:** distinguish inspected evidence from proposed/inferred motion. GIF
delays and image indices are not automatically 60 Hz gameplay frames.
An unknown UFD total stays unknown. Last contact, powered-motion end, gravity
restoration, animation end and first actionable state are separate facts.

## 4. Define inputs, timelines and collision together

Read [animation and collision](references/animation-art.md) and the
[repository integration map](references/integration-verification.md).
Create the action specifications in the evidence template. Define state,
direction/facing, input edge/hold/history, buffer/transition windows and resource
conditions before wiring selection. Optional follow-ups, automatic multiple
hits and combos from hitstun/positioning are different mechanisms.

Include entry velocity, per-phase gravity and steering, phase clocks/exits,
legal cancels and external interruptions, destination states, resources and
restoration of ordinary physics. Use the movement/state fields in the evidence
template and the [behavior procedure](references/move-behavior.md). Record
ordinary shared physics explicitly where it applies; do not leave it implicit.

Use one fixed-step gameplay timeline for poses, hitboxes, hurtboxes and events.
Specify each active interval and empty gap, strike identity, charge hold,
projectile release, landing interruption and conditional continuation. Use the
chosen target dimensions and a common root/body/weapon coordinate contract.
Fit authored hurtboxes to the target's posed body and record retargeted attack
geometry separately from source data. Never derive damage or claim exact native
collision geometry from generated pixels.

Check the actual runtime's ability to represent the specification. Extend the
existing schemas/routing only as required, and carry new data through factory,
serialization, Lab and match. A sidecar JSON that runtime never reads is planning
data. Do not claim it implements explicit pose selection or animated hurtboxes.

**Gate:** every planned pose, collision region and event has a documented
runtime consumer or a concrete unresolved integration task.
Defining movement or exit behavior without supporting evidence remains a
required gap. Existing authorization may allow a clearly labeled calibration;
it does not establish exact source behavior.

## 5. Produce or prepare the art

- **Deferred:** complete [the generation handoff](assets/generation-handoff.md),
  including per-pose instructions, source-frame mapping, body/weapon anchors,
  output order, branches and checks. Do not call generators, request credentials
  or keep asking for a provider. Continue independently authorized work.
- **Existing art only:** inspect and verify the existing assets for the affected
  actions; record any mismatched motion or generic fallback as a gap.
- **Generate now:** use [ComfyUI generation](references/comfyui-generation.md)
  for the preferred local path. If another provider is explicitly selected,
  apply the same input/output/acceptance contract with its documented tools.
  Use the available imagegen skill when using its built-in or CLI workflow.

For generation now, first establish the character reference, scale and
representative attack pilot. During deferral, specify these future steps only.
Exercise a weapon arc and distinct multiple strikes if the kit contains them;
idle alone cannot qualify combat alignment. Once accepted, process the entire
inventory in reviewable batches. The agent owns pose guides, corrections,
transparency and packing; do not require the user to draw or repair assets.

**Gate:** accept images only after actual inspection of identity, anatomy,
motion, alpha, dimensions, root registration and collision agreement. Prompts
are requirements, not proof that the output met them. Stop unproductive retries
as specified in the generation reference and record affected rows accurately.

## 6. Integrate and prove the requested behavior

Follow [integration and verification](references/integration-verification.md).
Wire assets, routes, frame selection, render metrics, spawned visuals, roster
and authoring. Keep stage movement collision separate from damage-receiving
hurtboxes. Preserve compatibility for unaffected fighters.

For a full fighter, verify every applicable action row, with:

1. Type/schema and behavior checks, including real physics contact where needed.
2. Input boundary checks and frame-step inspection of start/contact/gap/recovery,
   both facings, hitlag/pause, branches, actual hits and misses.
3. Direct Lab entry, save/load and use of the saved fighter in a match.
4. A production build and browser checks against that exact build, including
   normal input routing, movement/defense, all move families and spawned objects.

For actions with their own movement, run the applicable
[movement and recovery scenarios](references/move-behavior.md#verify-the-behavior),
including recovery from a real launch, phase boundaries, steering, interruptions,
blocked cancels and landing/resource resets. Compare against independently
sourced expectations; passing the implementation's chosen values proves
execution of that calibration, not source parity.

Record expected versus measured outcomes, justified tolerances, commands,
screenshots and build identity. Exercise real keyboard/gamepad event routes;
injected state probes alone do not validate controls. Simulated gamepad evidence
must be called simulated. Human controller feel remains untested without a person.

## 7. Reconcile coverage and deliver honestly

Compare the source inventory with implemented actions, accepted visuals, runtime
routes and evidence. Every row must be accounted for; no "etc.", sampled move
family or shared fallback may hide missing requested behavior.

Full implementation is complete only when all requested applicable rows have
accepted visuals where needed and observed gameplay behavior, and no required gap remains.
Report calibrated approximations separately from exact source parity. Missing
art, failed generation, unsupported mechanics and unrun acceptance mean partial
delivery, even if tests pass. Continue authorized independent work when one
dependent part is blocked; do not silently substitute another fighter/provider.

A deferred handoff is complete only when all requested action/pose instructions,
required source-frame mappings (or explicitly chosen authored adaptations),
dimensions/anchors, branches and integration tasks are specified. Essential
pending motion inspection or pose decisions make the handoff partial. Provider
execution settings can remain deferred if the future provider is not yet known.
Assets and visual runtime acceptance remain deferred even with a complete handoff.
End with what was delivered, what was measured,
known approximations and concrete remaining work. Never label the process or
its generated fighter flawless on the strength of documentation or tests alone.
