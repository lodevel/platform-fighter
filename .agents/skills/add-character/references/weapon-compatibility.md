# Weapon and item compatibility

Read for full fighter creation/completion, an item compatibility audit, or a
targeted pickup/weapon fix. A fighter's own equipment and projectiles are separate
from the shared pickup system. An unarmed fighter still needs supported pickups;
a scoped character fix does not require rebuilding unrelated item families.

## Derive coverage from the current repository

Inspect `src/items/itemCatalog.ts` (`ITEM_SPAWN_TABLE`), item definitions and the
current item implementation/qualification records. The catalog is a spawn list,
not proof that every entry is finished. Reconcile it with the requested scope and
`docs/review/2026-10-11/ultimate-items/PLAN.md` and its linked specifications.
Keep unfinished shared behavior and requested future items as named gaps rather
than assuming catalog registration, generated art or a plan means support.
Do not reintroduce removed test weapons or treat intrinsic special-move objects
as universal pickups. Preserve the session's active roster and item-switch choices.

Add explicit item/action/context rows to the fighter's existing evidence ledger.
Items may share qualified motions, but each item needs its applicable grip,
input, release/projectile and contact checks. Record genuine non-applicability
with a source/design reason; missing engine support is not non-applicability.

| Family | Applicable fighter support and acceptance |
| --- | --- |
| Shared pickup/hold/throw | Standing/walking pickup; hold through movement and defense; directional ground/air ordinary and strong throws, dash throw and drop where supported; pickup/release callbacks, back-turn timing, catch range and toss profile |
| Battering weapons | Each mapped jab/tilt/dash/smash use; distinct swing grips/arcs and contact phases; unmapped native attacks and item-throw inputs; charge or projectile events where present |
| Shooting weapons | Startup/fire/end and weapon-specific rapid/charge/loop states; ground/air entry; forward/backward walking, jump/landing legs where supported; ammo depletion and empty-weapon throw |
| Hammer variants | Actual loop/contact phases, moving/airborne body, grip/head trajectory and variant-specific states/effects; permitted controls, forced lockouts and expiry/interruption cleanup |
| Throwable hazards | Held, released, armed/triggered and spent states where present; one ownership handoff, correct throw/drop behavior, actual contact and retirement |
| Healing items | Standing/walking consumption where supported; acquisition/consume event, independent healing timing, damage cap, presentation exit and interruption behavior |
| Heavy items/containers | Source/design-specific acquisition, carry gait and restrictions, directional release, settlement and applicable container interactions; expose pending shared support |

Inspect the current consumers before adding support: `ItemDefinition.ts`
(`itemUsesFor`), `resolveItemInput.ts`, `itemActions.ts`
(`FIGHTER_ITEM_PROFILES`/`fighterItemProfile`), `itemShooting.ts`, the relevant
item definitions, `Character.ts`, `spriteAnimationDriver.ts`, `handAnchors.ts`,
`upperBodyLayer.ts` and `MatchScene.ts`. Audit fighter-ID branches, manifest/frame
registration and fallback paths. Compiling through a default profile or showing
an ordinary attack clip does not qualify a new fighter's item behavior/art.
Use the selected fighter's sourced item motions and profile, or explicit authored
adaptations for an original/custom fighter; never silently copy DK's release
frames, torso dimensions or grip coordinates. Shared item damage/ammo rules stay
in the item system rather than becoming fighter-specific replacement attacks.

## Register the body, grip and projectile together

Record body/root, hand/grip, item base/tip or muzzle and, for split shooting art,
the anatomical join for each selected pose. Qualify the actual forward/backward
walking, startup/wait/fire/end, airborne and landing combinations in both facings.
A common sprite origin does not guarantee matching waist positions.

Check each applicable fighter/clip's attachment data against independently
inspected native/art grip anchors and its actual root/scale/facing transform.
Report the covered clips/poses and missing samples. Agreement between the held
renderer and `getHeldItemSocket` only proves that both use the same socket;
they can agree exactly on a static fallback that never follows the drawn hand.
Zero independent samples cannot qualify attachment for that fighter or family.
When tests are deferred, record the fallback/unverified rows instead of promoting
co-location to source or visual acceptance. Keep held/free item root-to-centre
conversion consistent in rendering, receiving, release and explosions.

For projectile emission, register the muzzle against the actual selected item
sprite/canvas, displayed world dimensions and item root. A sourced Have bone or
held axis establishes the attachment basis, not the item muzzle. Apply the same
held-sprite facing, scale and rotation once, then translate by the solved actor
root. Label an authored emission point when no native model marker/caller was
recovered; preserve charged multipart spread in its declared coordinate space.
Seal each ammo-paid fire callback to its actual item/session, generation and
paired pose before contact can replace that pose. A same-step hit/capture must
not borrow a later drawing or lose an already accepted callback; reject stale
callbacks instead of retrying against a new owner or respawn pose.

For layered shooting, inspect upper and lower source clocks and per-pose join
anchors. Join at the actual torso/hip rather than a whole-sprite bounding-box
centre: tails, raised knees and extended arms can bias that centre. Preserve
the intended source lean; alignment does not mean forcing every pose upright.
Keep uniform character scale. Apply any join translation consistently to the
upper drawing, attached weapon and projectile origin, using the same committed
pose/clock sample as the match. Verify the shot's actual spawn position after
physics and presentation clocks advance, not an earlier cached sample.

The [Pikachu moving-shooter qualification](../../../../docs/review/2026-10-12/pikachu-shooting-alignment/qualification.json)
demonstrates per-drawing registration. Its native Hip/torso anchors and pixel
offsets are fighter-specific evidence, not defaults for every new character.

## Verify in the match

Use normal keyboard/gamepad event routing on the recorded production build,
with deterministic stepping for boundary measurements. Observe the classified
input and legal grounded/airborne state before interpreting a failed check.
In particular, a digital direction flick plus attack from rest can mean a
smash throw, not shooting. Construct a valid firing entry and retain accidental
throw/probe failures as fixture evidence rather than changing the planner to
make an invalid test pass.

- **Turn then fire:** after the previous shooting action ends, reverse direction
  and fire immediately, including during unfinished turn art and at zero/one-step
  input gaps. Check fighter/session facing, upper/body sprite orientation and
  actual projectile direction/velocity. New ground shots use the direction
  resolved for that entry step, not a stale pre-turn facing. Separately verify
  the current session's committed aim while walking backward; do not conflate
  entry direction with permission to retarget an existing charge/burst. Preserve
  the distinct aerial-relative attack rule. Include empty-weapon throws.
- **Moving composition:** inspect complete action playback and boundary frames
  while walking both ways, charging/firing, jumping, landing and changing phases.
  Measure the join/grip/muzzle under actual origin, scale and flips; inspect clean
  screenshots as well as numeric traces. Check actual hit and miss/contact where
  the item attacks, including variant-specific hammer and battering trajectories.
- **Charge feedback:** charging weapons and fighter attacks need readable live
  load/charge status, including startup, partial/full charge and ammo limits where
  applicable. Use actual active/stored charge state; ordinary attack startup must
  not masquerade as charge. Keep indicators above visible art at useful screen
  size across camera zoom, and clear them at the appropriate release/exit/reset.
  Verify allowed and blocked shield/jump/attack cancels against the sourced or
  explicitly authored contract; a missing cancel is not automatically a bug.
- **Ownership and exits:** check pickup/consume/release events, rendered object
  ownership, damage/contact, depletion, damage/capture interruption, stock/reset
  and timeout/expiry as applicable. An item should neither duplicate nor remain
  attached after its release. Distinguish presentation exit from ongoing healing
  or other resource effects. Include freeze/resume for affected action clocks.
- **Presentation:** for this project's current play view, keep diagnostic damage
  shapes behind the debug toggle (currently F3) and avoid decorative attack rings.
  Verify diagnostics off by default, opt-in inspection and toggle cleanup; retain
  gameplay collision and actual projectile/effect artwork.

The [turn-and-fire regression](../../../../docs/review/2026-10-12/shooting-turn/qualification.json)
and [charge-status qualification](../../../../docs/review/2026-10-12/charge-status/qualification.json)
provide observed cases and adaptable harnesses, not automatic coverage for
another fighter or proof of exact native-game behavior. Preserve source versus
authored labels, inspect the harness assumptions and record the newly measured
build identity. Unit tests, motion metadata and a readable charge bar do not
replace these match checks or establish human controller feel.
