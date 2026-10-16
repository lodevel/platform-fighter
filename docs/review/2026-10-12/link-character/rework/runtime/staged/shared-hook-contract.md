# Shared runtime integration boundaries

Executable source-resolved drafts are now staged alongside this record, outside
the compiled tree. See leaf-status.json and adapter-policies.md for implemented
law, policies and remaining source gaps. No production integration or execution
checks are claimed. The coordinator owns publication clearance.

## Data versus match state

Keep per-fighter Final definitions separate from ordinary AttackMove slots.
The proposed authorable surface is a versioned top-level Final specification
on the character data record, with stable `LINK_FINAL_SMASH`,
`DONKEYKONG_FINAL_SMASH` and `PIKACHU_FINAL_SMASH` public exports if adopted by
the coordinator. Parser/factory/compiled-kit registry must consume that field
together. A legacy save omitting it needs an explicit baseline/version policy;
it must not acquire guessed data through an ordinary attack fallback.

Transient meter, Smash Ball eligibility, activation sequence, captured targets,
phase age and protection belong to match state. The Final controller exposes
serializable state and pure observations/events; Scene consumes events to
attach visuals, apply combat and alter source-required physics. Readiness is not
stored in permanent fighter templates. RNG state and sequence/capture IDs are
included in match snapshot/checksum/resync rather than inferred from UI.

## Actor observations and ownership

The controller observes slot index, actor identity and reset generation,
position/facing, legal grounded/air/action/protection status and source resources.
Duplicate Link/DK/Pikachu slots remain distinct participants. Capture links use
activation sequence plus actor/target reset generations, with explicit release
destination/resource state. Ordinary grab links are not an adequate implicit
representation for a Final that may capture multiple targets.

Character exposes source-driven final presentation/action/protection and
movement ownership observations. Scene must arbitrate Final input before
ordinary bomb/item/special handlers and preserve the raw sampled frame input
for replay. Existing Character input locks, ledges, shield/dodge/grab, attacks,
charge, held items and damage clocks are retired or retained only as specified
by the source activation/interruption contract.

One fixed-step source timeline drives body/receiving/outgoing geometry, article
events, protection and participant movement. Render/HUD/camera reads never
advance it. The actual physics coordinator may subdivide movement: source age
advances once per gameplay step, while post-substep participant placement and
contacts use the same committed pose/phase sample. Collision solver and visible
world positions cannot disagree during high-speed Final contact.

## Combat and resource receipts

Feed meter only from consumed combat receipts with unique strike identity and
the source-defined dealt/received basis. Existing stale/rage/1v1 modifiers and
shield/invulnerability/contact handling cannot be blindly reused or globally
disabled for Finals. The source contract must declare which modifiers, capture
eligibility, launch, hitlag and protection rules apply to each packet/phase.
Any new scoped combat context flags require parser/data/runtime evidence; a
constant copied into a sidecar is insufficient.

Initial contact, successful capture, failed activation/whiff and phase damage
are separate source outcomes. Consumption, target cap/arbitration, owner/self
hit and simultaneous Final availability remain unresolved until researched.
No universal cinematic instant-KO, hardcoded full-screen hit, cutscene damage
sum or every-fighter freeze is authorized by the plan alone.

## World state and lifecycle

Each article has one trajectory owner. Smash Ball cannot inherit generic
six-pixel item falling or held-weapon callbacks merely because it joins Item
Switch/catalog. Its flight/spawn/receiving/retirement/readiness comes from the
source article contract. Source states decide whether meter and Smash Ball can
coexist and what happens to an already-ready fighter's resource.

Activation/capture policies explicitly account for platform/hazard movement,
unrelated fighters, active projectiles, traps, healing, held/throwing weapons,
stage timer, camera bounds and world explosions. Retaining or freezing any of
them is a source rule, not an incidental early return from MatchScene.update.

Pause/disconnect and match-over guards currently precede the entire fixed-step
loop. Stock/respawn and shutdown already retire actor/items/articles later in
the loop. Integrate Final cleanup into those existing boundaries, preserving
source survival rules for uncaptured actors/world objects and restoring camera,
controls, collision filters, gravity and equipment once. Stale-generation events
must not damage or attach to a respawned participant.

## UI and CPU

Actual controller readiness/meter drives the indicator. Activation hints derive
the saved player's special binding if source admission uses that action;
remapped keyboard/gamepad profiles must stay truthful. The mode settings and
Item Switch are persisted in MatchConfig/replay, with migration/default policy
explicit. CPU submits the same legal input route and sees availability/phase;
no direct out-of-band auto-activation bypasses controls.

These boundaries can be implemented leaf-by-leaf as source contracts resolve.
The production gate remains current DK/Pikachu publication, and executable
validation remains the one complete end verification requested by the user.
