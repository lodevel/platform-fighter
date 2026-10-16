# Ultimate items: implementation phases

Inputs: `items.json`, `universal-rules.json`, `engine-gap.md`, `art-needs.md` (this folder).

DK rows: the 22 rows of `docs/review/2026-09-25/donkeykong-character/inventory.json` with `progress.blocked_by` = "weapons backlog (Ultimate-accurate items, all fighters)".

## Ordering principle

PLAN.md puts "delete test items" last (phase 5). The repository rule (CLAUDE.md) is to delete a replaced code path in the same change. So each batch below replaces a test item with its Ultimate counterpart and deletes the test item, its tests and its special cases in that same batch. Phase 5 then reduces to a final sweep.

## Every batch must pass

- **Tests**
  - `npm run typecheck && npx vitest run && npm run build` is green.
  - New pure modules have unit tests: `resolveItemInput`, the throw planner, ammo, timers, spawn table and heal.
  - Contact, launch and trajectory behaviour use `*.physics.test.ts` with a real Matter step.
- **Determinism**: a replay of a match that uses the batch's items re-simulates identically.
  - Every new timer or counter lives in the serialisable `ItemEntity` runtime record.
  - Every new random roll uses its own named `MatchRng` stream.
- **Production-match qualification**
  - Run `npm run preview` and a Playwright probe adapted from `tools/dk-rework-family-probe.mjs --family items-taunts`.
  - Use real keyboard input. Label any simulated analog stick as simulated.
  - Record the build identity (`SIMULATION_BUILD_ID`) and put the evidence under `docs/review/<date>/ultimate-items/<batch>/` (qualification.json + screenshots).
  - Each row is QUALIFIED, PARTIAL (with the reason) or NOT_APPLICABLE.
  - Run the Pikachu regression segment (idle/run/jump/jab) on the same build.
- **Visuals**
  - The item sprite is visible on the ground, held and thrown.
  - The damage area is shown (`add-spawned-object`).
  - DK: the expected native clip is selected.
  - Other fighters: the generic fallback (`art-needs.md` section 4) is visible.
- **Sourcing**: every gameplay number cites an `items.json` / `universal-rules.json` key. A SOURCE_SILENT value that the engine needs is labelled `authored (SmashWiki silent)` or `native-derived (supporting)` in code and in the batch record.

## Batch 0: decisions (no code; needs the user)

1. **Fan**: not in Ultimate. Recommend dropping it from the first pass.
2. **Remote Bomb**: this is Link's down-special object bridge (`RemoteBombAdapter`), not a stage item. Recommend keeping it, against PLAN.md's "removed".
3. **Silent values**: author-and-label them, or defer the item? Affected:
   - Fire Flower damage
   - Bob-omb timers
   - Hammer duration (8 s vs 7 s conflict)
   - Golden Hammer numbers
   - Super Scope charge time
   - Star Rod damage
   - container HP and explosion damage
   - heal rate
   - frame data, angles, BKB and KBG
   - despawn timers and spawn weights
4. **DK rows to re-scope**:
   - `item-hammer-*` (4): the Ultimate Hammer is a timed lock state, not jab/tilt/smash/air-use. Replace them with hammer wait/move/jump rows.
   - `item-bomb-*` (2): a Bob-omb is thrown with attack. Re-scope them to "attack throws" via the installed `item_throw_*`.
   - `item-spear-*` (3): close as not applicable.
5. **Aerials with battering items**: SmashWiki is silent, so these stay native. The DK inventory "air-use" rows assumed a user-requested item swing in the air. Confirm that the source rule wins.
6. **Item cap**: use the sourced 64, or keep an authored lower cap.

Effort: under 1 hour of user time.

## Batch 1: item framework core + Home-Run Bat (replaces Bat; deletes Spear)

- Add `ItemDefinition` v2 (`engine-gap.md` section 5.1).
- Add `resolveItemInput`, the held-item move table in `Character` and the item runtime record.
- Use the existing `chargingSmash` path for item fsmash charge.
- Home-Run Bat:
  - jab 7, ftilt 13, dash 16, fsmash 30
  - fixed 51-frame fsmash swing, no charge
  - reflect on the fsmash if the existing reflect mechanic supports it; otherwise PARTIAL with a reason
- Delete in this change:
  - the slot-override API and cascade
  - the six override closures (the other items move to v2 data in their own batches; until then they use v2 with their current numbers so nothing is left on the old path)
  - Spear (file, tests, asset, manifest key, angle/trail entries)
  - `item.bat.swing`
- Update `simpleBot` to read `resolveItemInput`.
- Acceptance:
  - Unit tests: input-to-use mapping for every pattern × item class.
  - The bat never runs on utilt/dtilt/aerials (native moves run).
  - The 51-frame swing.
  - Probe rows: bat jab/ftilt/dash/fsmash for DK (real keys); generic fallback for one non-DK fighter.
- Unblocks:
  - `donkeykong.item-bat-ground-tilt`, `donkeykong.item-bat-ground-smash`, `donkeykong.item-bat-dash` (DK clips are already installed)
  - closes `donkeykong.item-spear-ground-jab`, `-ground-tilt`, `-air-use` as N/A
- Effort: L (2-3 days).

## Batch 2: universal pickup, throw and spawn for all fighters

- Generalise `donkeykongItemActions` into one throw/drop planner for every fighter:
  - four directions, smash (tap) strength on the ground and in the air
  - dash throw, Z-drop, ground-drop eligibility
  - totals 24/24/23/23/19/29
- Use one release-velocity function (toss table, toss strength `1+(w-100)/300`, per-item caps).
- Use one swept thrown-hit path through `resolveCombatHit` (`d-0.4+speed*3`, ground drop halves `d`, knockback x0.8).
- Drop on hit: `ceil(dmg)/70` on the `item-drop` stream.
- One acquisition path, with a default rectangle per fighter plus air grab and the 5-frame / 2-frame auto-catch windows.
- Spawn:
  - Ultimate frequency table (1200-1500 / 500-800 / 300-500)
  - per-item switch in `MatchConfig`, with a replay migration
  - weighted selection on `item-type` (equal weights, authored-silent)
  - `off` stays "None", so the 1v1 x1.2 rule is unchanged
- Delete:
  - the MatchScene inline throw, `ThrowController` (or fold it in), the AABB thrown-hit path
  - the `PickupController` radius
  - `nextItemType` round-robin and the DK-only crate rule
  - the authored `throwBehavior` tables
- Acceptance:
  - Unit tests: throw planner per fighter and direction, damage formula against the Capsule/Banana Ultimate tables (e.g. Capsule base 8 gives 15.4 on a normal forward throw by a standard-toss fighter), spawn intervals, replay round-trip of the item switch.
  - Probe: Pikachu and one generic fighter throw in 4 directions plus smash, dash throw, Z-drop and air catch.
  - DK items-taunts rows re-run unchanged (no regression).
- Unblocks: no DK row directly. It is the prerequisite for batches 3-8.
- Effort: L (2-3 days).

## Batch 3: Beam Sword + Star Rod (replaces Sword)

- Beam Sword:
  - jab 4/4.5, ftilt 9, dash 8/7, fsmash 13 to 19.6 charged
  - base/tip split through the existing `sweetSpot`
- Star Rod:
  - jab/dash direct hits, ftilt/fsmash fire a star projectile, 16 ammo
  - keeps swinging when empty
  - damage SILENT, so use labelled authored values
- Delete `Sword.ts`, `item.sword.slash`, `Sword.test.ts`, and the sword-to-bat alias once DK sword strips exist (otherwise keep the alias, recorded as PARTIAL art).
- Acceptance: unit tests for the charge scaling endpoints and star ammo. Probe sword tilt, smash, charge and dash for DK, and star rod ftilt/fsmash star spawn with a visible projectile.
- Unblocks: `donkeykong.item-sword-ground-tilt`, `donkeykong.item-sword-ground-smash`, `donkeykong.item-sword-dash`, `donkeykong.item-sword-charge`.
- Effort: M (1-2 days) + DK art: 3 sword strips and 5 star rod strips.

## Batch 4: shooting items: Ray Gun, Super Scope, Fire Flower (replaces RayGun)

- A shooting use state: fire on jab and nair while locomotion continues.
  - Upper-body clip plus `item_shoot_legs_walk_f/b`, `_jump_squat`, `_landing`.
  - An empty item is thrown on attack, vanishes when it touches the ground, and has drop chance `dmg/2`.
- Ray Gun: 16 ammo, 5%, 25-frame interval, vertical weight-independent knockback, flies until the blast zone.
- Super Scope:
  - 72 ammo; a tap fires 5 rapid shots
  - hold to charge through the stage cost/damage table (1/4/6/8/10/12/14/16 ammo → 1/7/10/13/16/20/24/28%)
  - charge timing is SILENT, so it is labelled authored
- Fire Flower: a hold stream with 7 s of fuel. Per-flame damage is SILENT, so it is decision-dependent (batch 0) or deferred.
- Delete `RayGun.ts` `item.rayGun.shot` and `suppressFighterPose` special-casing for items.
- Acceptance: unit tests for ammo/charge costs and empty-throw. Probe DK walk-forward and walk-back while firing, jump squat and landing while firing (installed clips), scope charge levels, and the flower stream visible with its damage area.
- Unblocks: `donkeykong.item-raygun-walk-forward`, `donkeykong.item-raygun-walk-back`, `donkeykong.item-raygun-jump-squat`, `donkeykong.item-raygun-landing`.
- Effort: L (2-3 days) + DK art: 1 lgun upper, 19 scope, 7 flower.

## Batch 5: throwing items: Bob-omb, Banana Peel (replaces Bomb)

- Items as world objects, following the `add-spawned-object` rules: a receiving hit area, gravity flight, a visible damage area.
- Bob-omb:
  - attack throws it
  - explosion 25%, throws 31.6-33.5%
  - explodes on a thrown hit, when attacked, or on walking contact
  - meteors when thrown down, never hurts the user, ignores the 0.8 knockback multiplier, horizontal cap 3
  - walk and fuse timers SILENT (labelled authored or deferred)
- Banana Peel:
  - step-on soft trip (about 30 frames, SSB4-scoped)
  - 2 uses, owner immune, sideways slide on slip
- Delete:
  - `Bomb.ts`
  - the `item.bomb.detonate` blast-kick block
  - the bomb-specific branches in the thrown-items handler
  - `tools/bomb-explosion-regression.mjs` (replace it with a Bob-omb probe)
- Acceptance: physics test for the explosion launch and trip trigger. Probe: attack-throw in 4 directions, explosion visible, banana trip on an opponent.
- Unblocks: `donkeykong.item-bomb-ground-jab` and `donkeykong.item-bomb-air-use`, re-scoped to "attack throws the Bob-omb" (ground/air) on the installed `item_throw_*` clips.
- Effort: M-L (2 days).

## Batch 6: Hammer + Golden Hammer (replaces Hammer)

- An item lock state in `Character`:
  - locomotion gates: walk + one ground jump; no air jump, shield, specials or other attacks
  - auto-swing loop, timer, cannot drop unless tumbling
- Hammer: about 22% per hit, very high vertical knockback, 12.5% headless roll (`item-hammer` stream), duration per batch 0.
- Golden Hammer: 2x swing rate, diagonal knockback, float by repeated jump, vanishes when dropped, squeaky variant (chance SILENT), podium growth.
- Delete `Hammer.ts` `item.hammer.smash` and `Hammer.test.ts` (rewritten).
- Acceptance: unit tests for the lock gates and timer. Probe: DK hammer wait, move and jump with swings landing, headless variant forced by seed.
- Unblocks: the re-scoped `donkeykong.item-hammer-ground-jab`, `donkeykong.item-hammer-ground-tilt`, `donkeykong.item-hammer-ground-smash`, `donkeykong.item-hammer-air-use` (new hammer wait/move/jump rows).
- Effort: M (1-2 days) + DK art: 6 hammer clips.

## Batch 7: recovery: Food, Heart Container, Maxim Tomato

- `Character.healDamage` with a gradual heal state in the runtime snapshot.
- Recovery items can be picked up while holding another item.
- Food: eat action (hold then eat, flinch drops it), per-type heal table (Ultimate column).
- Heart Container: 100%, gradual, no flinch drop.
- Maxim Tomato: 50%, gradual, damage taken during the heal subtracts from the amount left.
- Heal rate is SILENT, so it is labelled authored.
- Acceptance: unit tests for the heal amounts and the damage-subtract rule. Probe: heal visible on the HUD, eat clip (DK/Pikachu once drawn, else fallback).
- Unblocks: no DK rows (new rows: eat).
- Effort: S-M (1 day) + art: 2 eat clips per fighter, food/heart/tomato sprites.

## Batch 8: containers + heavy carry for all fighters (Crate, Barrel, Capsule)

- Containers break from an attack or a throw.
  - 1/8 explode (`item-container` stream).
  - Crate: up to 3 of the same item. Capsule: one item, never heavy.
  - Capsule thrown down does not hurt its thrower.
  - HP and explosion damage SILENT except the Capsule table.
- Barrel rolling state.
- Heavy carry for every fighter: ground pickup only, no dash/jump/attack, slow walk (speed SILENT), four throws plus smash.
- DK keeps jump, normal walk and super armor, plus a speed-linked `super_lift_walk_slow/middle/fast` gait selector (thresholds native-derived).
- Delete: the DK-only crate gating, and the crate rectangles visual (replaced by a sprite).
- Acceptance: physics tests for container break/contents and barrel roll. Probe: Pikachu and a generic fighter carry and throw a crate; DK slow/middle/fast gaits.
- Unblocks: `donkeykong.heavy-super-lift-walk-slow`, `donkeykong.heavy-super-lift-walk-fast`.
- Effort: L (2-3 days) + art: crate/barrel/capsule sprites, Pikachu heavy set (11 clips or 7 + aliases).

## Batch 9: Pikachu item art + DK remaining art

- Pikachu: add a clip plan, then generate the 68 required clips in the order the engine batches land (bat → sword/star → shooters → eat → heavy), each with `Have` socket samples.
- DK: the remaining missing clips (`squat_wait_item`, `landing_heavy`, the optional hand poses).
- Generic fallback table for the other 11 fighters (if not already landed with batch 1).
- Acceptance: per-clip qualification rows in the Pikachu and DK records (feet-vs-floor, socket alignment, native ages).
- Effort: XL, art-pipeline bound (ComfyUI, 8 GB GPU). Roughly 1-2 clips per hour, so DK 45 and Pikachu 68 come to several days.

## Batch 10: sweep

- Grep for any remaining test-item ids and assets.
- Update `.claude/skills/add-weapon/SKILL.md`. It documents `buildSlotOverride`, a single `type` move, `computeWeaponAngle` and art for every roster fighter. All of that is superseded: the per-input `uses`, the per-item visual descriptor, and DK + Pikachu art with a generic fallback. **Requires user approval**, since it is a skill file.
- Update `docs/PROJECT-ROADMAP.md` and the DK record (`REWORK-2026-10-10.md`, `inventory.json` `blocked_by` cleared per row with links to the batch evidence).
- Effort: S.

## DK blocked-row map (22)

| Row | Batch | Outcome |
|---|---|---|
| item-bat-ground-tilt, item-bat-ground-smash, item-bat-dash | 1 | qualify (clips installed) |
| item-spear-ground-jab, item-spear-ground-tilt, item-spear-air-use | 1 | NOT_APPLICABLE (Spear deleted) |
| item-sword-ground-tilt, item-sword-ground-smash, item-sword-dash, item-sword-charge | 3 | qualify (`_4`, `_4_hold` installed; `_3`/`_dash` alias until own strips exist) |
| item-raygun-walk-forward, item-raygun-walk-back, item-raygun-jump-squat, item-raygun-landing | 4 | qualify (shoot-legs installed) |
| item-bomb-ground-jab, item-bomb-air-use | 5 | re-scope to Bob-omb attack-throw (batch 0 decision) |
| item-hammer-ground-jab, item-hammer-ground-tilt, item-hammer-ground-smash, item-hammer-air-use | 6 | re-scope to hammer wait/move/jump (batch 0) + 6 new DK clips |
| heavy-super-lift-walk-slow, heavy-super-lift-walk-fast | 8 | qualify (gait selector; clips installed) |

Total engine effort for batches 1-8 is about 13-18 working days. Art (batch 9) runs in parallel after batch 1 and is the critical path for Pikachu.
