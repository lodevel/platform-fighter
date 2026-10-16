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
| Other requested states | Relevant pickup interactions, taunts with gameplay effects, and requested cosmetic states; mode-specific actions such as Final Smash only when in scope |
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

Use UFD as the main timing, stats and visible-motion reference. It is not a
complete specification of every input, launch or state-transition algorithm.
Research missing rules using primary evidence: official control explanations,
versioned game-data captures, implementation sources where available, or original
reproducible measurements. Record each source's scope and conflicting values;
do not choose whichever value happens to match current code.

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
frames are motion frames; take game-frame timing from UFD. Bone offsets on
`top` are root-relative (y up, z forward); other bones need the posed
transform and are placed from the inspected animation.
These are examples of pinned evidence, not a requirement to use Link data or an
assumption that an old capture describes every current fighter/version.

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

## 4. Implement and verify the evidence at its actual boundary

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
