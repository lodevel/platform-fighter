# Link animation and collision audit

Link already uses reference attack timing and a simulation-driven animation clock. The main remaining visual/collision gap is **where the body and weapon are on each frame**. Most moves still use one representative rectangle; the sprite selector distributes a small set of art frames over the attack's phases. Matching startup and recovery alone cannot make those poses and contact regions match the reference.

The new Lab frame inspection work makes the authored timeline reviewable: choose an elapsed frame, see whether contact is active, inspect that strike's geometry and values, and step through startup, gaps and recovery. It is an authoring inspection, not a recording of a live match. It does not reproduce projectile travel, moving special sensors, charge, rebound, target-dependent launches or native skeletal animation.

Open **Character Lab → Move Data**, choose a normal attack with Q/E, then click the timeline or use the **− FRAME / + FRAME** buttons or **comma / period** keys. Frame labels are one-based. Red intervals can hit; grey intervals are harmless gaps. The sprite and live geometry share the match scale and foot anchor, and the camera fit stays fixed while stepping. Cyan marks the physical body proxy, not native animated hurtboxes. **FIELD VIEW** returns to inspecting the selected editor field. Inspection does not modify or dirty the character draft.

The inspector registers sprite clips directly, so it works before entering a match. It shows the actual selected clip and pose count; reused clips remain visible as reused art. Its normal timeline excludes post-move cooldown and does not preview landing interruption or state-dependent hurtbox modifiers. Whole-move fit is calibrated for Link's square strips; non-square roster art can still slightly exceed the fitted bounds.

## Current Link coverage

This table describes the implementation in [Link.ts](../../../../src/characters/Link.ts), building on the [September 22 collision audit](../../2026-09-22/combat-parity/collision/README.md). Existing checks establish the implemented behavior; they do not establish complete Ultimate fidelity.

| Moves | Already implemented | Remaining animation/collision work |
| --- | --- | --- |
| Jab 1 and 2 | Static projected top-bone capsules; source-ID priority and different inner/tip launches. | Pose alignment and animated defending body. |
| Jab 3 | Two static top-bone circles. | Source sword-bone region ID 2 is explicitly omitted; it needs a trustworthy pose transform. |
| Forward air | Separate strike windows and top-bone circles; ground/air region selection. | Pose alignment; outer airborne first-hit angle 367 behavior remains an identified approximation. |
| Down tilt | Static diagonal top-bone capsule. | Weapon/body pose alignment. |
| Forward/up tilt and dash attack | Reference timing and representative launch records. | Animated sword/arm regions; forward tilt's first-frame overhead reach differs from its later forward reach. |
| Forward smashes | Separate attacks and follow-up timing; first swing has a rectangular tip sweet spot. | Animated sword/arm/torso regions and their individual records. |
| Up/down smash | Separate hit groups and front/back or linking/finishing records. | Animated regional geometry, including up-smash's reduced late regions. |
| Neutral/back/up/down air | Separate early/late or multiple-strike windows with appropriate hit identity. | Animated knee/weapon regions; neutral air currently represents the outer-knee record rather than every limb region. |
| Specials, grabs and throws | Special-specific runtime logic and reference work described in the existing audits. | Separate review of moving sensors, trajectories, poses and native details; the move-data inspector cannot validate these by itself. |

The shipped Link normal definitions do not author animated hurtbox poses. The runtime starts from a body-sized rectangle, with a crouched posture and optional phase-based hurtbox modifiers. See [Character.ts](../../../../src/characters/Character.ts) and [moveSchema.ts](../../../../src/characters/moveSchema.ts).

## How to author animation and contact together

The audit found a scale mismatch before any new pose work: Link's sprite is displayed inside a 75px-wide canvas, centred on his root, while jab 1's outer capsule reaches 99px from that root and forward air reaches 110px. Thus contacts can occur beyond the entire artwork canvas, even before inspecting the sword silhouette. The overlay uses the actual match display scale and anchors so this discrepancy stays visible. Calibrate body size, source-unit projection, sprite canvas, body anchor and weapon reach together; increasing the whole fighter's display size or reducing attack range independently would change other relationships.

The existing art also reuses forward tilt for up tilt/dash attack and one four-pose smash strip for all smash directions. Neutral/back aerial strips depict sword swings rather than the reference kicks. Timing a reused pose cannot reconstruct the missing motion. A game frame is a simulation step, not a requirement for a new drawing: one drawing can be held for several steps, while geometry follows authored motion tracks.

Keep the fixed simulation step as the only action clock. For a chosen elapsed frame, resolve the sprite pose, attack regions and defending regions from the same move timeline. Hitlag and pause must freeze that timeline; rendering must not advance it independently. The existing [simulation sprite driver](../../../../src/characters/simulationSpriteAnimation.ts) already follows this rule.

There are three distinct inputs to a move:

- **Timing:** startup, active intervals, recovery, landing flags and follow-up openings.
- **Pose:** which sprite frame or skeletal pose appears at each elapsed frame, including its body/weapon anchors.
- **Collision:** which attack and hurt regions exist at that frame, their geometry, IDs, launch records and hit identity.

[Ultimate Frame Data's Link page](https://ultimateframedata.com/link) supplies timing, regional descriptions and visual comparisons. The [renderer legend](https://ultimateframedata.com/smash) explains its hitbox display and priority rules. The [pinned script captures](../../2026-09-22/combat-parity/collision/sources/provenance.json) supply bone names, local positions, radii and attack records. Bone-local coordinates require the matching bone transform before they become world positions. An image or attack declaration alone does not provide that transform.

Use our own authored 2D poses and label their geometry as calibrated until a verifiable transform source exists. Align a few explicit pose keys with the visual reference, then resolve body/weapon anchors from those keys. If a native animation pipeline becomes available, it can supply the same resolved geometry contract without replacing the combat rules. Do not infer exact collision coordinates from sprite pixels or call an approximate pose a native transform.

### Reuse the existing hit windows

[AttackHitWindow](../../../../src/characters/attacks.ts) already accepts `collisionHits` per elapsed-frame interval. A moving swing can therefore use several adjacent windows, even one per simulation frame. Preserve the same `group` while the shape moves or its early/late damage changes; use a new group only when the move permits a fresh hit. The runtime already replaces sensors at window boundaries while retaining the shared confirmation identity.

Keep intervals sorted, non-overlapping and half-open. Human frame 1 is elapsed frame 0. A deliberate gap must contain no hit window. Changing groups accidentally can permit extra hits; adding gaps accidentally removes contact and changes presentation. The sprite driver's `windowAnimationPhase` merges adjacent active intervals and synthesizes recovery/anticipation inside gaps, so window edits must be inspected with the animation as well as with the collision overlay. Explicit pose keys should eventually replace that generic gap interpolation where a move requires a specific transition.

The existing capsule narrowphase and source-ID selection in [attackCollisionShapes.ts](../../../../src/characters/attackCollisionShapes.ts) can consume the resolved positions. Retain its mirrored coordinate convention, enclosing sensor bounds and selected-record behavior instead of adding a second collision implementation for the editor.

### Hurtbox work needs an additional runtime step

Current hurtbox modifiers select by whole attack phase, not individual elapsed-frame intervals. Animated hurtboxes need frame-aware selection and an explicit facing convention. The handler currently receives body-relative hurtboxes as already oriented; it does not mirror their X offsets itself.

There is also a detection limitation: [HitboxDamageHandler.ts](../../../../src/match/HitboxDamageHandler.ts) runs its precise tests after Matter reports a collision against the fighter's physical body. A future limb hurtbox extending beyond that body needs an encompassing collision sensor or an independent candidate check. Merely drawing or returning a larger hurtbox would otherwise miss contacts that never overlap the physical body. Keep stage movement collision separate from animated damage-receiving geometry.

## Suggested first authoring passes

1. **Jab 3:** compare its two existing circles with the missing sword region. This is a small example for aligning a weapon anchor while retaining existing timing and hit identity.
2. **Up tilt:** build a short overhead sword sweep. Check each frame's reach and confirm a moving shape cannot hit one target twice.
3. **Neutral air:** add leg/foot pose regions and preserve a single hit group across the early/late change. This exercises both visual alignment and regional damage.
4. Extend the same workflow to forward tilt and the multi-swing smashes; then tackle dynamic specials and animated hurtboxes with their additional runtime requirements.

The [reference audit script](../../../../tools/link-reference-audit.py) currently prints selected declarations and motion metadata. It does not compare complete geometry with runtime move data, resolve skeletal transforms or convert script motion counters into observed gameplay timing. A later importer should retain source IDs, bone names, full records and provenance, and report unsupported transforms rather than silently flattening them. [The earlier timing audit](../../2026-09-09/link-gameplay/reference.md) explains why motion-rate script counters cannot simply replace UFD gameplay-frame timings.

## Validation

Existing coverage includes capsule geometry and source selection in `attackCollisionShapes.test.ts`, real Matter delivery in `HitboxDamageHandler.collisionHits.physics.test.ts`, and the Link normal/launch integration suites. Relevant frame-authoring checks should verify empty gaps, start/end boundaries, same-group one-hit behavior, distinct-group re-hits, mirroring and pose freeze during hitlag. An inspection overlay is evidence of authored data, not evidence that every displayed region reaches the live collision handler.

The focused run passes **88 tests across four files**: `moveFramePreview.test.ts`, `simulationSpriteAnimation.test.ts`, `CharacterLabSession.test.ts` and `Link.normals.physics.test.ts`. TypeScript passes. The production build passes with artifact `index-00ylKCuL.js`.

The [browser report](browser/results.json) passes three grouped checks against that production artifact with zero page/load errors: forward-air contact/gap/second contact and fixed viewport; down-smash rear pose mirroring; and real keyboard/pointer frame controls. [Jab contact](browser/jab-contact.png), [rear smash](browser/down-smash-rear.png), [forward air](browser/fair-active.png) and [narrow viewport](browser/narrow.png) screenshots were inspected. The narrow shot establishes containment in the existing scaled canvas, not touch usability. The jab shot visibly confirms the reach mismatch described above.

WSL asynchronous reads initially broke Vitest/Vite loading, and asynchronous writes truncated generated bundles. Verification used temporary synchronous module-loading and file-I/O wrappers; the successful bundle sizes were checked before the production browser run. The wrappers were removed afterward and are not part of the game. No complete-suite rerun or human controller/balance acceptance is claimed.
