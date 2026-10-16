# Build a fighter from Ultimate Frame Data

Use this reference when the requested mechanics come from a Smash fighter,
including a custom-looking character that inherits that fighter's kit. For an
original kit, use [original character](original-character.md) instead. A targeted
art or move fix covers the affected moves and dependencies; it does not require
an unrelated whole-roster or whole-kit rewrite.

## 1. Identify the source fighter and scope

Reuse the fighter, game, version and fidelity already chosen by the user or
established in the task. Do not ask for that choice again. If a donor fighter is
needed and cannot be inferred, present relevant choices from the actual
[UFD Ultimate roster](https://ultimateframedata.com/smash). Do not choose a donor
because its implementation is easiest to copy.

Default to Ultimate and UFD's currently published data unless the user specifies
another game/version. Open the selected fighter's actual page and
[UFD stats](https://ultimateframedata.com/stats). Record the game, stated version
when available, URLs and check date. A missing patch label remains unknown;
do not invent one or mix another Smash game's values into the Ultimate record.
[Link](https://ultimateframedata.com/link) is one example page, not the template
for every fighter.

Distinguish source gameplay identity from target visual identity. A custom
costume or name does not imply new mechanics. Inherit the selected fighter's
armed/unarmed behavior, equipment, projectiles, per-move contact parts, equipment
states and their timing. Populate these from the character's page, inspected
animations and supporting evidence. Do not ask the user whether this copied kit
should have weapons or choose replacements as routine art decisions.

Preserve equipment function and source attack/vulnerability roles and timing.
For a custom body, map source contact parts to target anatomy, fit hurtboxes to
that anatomy in each pose, and retarget attack geometry to its actual contact
limbs/equipment. Record changed body envelopes, reach and contact offsets as
geometry adaptations; this remains the UFD pipeline. Keep source timing,
damage/launch and movement parameters unless separately changed by the task.
Target dimensions follow the final selected reference: custom form, optionally
adapted toward donor proportions, or a chosen source-size replica/reskin. Keep
source observations separate from this target design choice.
If the user explicitly asks to add/remove equipment or change its function,
record the departure as an adaptation and resolve any resulting conflict.
Missing source details are research gaps; they do not become free design choices.

**Deliverable:** a scoped character evidence record using
[the evidence template](../assets/character-evidence.md), with source fighter,
target identity, game/version, intended fidelity and explicit exclusions.

## 2. Inventory the actual kit and its conditions

Read the fighter page, notes and linked visualizations before writing move data.
Expand the following families into individual moves, parameters and variants in
the evidence record. Record an unavailable feature as missing or out of scope;
do not silently omit it from a claimed full fighter.

For full Ultimate creation/completion, include the fighter's Final Smash when
one exists, even if UFD omits it or the engine has no activation system yet.
Inspect its game-specific technical/native data, resource acquisition and
activation, ground/air and hit/miss branches, capture/projectile/cinematic phases,
protection and cleanup. Exclude it only under an explicit user scope choice;
do not infer an "ordinary moveset only" scope from missing engine support.
Targeted fixes retain their affected scope.

| Family | Coverage to inspect when applicable |
| --- | --- |
| Ground movement | Walk, initial dash, run, acceleration/deceleration, friction, dash duration, turn/pivot and crouch |
| Air movement | Jump squat, short/full hop, air jumps and limits, air speed/acceleration, gravity, fall/fast-fall and landing |
| Ground attacks | Actual jab structure, rapid-jab loop/finisher, forward/up/down tilts, angled variants, forward/up/down smashes, charge and optional follow-ups, dash attack |
| Aerial attacks | Neutral/forward/back/up/down aerials, separate strikes and gaps, early/late or tip/body records, landing lag, autocancel and rebound/landing attacks |
| Specials and entities | Neutral/side/up/down specials; ground/air and charge variants; projectiles, traps, summons, counters, reflectors, command grabs, recovery, helplessness and landing |
| Grabs and throws | Standing/dash/pivot grabs, catch/hold/mash escape, pummel, four directional throws, release timing and victim attachment |
| Defense and recovery | Weight, shield/release/parry, spot dodge, forward/back roll, neutral/directional/diagonal air dodge, vulnerability windows, travel/landing, ledge options/regrab, getup/trip attacks |
| Character-specific rules | Command inputs, resources/meters/ammunition, item generation, stance/transformation, empowered states, conditional moves, self-damage, cancel rules and reset/stock behavior |
| Final Smash | Full Ultimate kit includes its Final Smash, shared availability/activation dependencies, distinct phases/variants, captures/projectiles and exit/reset behavior |
| Other requested states | Relevant pickup interactions, taunts with gameplay effects, requested cosmetic states and source environment/mode actions with explicit applicability |
| Per-hit and shared rules | Geometry/bone/region IDs/priority, damage, launch angle/base/growth/fixed knockback, target/situation masks, re-hit identity, hitlag/SDI, shield effects and any shared-system dependency |

Do not impose three jabs, one generic special, or a fixed sprite count on every
character. A source's `--`, `?` or missing value means unknown or inapplicable
as documented, never automatically zero. Keep **source checked**, **implemented**
and **runtime verified** separate, and mark calibrated/missing behavior explicitly.

For each move, record its required state/resource, button edge or hold, direction
and history, facing, transition conditions, resulting move/variant and source.
Use this naming guide to read UFD and map its moves into the existing input model:

| Context | Move category and common names |
| --- | --- |
| Grounded, neutral + Attack | Jab; subsequent chain or rapid-jab actions depend on the selected fighter |
| Grounded, direction + Attack | Forward/up/down tilt (`ftilt`, `utilt`, `dtilt`) |
| Grounded, directional flick + Attack | Forward/up/down smash (`fsmash`, `usmash`, `dsmash`); held charge only where supported |
| Running + Attack | Dash attack; distinguish actual running state from standing directional input |
| Airborne + Attack | Neutral/forward/back/up/down aerial (`nair`, `fair`, `bair`, `uair`, `dair`) |
| Special + neutral/side/up/down | Special family, then its ground/air/resource/charge branch |
| Grab, shield, ledge or knockdown context | The applicable grab, throw, defensive or recovery action |

This identifies move families; it does not prove native input thresholds or
priority. Forward/back aerials are relative to facing, not velocity. Left/right
on the ground does not imply separate forward/back tilts. A diagonal can select
a cardinal move, an authored angled variant, or a movement direction. Inspect
the actual fighter and input rule rather than inventing eight attack directions
or one diagonal-priority rule for normals, specials and dodges.

Preserve analog magnitude where required, and map digital keyboard controls
deliberately. Existing project thresholds and bindings are implementation facts,
not automatically native-game evidence. Keep established user control choices.

## 3. Establish timing and collision evidence

Use UFD and game-specific [SmashWiki](https://www.ssbwiki.com/) technical pages
together as the normal research path. Start with SmashWiki for technical
mechanics and shared gameplay systems. UFD supplies convenient frame summaries,
stats and motion visualizations; SmashWiki supplies additional per-region data,
vulnerability windows, branches, movement parameters and interactions where
documented. Neither is a complete specification of every engine algorithm.
Read the [joint source procedure](ufd-smashwiki.md) for acquisition, field-level
provenance, timing interpretation and disagreements. A published wiki value can
be sourced from SmashWiki without being relabeled approximate or UFD-derived;
retain its secondary-source status and any actual uncertainty separately.

Research remaining rules and unresolved disagreements using primary evidence:
official control explanations, versioned game-data captures, implementation
sources where available, or original reproducible measurements. Record scope
and conflicting values; do not choose whichever matches current code. A missing
wiki page is a coverage gap to research elsewhere, not a requirement to create
one or a reason to omit an applicable mechanic.

For script data, pin the repository revision and exact file. Existing reviewed
examples include the [vanilla Link script capture revision](https://github.com/WuBoytH/SSBU-Dumped-Scripts/tree/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link)
and [motion-list revision](https://github.com/WuBoytH/SSBU-Dumped-Motion-Lists/blob/3f14a9d46b69eb9e7cd622bddde459192848580e/fighter/link/motion/body/c00/motion_list.yml).
At that revision each fighter's scripts are one text file per motion under
`smashline/lua2cpp_<fighter>/<fighter>/` (for example `Attack11.txt`,
`SpecialN.txt`, `ThrowB.txt`; Donkey Kong's internal name is `donkey`). The
`game_*` function of each file gives, in order, `frame(N)` markers, `ATTACK`
records (id, part, bone, damage, angle, KBG, FKB, BKB, size, x, y, z, …,
hitlag, SDI, setoff, LR check, …, situation mask), `HIT_NODE(<bone>, XLU)`
intangibility, `damage!(… DAMAGE_NO_REACTION … MODE_ALWAYS/NORMAL)` pairs that
open and close super-armour windows, and `ATTACK_CLEAR_ALL`. Throws use a
short `ATTACK_ABS` form (damage, angle, KBG, FKB, BKB after the id) and apply
damage at `ATK_HIT_ABS`. `FT_MOTION_RATE` changes animation speed, so script
frames are motion frames; reconcile gameplay timing against UFD/SmashWiki and
verified motion-rate or measured mappings. Bone offsets on
`top` are root-relative (y up, z forward); other bones need the posed
transform and are placed from the inspected animation.
These are examples of pinned evidence, not a requirement to use Link data or an
assumption that an old capture describes every current fighter/version.

When transcribing Wiki wikitext, parse balanced templates and nested arguments;
a non-balanced template regex can retain a hitbox row while truncating all
fields after a nested damage template such as `ChargedSmashDmgSSBU`. Preserve
the raw row and resolve its base/charged damage expression explicitly. Inspect
required field completeness for every selected row, including fields after the
nested expression, before marking the transcription ready for runtime use.
Row counts alone cannot establish this. Unresolved required numeric values must
fail closed or remain source gaps; do not pass NaN/null or silently substitute
legacy move values. Preserve earlier derived snapshots when repairing a reader.

Reconcile units and clocks once, then keep both source and runtime values:

- UFD attack frames are one-based. Inclusive source frames `s` through `e`
  become elapsed half-open `[s - 1, e)`: frames 7-8 become `[6, 8)`.
- For ordinary attacks, startup is first active frame minus one. An active
  envelope may contain gaps; represent the individual contact windows rather
  than enabling one sensor throughout the envelope.
- Total duration, first actionable frame, cancel openings and landing flags are
  distinct facts. A move ending does not establish that its aerial landing flag
  has cleared. Do not add a hidden cooldown after sourced recovery.
- Charge holds, hitlag, animation motion counters and elapsed gameplay frames
  are different clocks. Script motion-rate commands or GIF playback durations
  cannot replace observed gameplay timing without a verified mapping.
- Record native units, world scale, root origin, screen-axis sign and facing
  convention. Measure movement at the fixed simulation step; distinguish
  acceleration, carried velocity, launch transport and gravity.

Before selecting a special's runtime kind, complete its
[movement and state contract](move-behavior.md). Inspect move-specific velocity,
gravity/control overrides and their phase/exit rules separately from ordinary
UFD character stats. A blank aerial total does not establish indefinite powered
motion; the final active frame does not establish a gravity cutoff. Record
mechanism, numerical parameters and phase boundaries with independent provenance.
Research required missing behavior and retain unknowns/calibrations explicitly.

Keep these mechanics distinct:

- **Follow-up:** another qualifying input advances to a linked action during
  an authored opening, such as a jab stage or optional second smash.
- **Multihit:** one initiated move automatically creates several contact
  windows. Separate hit groups permit intended re-hits.
- **Early/late or tip/hilt:** conditions of contact within a move, not extra
  button presses. Updating a region alone must not create an extra hit.
- **Combo:** separate actions connect because recovery, hitstun, launch and
  positioning permit them. Do not add a generic combo timeout or cancel rule.

Read the [UFD renderer legend](https://ultimateframedata.com/smash) before
interpreting its overlays. Images provide visual contact evidence; pixels do
not establish exact numeric radii, depth or bone transforms. Store numeric
region IDs, masks and launch records separately. Bone-local positions need the
matching animated transform before conversion to world geometry. Label static
2D projections, representative rectangles and authored anchors as adaptations.
Use [animation and art](animation-art.md) for source-motion extraction,
retargeting, pose keys and sprite/collision alignment.

**Deliverable:** per-move/state records with native values, source links,
conversions, conditions, unresolved questions and the intended local behavior.

### Parameter-to-consumer gate before calibration

Before selecting an approximate constant or declaring a parameter unavailable,
inspect the relevant retained fighter/item/common parameter captures, motion
lists and status/script records. Search native/internal names and related fields,
not just the public move name. For the affected fields, record the exact source
key/value and capture revision, units/conversion, local constant/consumer and
selected value. Compare this mapping with the proposed code before acceptance.

When a pinned repository index exposes the relevant fighter/article status
module, acquire and inspect its applicable init, main/loop, exec/stop, exit and
helper call closure before declaring a native caller unavailable. A file absent
from the local download is not evidence that the indexed source is missing.
Retain the tree revision, truncation result, acquired paths and bounded search
scope. Distinguish an opaque core notification from the status logic that calls
it: available contact masks, phase priorities and cleanup rules still apply
even when the notification's terrain or item consumer remains unrecovered.
Read decompiled branch results literally; an equality comparison followed by
a false-result branch executes the unequal case.

Keep **missing parameter**, **known parameter with missing native consumer** and
**implemented consumer awaiting verification** distinct. An unrecovered common
status function does not erase available speed caps, acceleration parameters or
motion-selection ratios. Use applicable known values rather than an arbitrary
replacement; when their use needs an adapter, record its inferred mechanism and
remaining uncertainty separately from the parameter's provenance. Field names
alone do not prove a formula, clock, unit or selection rule.

For a genuinely absent value, retain the bounded search and the reason for any
authorized calibration. A local test against a chosen constant cannot prove
native parity. If checks are deferred, leave runtime acceptance pending and
retain this source-to-code review; deferral does not make a missing source check
or a guessed value source-complete.

## 4. Implement and verify the evidence at its actual boundary

For numeric attack parity, enumerate every source hit/variant and compare its
damage, angle, BKB/KBG/FKB, set-weight flag, hitlag/SDI, shield damage and source
timing with the resolved runtime records. Also enumerate gameplay interaction
arguments: setoff/clank and facing checks, re-hit interval, trip probability,
collision/status attributes, direct/indirect contact, reflection/absorption,
flinch/hitlag flags, and situation/category/part masks. An omitted field matches
only when its documented runtime default matches the captured source value;
retain that comparison explicitly. Include early/late, body/tip,
ground/air, partial/full charge, angled normals, linking hits, pummels, throws
and recovery attacks. Preserve source region IDs and priorities. A move-level
default does not cover distinct per-region data. Source fields absent from the
schema require integration, not a zero or ignored metadata field.

Keep an exhaustive machine-readable comparison when the scope is all values;
test against independently captured source data and observe each attack family
in a running match. A missing variant must be implemented or reported missing,
never counted as matched because another variant has the correct numbers.
Numeric agreement does not establish identical animation, geometry or shared
physics. Do not claim complete Smash parity from a sampled move comparison.

For script-backed coverage, retain the birth, replacement and clear events for
each active region ID, including empty gaps. Compare those events with consumed
runtime windows, not just first/last contact or a count of matching records.
Separate scripts with motion-rate changes from rate-one event comparisons;
their raw motion frames require a verified gameplay mapping. A passing record
count must name the compared fields and clocks, so it cannot hide omitted
interaction flags or imply exhaustive native parity.

Follow [integration and verification](integration-verification.md) for current
code entrypoints and checks. Reuse existing schemas and simulation. First inspect
whether a required variant, pose sequence, animated hurtbox or source algorithm
is actually supported. A declared field, generated drawing, registered move or
editor preview does not establish that the live match consumes it.

For each changed interval `[a, b)`, check just before `a`, at `a`, at `b - 1`
and at `b`. Check the first actionable step, empty gaps, separate strike identity
and same-group one-hit behavior. Exercise follow-ups before/at/after their
opening and closing boundaries, buffer expiry, held inputs and single
consumption, including delays from hitlag or recovery.

Check both facings and relevant target ground/air states, regional priority,
edge misses, charge endpoints, landing/autocancel boundaries and resource/reset
branches. For movement and defense, compare measured travel and commitment with
the source record; matching one speed or duration is insufficient. Explain
tolerances using observed integration/contact behavior, not a widened assertion.

Retain known limitations until resolved: sprite routing may reuse artwork;
window-driven animation may repeat the same art on distinct strikes; hurtbox
selection and physical-body collision candidates may not cover animated limbs;
unsupported native algorithms may still be approximations. Inspect the current
implementation rather than treating these historical examples as permanent.

**Deliverable:** updated evidence linking expected values to actual runtime
measurements, art/collision inspection, build identity and remaining gaps. A
focused change reports its focused coverage; a full fighter accounts for every
in-scope inventory row.
