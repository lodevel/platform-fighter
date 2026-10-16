# Build an original fighter

Use this path when the user requests an original moveset without a Smash donor.
Do not ask them to choose a UFD fighter or silently copy one. A custom-looking
fighter with an explicitly chosen Smash kit instead uses
[source coverage](source-coverage.md). A mixed kit uses per-move provenance as
described below.

Keep the requested scope. A new fighter needs a complete applicable kit; an
art-only refresh or targeted move change preserves unrelated mechanics and
does not trigger a new kit-design exercise.

## 1. Establish the playable brief

Reuse the user's existing identity, visual references, gameplay preferences and
art schedule. Record the fighter's combat role, signature mechanic, intended
strengths/weaknesses, body proportions, equipment and visual style. Define body
dimensions independently of the weapon/cape, a simulation root, and the intended
world scale so later art and contact geometry share a reference.

Resolve only choices that materially affect the result and cannot be inferred:
for example melee versus projectile emphasis, a defining transformation, or
whether unusually long equipment should increase gameplay reach. Present a
small concrete choice when needed, then continue independent work. Determine
technical details such as engine APIs, thresholds, packing and export formats
from the repository; do not ask the user to design those systems.

When the brief leaves routine balance values open, author reasonable initial
targets that fit the stated role and label them as proposed design. The user
does not need to approve every numeric field before implementation. Preserve
their established controls and do not add unrelated features.

**Deliverable:** a short character brief and scoped
[evidence record](../assets/character-evidence.md) with authored-design status,
target dimensions, intended behavior and known open design choices.

## 2. Design the complete applicable kit

Inventory movement, jumps/landing, defense/ledges, grounded normals, five aerial
directions, specials, grabs/pummel/throws, getup actions and existing pickup
interactions. Include character-specific resources, entities, command inputs,
stances/transformations and state resets only when part of the design. Add
requested cosmetic states to the animation inventory. Explicitly record an
intentional omission; do not let a missing registry slot define the design.

Use the existing contextual input model: neutral Attack, directional tilts,
flick smashes, running attack, aerials relative to facing, directional specials,
and contextual grab/defense/recovery actions. Give each selected category a
clear role and a distinct appropriate motion. Do not require three jabs, force
every special into one generic animation, or invent a new diagonal attack for
every stick direction.

For every move and conditional variant, author:

1. Required ground/air/action state, resource and button/direction history;
   facing and diagonal selection, held charge or follow-up conditions.
2. Startup, each active interval, recovery, first actionable/cancel condition,
   and aerial landing/autocancel rules. Separate charge holds and hitlag from
   the normal elapsed action timeline.
3. Intended reach, body/weapon pose, attack and hurt regions, damage/launch,
   regional effects and hit-group identity. Define moving entities and their
   spawn, travel, ownership and cleanup when applicable.
4. An observable design outcome: for example the move threatens a short area
   above the fighter, trades reach for commitment, or links its own second hit
   against a specified target/setup. State the setup; do not promise universal
   combos or KO percentages from untested values.

Use the repository's fixed 60 Hz timeline. Write human-facing action records
with inclusive one-based frames and convert to the runtime's elapsed half-open
intervals explicitly. A displayed action frame is elapsed frame plus one.
Drawings may be held for many
simulation frames; neither a generator's output count nor clip playback speed
sets gameplay timing.

Keep follow-ups, automatic multihits, early/late or tip/body contacts and emergent
combos distinct. Preserve one hit group across a moving shape or damage change
unless the design intentionally permits a re-hit. Avoid a generic combo timer
as a substitute for authored recovery, hitstun and positioning.

**Deliverable:** a per-move/state design table with conditions, timings, geometry,
pose requirements and intended outcomes. These values are authored design,
not UFD or native-game facts.

## 3. Track any requested external inspiration explicitly

For a mixed kit requested by the user, tag each borrowed move or motion with its
donor character, game/version and exact reference. Use
[source coverage](source-coverage.md) for those sourced rows. State which parts
are preserved and which are adapted: motion inspiration does not imply copied
timing, damage, reach or collision.

Do not assign a donor to original rows merely to fill a source column. Use
`authored` for original design and `sourced` for checked external data. For a
deliberately changed sourced mechanic, mark source fidelity `approximate` and
describe the adaptation and its authored target in the adaptation column.
Keep missing evidence explicit. Combining individually sourced moves does not
establish that the
combined fighter is balanced or reproduces a native moveset.

## 4. Use the shared asset and runtime pipeline

Follow [animation and art](animation-art.md) for identity/motion references,
pose instructions, anchors, generation or deferred handoff, collision alignment
and sprite inspection. Original poses need the same root/anatomy and applicable equipment registration
and contact-boundary checks as sourced poses. Author geometry deliberately;
do not turn opaque sprite pixels into automatic damage regions.

Follow [integration and verification](integration-verification.md) for move
routing, schemas, assets, Lab/save-load and the live match. If the designed
behavior requires missing runtime support, implement the relevant shared
capability within scope and carry its data through authoring and verification.
Do not report a described mechanic or unused sprite pack as playable behavior.

Measure the intended outcomes against the authored design targets, including
startup/contact/gap/recovery, both facings, actual hits/misses, resource branches,
charge, landing and hitlag. Use those results to refine balance when authorized;
record any changed target and its reason. Keep implemented and runtime-verified
status separate from design and art readiness.

**Deliverable:** the integrated in-scope fighter or targeted change, supporting
evidence and explicit remaining gaps. If the user requested only a deferred
generation handoff, deliver those instructions now and leave assets/integration
accurately marked as future work.
