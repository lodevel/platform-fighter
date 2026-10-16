# Ultimate items: engine gap analysis (2026-10-11)

Read-only analysis of `src/items/`, `src/characters/Character.ts` (slot override dispatch) and
`src/scenes/MatchScene.ts` (item pickup, throw, flight, rendering) against the sourced spec in
`items.json` and `universal-rules.json` (same folder). No code was changed.

## 1. What the current framework does

| Concern | Current implementation | Files / symbols |
|---|---|---|
| Item contract | `ItemDefinition`: `type`, 4 project categories (`melee-weapon`, `ranged-weapon`, `throwable`, `effect-consumable`), `holdable`, `heavy`, `nativeThrow`, `pickupBounds`, `maxDurability`, `ttlFrames`, `brokenDespawnFrames`, `slotOverrides`, `buildSlotOverride`, `throwBehavior` (per-direction authored velocities), `attackMoves` | `src/items/ItemDefinition.ts` |
| Item use | Pickup registers `attackMoves` on the holder and installs one callback per declared slot via `Character.setSlotOverride`. On any attack press while overrides exist, `Character` runs the first of `jab`/`tilt`/`smash`/`fair` that accepts, whatever the stick, dash or air state is. So **every item has exactly one move**. | `src/items/Inventory.ts`, `Character.ts` ~9726-9740 (`attackPressConsumedByItem`), `execute<Slot>` hooks ~9153-9232, `contractFighter.ts` |
| Durability | Generic counter decremented per use, item marked broken at 0 (bat 5, sword 8, hammer 3, spear 3, ray gun 6, bomb 1) | `ItemEntity.consumeDurability`, every `build*SlotOverride` |
| Override callbacks | Six near-identical copies of the same "check durability, attemptAttack, consume, break" closure | `Bat.ts`, `Sword.ts`, `Hammer.ts`, `Spear.ts`, `RayGun.ts`, `Bomb.ts` |
| Pickup (non-DK) | `PickupController`: attack edge, nearest grounded item within a 64 px radius | `src/items/PickupController.ts`, MatchScene ~4598-4630 |
| Pickup (DK) | Separate native path: acquisition rectangles, stand/walk pickup actions, air catch windows, heavy pickup, repeat rules | `MatchScene.prepareDonkeyKongItemInput`, `commitDonkeyKong*`, `donkeykongItemActions.ts`, `donkeykongItemCatch.ts`, `itemAcquisitionBounds.ts` |
| Throw (non-DK) | Grab edge. Direction comes from a 0.4 stick threshold written inline in MatchScene, and velocity from the item's authored `throwBehavior`. No smash-throw strength, no dash throw, no Z-drop distinction. `ThrowController.tryThrow` is not used by MatchScene; its `resolveThrowDirection` (threshold 0.3) is only used by `RemoteBombAdapter`. | MatchScene ~5435-5515, `ThrowController.ts` |
| Throw (DK) | Native light throws (direction, flick strength, dash, Z-drop, drop) and heavy throws with release velocity from `nativeItemThrow` | `donkeykongItemActions.ts`, `donkeykongHeavyItems.ts`, `nativeItemThrow.ts` |
| Thrown item hits | **Two paths.** (a) Native profile (crate only): swept sphere vs posed hurtboxes through `resolveCombatHit`. (b) Every other item: AABB overlap, then `character.applyHit` **directly**, which bypasses `resolveCombatHit` (no shield or intangibility handling, no 1v1 multiplier, no hitlag or staling path). In path (b), any hit marks the item broken. | MatchScene ~5525-5660 |
| Item physics | Not Matter bodies. Spawned items fall 6 px per tick kinematically. Thrown items integrate `vy += 0.45` (or the native profile). Items land only on solid platforms. Items cannot be hit, pushed or rolled. | MatchScene ~5010-5130, ~5515-5660 |
| Spawn | `ItemSpawnManager` with frequency `off/low/med/high`: intervals 720-1200 / 360-720 / 120-300, field caps 1/2/4. The type is chosen **round-robin** (`nextItemType`). Crate joins the rotation only in DK matches. There is no per-item switch and no weighting. | `itemSpawnSettings.ts`, `ItemSpawnManager.ts`, MatchScene `nextItemType` ~1702 |
| Despawn | Per-item authored `ttlFrames` once grounded; broken debris lasts `brokenDespawnFrames` | `ItemEntity.shouldDespawn` |
| Rendering | Inline per-type branches in the spawn block (sprites in `assets/sprites/items/*.png`, rectangle fallbacks, crate drawn from rectangles). Held item at the hand anchor. Weapon rotation in `computeWeaponAngle`, a switch on move id. | MatchScene ~4850-5000, ~7341; `handAnchors.ts` |
| Body art | DK: one hard-coded map from three move ids to clips, plus an alias map. Pikachu: carry/pickup/throw presentation only. Other fighters: their own jab/tilt/smash clip. | `donkeykongBodyPresentation.ts` (`DONKEYKONG_ITEM_ATTACK_SHEETS`, `DONKEYKONG_PENDING_SHEET_FALLBACK`), `pikachuItemAttachment.ts`, `simulationSpriteAnimation.ts` |
| Determinism and replay | Spawn timing uses the `item-spawn` stream. Spawns are logged in `ItemSpawnEventLog` (replay file). No item runtime state is part of a rewind snapshot: `RewindController` exists, but no MatchScene wiring was found. | `ItemSpawnManager.ts`, `src/replay/ItemSpawnEventLog.ts` |
| AI | `simpleBot` reads the held item's `slotOverrides` to choose a button | `src/ai/simpleBot.ts` |
| 1v1 x1.2 | Exactly two players at start and items `off`. **Matches SmashWiki** (`universal-rules.json` `oneVsOne`). | `src/match/oneOnOneDamage.ts` |

## 2. What Ultimate needs (sourced) and what is missing

Values come from the spec files; "SILENT" means SmashWiki gives no Ultimate value.

### 2.1 Universal mechanics

| # | Ultimate rule (source key) | Status in engine |
|---|---|---|
| U1 | Battering items replace **neutral attack, forward tilt, dash attack and forward smash** with item swipes (`attackInput.battering`). Other tilts, smashes and aerials are SILENT (`batteringOtherTiltsAndAerials`), so the fighter's own moves stay. | **Missing.** One move for all inputs, and aerials are also hijacked through `fair`. |
| U2 | A battering forward smash can be charged, except the Home-Run Bat, which has one fixed 51-frame swing (`batteringFsmashCharge`, `homeRunBatFsmash`, items `home-run-bat.uses[fsmash]`) | **Missing.** The fighter smash-charge state (`chargingSmash`, `fireSmash`) exists but item moves never enter it. |
| U3 | A smash input while holding an item = **smash throw** (`attackInput.smashAttacksThrowItem`, series-wide scope), except the battering forward smash, which is the swing. | **Missing** for non-DK. DK has flick-strength throws on the grab button only. |
| U4 | Shooting items fire on **neutral attack and neutral aerial**, and can be used while running or jumping (`shootingFire`, `shootingMovement`; DK native `item_shoot_legs_*`). Turning while firing is SILENT. | **Missing.** The ray gun fires one grounded or air shot, with no walking or jumping upper/lower split. |
| U5 | Attacking with an empty shooting item **throws it**. An empty shooter is almost always dropped when hit (`base damage / 2`) and vanishes on ground contact (`emptyShootingItem`, `dropChanceEmptyShooting`). | **Missing.** The current item breaks in place. |
| U6 | With a throwing item, the attack button throws it (`throwingItemAttackButton`) | **Missing.** The test Bomb detonates in hand on attack. |
| U7 | Pickup: attack near the item. Light items can be taken in midair with grab. Auto-catch windows: 5 frames for air dodge, dash attack and aerial, 2 frames for tilts (`pickup.*`). Recovery items can be picked up while already holding an item. | Ground pickup exists for everyone. Air grab and catch windows exist for **DK only**. Recovery while holding: **missing**. |
| U8 | Throws: grab or shield+attack. Four directions. A stick tap gives a smash throw (also in midair). Dash throw. Z-drop with no ending lag. Only battering items, shooting items, Bomber and Special Flag can be dropped on the ground (others are thrown forward). Totals 24/24/23/23/19, dash 29. | Full for **DK only** (`donkeykongItemActions`). Non-DK uses the inline 4-direction toss with authored vectors. |
| U9 | Thrown damage = `d - 0.4 + speed*3`, with speed seeded from the toss table (light f/b 2.6, or smash 3.64 at 17°/11° ...) times toss strength `1 + (weight-100)/300`. Grounded drop halves `d`. Knockback x0.8 (Bob-omb exempt). Per-item factors and horizontal caps (`dropToss.*`). | Native formula exists (`nativeItemThrowHit`) but only the crate uses it. Other items use the AABB `applyHit` path. |
| U10 | Drop on hit: chance `ceil(base damage)/70` (`dropChanceWhenHit`) | **Missing** (DK heavy has a damage-drop path only). Needs a new named RNG stream. |
| U11 | Staling: only battering swings enter the stale queue. Thrown items and shots do not (`attackInput.staling`). | The thrown path passes `ignoreStaleMoves`. Item swings go through the normal move path. Needs a check that the stale key is per item action. |
| U12 | Heavy items (Crate, Barrel): ground-only pickup, no dash, no jump, no attack, slower walk, longer throw, four directions plus smash, no dash throw, no Z-drop. DK may jump and walk at normal speed, and gets small super armor (`pickup.heavy*`, `donkeyKongException`). | **DK only.** The crate is not spawned in non-DK matches, and non-DK heavy carry does not exist. |
| U13 | Spawn: Ultimate menu None/Low/Med/High with intervals Low 1200-1500, Med 500-800, High 300-500 (Very High 200-300, hidden). A random interval is drawn and counted up. Per-ruleset per-item switch. Cap of 64 items. Stage multipliers. Spawn weights SILENT. | **Wrong values** (720-1200 / 360-720 / 120-300, caps 1/2/4). Round-robin type choice, no item switch. |
| U14 | Idle items flash, then disappear. The timer is SILENT (`despawnWhenIdle`, `despawnTimer`). | Authored `ttlFrames`. Keep it, but label it as authored-silent. There is no flash warning. |
| U15 | Containers break from attacks or throws. 12.5% (1 in 8) explode instead of releasing items. A Capsule holds one item, never a Crate or Barrel. A Crate holds up to three of the same item. Capsules may appear inside barrels and crates. | **Missing.** Items cannot be attacked, and there is no contents or explosion logic. |
| U16 | Battering durability is SILENT. Ultimate battering items have no stated break count. | The generic durability counter must go for battering items. Ammo applies to shooters and Star Rod, uses to Banana Peel, time to Hammer and Fire Flower. |

### 2.2 Per-item mechanics

| Item | Ultimate behaviour needed (key numbers) | Engine gap |
|---|---|---|
| Home-Run Bat | jab 7, ftilt 13, dash 16, fsmash 30. Fsmash is a single uncharged swing with a 51-frame swing timing for all characters, an OHKO, and a reflector (reflect interrupts the swing at full power). Super armor and shield break are scoped to SSB4 only. Frame data, angles, BKB and KBG are SILENT. | Needs 4 per-input moves, a fixed-time fsmash, and a reflect hitbox on the swing (a reflect mechanic exists for fighter moves: check `reflect` support before building a new one). |
| Beam Sword | jab 4 (4.5 near base), ftilt 9, dash 8 (7 near base), fsmash 13-19.6 (charge range). Blade length per wielder is SILENT. | Per-input moves, fsmash charge, base/tip hitbox split (the existing `sweetSpot` covers this). |
| Star Rod | Stars on ftilt and fsmash only. Jab and dash are direct hits. 16 stars. When empty the rod still swings. Fsmash chargeable. All Ultimate damage values are SILENT. | Ammo plus a projectile spawned from a battering move. The existing projectile system (`specialKind:'projectile'`) can carry this if item moves may declare `projectile`. |
| Hammer | A timed lock state: auto-swing about 22% per hit with very high vertical knockback. The holder can walk and do one ground jump only: no midair jump, attacks, shield or specials. It cannot be dropped unless tumbling. 12.5% chance the head comes off on pickup (headless swings do nothing; the head is a throwable). Duration conflict: the same paragraph says 8 s and 7 s. | **New:** item lock state in `Character` (locomotion gates plus a looping attack), a timer in the item runtime, and a headless RNG roll. Native body clips `item_hammer_wait/move/jump`. |
| Golden Hammer | Same lock, with a 2x swing rate, diagonal knockback, and more damage and hitlag (numbers SILENT). Float by repeated jump (limit SILENT). Vanishes when dropped to the ground. Rare "Golden Squeaky" dud variant (chance SILENT). Grows from a podium before it can be picked up. | Same lock state, plus a float and a variant flag. Spawn podium growth (time SILENT). |
| Ray Gun | 16 shots, 5% each, vertical weight-independent knockback, one shot per 25 frames, infinite horizontal range. Walking while firing is stated. Empty: attack throws it. | Ammo, fire on jab and nair, a walking or jumping shot state (upper-body clip plus `item_shoot_legs_*`), the empty-throw rule, and a projectile that lasts until it leaves the blast zone. |
| Super Scope | 72 ammo. A tap fires 5 small shots (1% each, inferred). Hold to charge: stages 1, 4-10 cost 1/4/6/8/10/12/14/16 ammo for 1/7/10/13/16/20/24/28%. Run and jump while firing. Uncharged shots do not pierce. Charge time SILENT. | Rapid burst plus charge (reuse `chargedProjectile` from Samus-like charge shots), stage-cost ammo, walking fire. Charge time SILENT means the stage timing cannot be sourced. |
| Fire Flower | Hold attack to fire a continuous short-range stream, 7 s of total fuel. Run and jump while firing. Empty: thrown, cannot KO, burning hitbox. Per-flame damage and rate SILENT (SSB4 2.2% x 44 conflicts with the prose "44%"). | A hold-to-stream use (a repeating hitbox while held, with fuel draining per frame). **Blocked on values:** per-flame damage SILENT. |
| Bob-omb | Throwing item. Explosion 25%, throw 31.6% (dash and fsmash throws 33.5%). Explodes when thrown into a player, when hit by an attack (held or not), and when it walks into a player. A downward throw meteors. The explosion never harms the user. Ignores the 0.8 throw knockback multiplier. Horizontal cap 3. Idle-to-walk, walk-to-explode and held-fuse timers are all SILENT. | The item needs a receiving hit area (it can be attacked), a walking AI state, an explosion spawn with damage area, and timers. **Blocked on values:** all three timers SILENT. |
| Banana Peel | Throwing item. Thrown damage 4.1 (dash 5, utilt and fsmash throws 5.3 ...). A grounded opponent stepping on it is guaranteed a trip (slip, about 30 frames, scoped from SSB4). Lasts 2 slips and/or throws. The owner is immune. On a slip the peel flies a short distance sideways. Despawn SILENT. | Step-on trigger (trap-like contact), a soft trip (the engine only has the hard trip, `Character.ts` ~737), a use counter, and owner immunity. |
| Food | Pick up, then eat after a short hold. A flinch in that window drops it. Heal per food type (Ultimate column, 1 to 15%; 36 regular types). Recovery items can be picked up while holding an item. Spawn grouping SILENT. | `Character.healDamage`, an eat action, a per-type heal table, and the pickup-while-holding rule. |
| Heart Container | Heals 100%, gradually (rate SILENT). Not food. No flinch drop. | A gradual heal state (in the runtime snapshot). |
| Maxim Tomato | Heals 50% gradually. Damage taken during the heal is subtracted from the amount left (Melee rule, carried forward). | Same gradual heal, with the damage-subtract rule. |
| Crate | Heavy container. 12.5% explode. Up to 3 of the same item inside. HP, explosion damage, despawn and Ultimate thrown damage SILENT. Throw factors 1.6 / 0.7 / fall 2.2 / cap 2.4. Rolling Crate is a separate Ultimate item (out of scope). | Container contents and explosion, the item receiving hits, heavy carry for **every** fighter (today DK-only). |
| Barrel | Heavy container. A weak hit or a slope makes it roll. It breaks when it hits a fighter. Throw factors 0.8 / 0.6 / fall 2.5 / cap 3. HP, damages and contents SILENT. | Same as Crate, plus a rolling state. |
| Capsule | Light container. One item, never heavy. 12.5% explode. A thrower is not hurt by a capsule thrown downward (Ultimate). Ultimate damage table: fsmash throw 21 (explosion 53) ... Base 8, cap 4. HP SILENT. | Light container: break on throw or attack, plus contents and explosion. |
| Fan | **Not in Ultimate** (SSB, Melee and Brawl only; no `item_harisen` motion in either native list). | Drop it from the first pass (user decision). |

## 3. Test item to Ultimate replacement map

| Test item | Replacement | Action |
|---|---|---|
| `Bat.ts` (`item.bat.swing`, durability 5) | Home-Run Bat | Rewrite as a definition with per-input uses. Delete the override closure and durability. |
| `Sword.ts` (`item.sword.slash`, durability 8, tipper) | Beam Sword | Rewrite. Keep the base/tip `sweetSpot` idea for the 4 vs 4.5 split. |
| `Hammer.ts` (`item.hammer.smash`, 3 uses) | Hammer (timed lock) and Golden Hammer | Different mechanic: replace the file entirely. `Hammer.test.ts` must be rewritten. |
| `Spear.ts`, `Spear.test.ts`, `assets/sprites/items/spear.png`, `itemSpear` manifest key, spear entries in `computeWeaponAngle` and `fx/swingTrailFormat.ts` | none | **Delete.** Close the DK `item-spear-*` rows as not applicable. |
| `RayGun.ts` (`neutralSpecial` comment vs a `jab` override, 6 shots, 10 damage) | Ray Gun | Rewrite: 16 ammo, 5%, 25-frame interval, fire on jab and nair. |
| `Bomb.ts` (`item.bomb.detonate` in hand, consume on impact) and the MatchScene blast-kick block (~5370-5425) | Bob-omb | Rewrite as a throwing item. Delete detonate-in-hand and the bespoke kick code. Reuse the explosion art. |
| `Crate.ts` (DK-only rotation, native throw profile) | Crate | Keep the native throw profile, make it available to all fighters, add contents and explosion. |
| `RemoteBomb.ts`, `RemoteBombAdapter.ts` | **Keep.** This is not a stage item: it bridges **Link's down-special Remote Bomb** objects into pickup and throw (`Character.getRemoteBombs`, MatchScene `remoteBombAdapter`). | PLAN.md says "Remote Bomb has no counterpart, removed". Deleting it breaks Link's kit. Needs user confirmation; recommendation: keep it and route it through the shared throw path when that lands. |

## 4. Code paths to delete when they are replaced

The CLAUDE.md rule is to delete in the same change as the replacement:
1. `Character.slotOverrides`, `setSlotOverride`, `clearSlotOverride`, `clearAllSlotOverrides`, `getSlotOverride`, `runSlotOverride`, the first-override cascade (~9726-9740), and the `runSlotOverride` calls in every `execute<Slot>` hook (`Character.ts` and `contractFighter.ts`). These are replaced by the held-item move table (section 5).
2. `ItemDefinition.slotOverrides`, `buildSlotOverride`, `SlotOverrideContext`, `SlotOverrideFactory`, `maxDurability` (replaced by `ammo`/`uses`/`durationFrames`), `throwBehavior` (replaced by the Item_throw profile), and the 4-value `ItemCategory`.
3. The six `build*SlotOverride` closures.
4. MatchScene's inline non-DK throw (direction, vector, detach), `ThrowController` (or its replacement by the generalised planner), and the AABB thrown-hit path that calls `applyHit` directly.
5. `PickupController`'s 64 px radius, replaced by one acquisition rectangle function with a per-fighter default (`itemAcquisitionBounds.ts`).
6. `nextItemType` round-robin, and the DK-only crate rule.
7. The inline per-type spawn visuals and the `computeWeaponAngle` move-id switch, replaced by a per-item visual descriptor.
8. `DONKEYKONG_ITEM_ATTACK_SHEETS` keyed by test move ids, replaced by a per-use clip key on the item use. The sword-to-bat alias in `DONKEYKONG_PENDING_SHEET_FALLBACK` should be dropped once real sword strips exist.
9. The test-item entries in `simpleBot` (reads `slotOverrides`), `swingTrailFormat.ts`, `tools/bomb-explosion-regression.mjs`, the manifest keys (`itemBat` and others), and `assets/sprites/items/{spear,bomb,...}.png` once replaced.
10. Tests: `Spear.test.ts`, `Sword.test.ts`, `Hammer.test.ts`, the slot-override parts of `itemFramework.test.ts`, `integrationScenario.test.ts`, `itemAvailability.test.ts`, and `nativeItemThrow.test.ts` where it assumes crate-only use.

## 5. Proposed minimal architecture

One item contract, one dispatch decision, one throw path, one thrown-hit path, one acquisition path. It extends `ItemDefinition` and reuses the existing attack, charge and projectile pipelines instead of parallel systems.

### 5.1 `ItemDefinition` v2 (pure data)

```ts
type ItemClass = 'battering' | 'shooting' | 'throwing' | 'recovery' | 'container' | 'lock'; // 'lock' = Hammer/Golden Hammer
type ItemUseInput = 'jab' | 'ftilt' | 'dashAttack' | 'fsmash' | 'fire';  // 'fire' = jab+nair for shooters

interface ItemUse {
  readonly move: AttackMove;              // registered on the holder; runs the normal startup/active/recovery + hitbox path
  readonly charge?: ChargeSpec;           // fsmash charge -> existing chargingSmash/fireSmash
  readonly ammoCost?: number | ((chargeFrames:number)=>number);   // Super Scope stage costs
  readonly whileMoving?: boolean;         // shooters: upper-body use while walk/jump continues
  readonly hold?: { drainPerFrame: number };                      // Fire Flower stream
  readonly clip: string;                  // native motion key, e.g. 'item_bat_swing_3' (art lookup, fallback below)
}

interface ItemDefinition {
  readonly type: string;
  readonly itemClass: ItemClass;
  readonly weight: 'light' | 'heavy';
  readonly throwProfile: NativeItemThrowProfile;   // Item_throw factors (base mod, speed mult, throw-speed mult, fall, cap)
  readonly uses?: Partial<Record<ItemUseInput, ItemUse>>;
  readonly ammo?: { readonly count: number; readonly whenEmpty: 'throw' | 'swing' };
  readonly lock?: { readonly durationFrames: number; readonly swing: AttackMove; readonly allowGroundJump: true; readonly float?: {...} };
  readonly recovery?: { readonly heal: number; readonly mode: 'eat' | 'gradual' };
  readonly container?: { readonly explodeChance: 0.125; readonly contents: 'one' | 'upToThreeSame'; readonly explosion: AttackMove };
  readonly receivesHits?: { readonly hp: number | 'SOURCE_SILENT' };   // containers, Bob-omb
  readonly despawnFrames: number;        // authored: Ultimate SILENT, labelled as such
  readonly visual: ItemVisual;           // sprite key, size, ground anchor, held angle, per-use swing arc
  readonly sourceRef: string;            // items.json id; values carry provenance (sourced | authored-silent)
}
```

### 5.2 One dispatch decision in `Character`

Replace the slot-override map with `heldItem: HeldItemView | null` (definition plus runtime counters).
After the existing `classifyGroundedAttack` and aerial-direction resolution, call one pure function:

```ts
resolveItemInput(pattern, airborne, smashInput, item): 
  | { kind: 'itemUse'; use: ItemUseInput } // jab/ftilt(=forward tilt)/dashAttack/fsmash/fire
  | { kind: 'throw'; strength: 'normal' | 'smash' }  // throwing items on attack; any smash input except a battering fsmash; empty shooter
  | { kind: 'native' }                              // up/down tilt, aerials with a battering item, specials, dodge, shield
```

The rules come straight from `universal-rules.json`. Battering items map {jab, tilt-forward, dashAttack, smash-forward}. Up/down smash with an item is a smash throw (`smashAttacksThrowItem`). Shooters map {jab, nair} to `fire`, and only while ammo remains. Throwing items turn attack into a throw. Everything else is native. A `lock` item bypasses the function: the lock state owns the input. The function is unit-tested on its own and is the single source for `simpleBot` and the AI input synthesiser.

### 5.3 Item runtime (deterministic, snapshot-ready)

`ItemEntity` holds one plain serialisable record: `{ammo, usesLeft, lockFramesLeft, fuseFrames, walkState, healRemaining, headless}`. All counters are consumed in one place, when an item use starts (an event from `Character`), not inside per-item closures. New random rolls get their own named streams: `item-type` (weighted selection), `item-container` (contents and the 1/8 explosion), `item-drop` (hit drop chance), `item-hammer` (headless and squeaky rolls). The `item-spawn` timing stream is not reused for these.

### 5.4 One throw and drop planner for every fighter

Generalise `donkeykongItemActions` (direction, flick or smash strength, dash throw, Z-drop, ground-drop eligibility, aerial repeat rules) into `itemThrowActions` with per-fighter release frames. DK's sourced values stay as DK data, and the Item_throw totals 24/24/23/23/19/29 apply to everyone. Release velocity goes through `nativeItemReleaseVelocity` with the toss-strength table and `1 + (weight-100)/300`. All thrown items, including Bob-omb and Banana Peel, use the swept `nativeItemThrowHit` through `resolveCombatHit`. Delete the AABB path.

### 5.5 One acquisition path

`itemAcquisitionRectangle` is already shared. Give every fighter a default acquisition rectangle (DK keeps its native one). Then add the generic catch windows: grab in the air, and the 5-frame air-dodge, dash-attack and aerial windows plus the 2-frame tilt window. The pickup-while-holding exception for recovery items goes here too.

### 5.6 Items as world objects

Containers, Bob-omb and Banana Peel need a receiving area and contact triggers. Reuse the trap/projectile contact code (`activeTraps`, `sweptProjectileCapsuleEntry`) and follow the `add-spawned-object` skill: physics by default, rendered, damage area shown. Kinematic falling (6 px per tick) should become the same gravity integrator used for thrown items (`advanceNativeItemVelocity` with each item's falling speed), so there is one flight model.

### 5.7 Spawn

Use the `ITEM_SPAWN_FREQUENCY_TABLE` values from Item_Switch. Keep `off` as Ultimate "None" so `oneOnOneDamage` stays correct. Add a per-item switch to `MatchConfig`; it is recorded in replays and needs a replay migration. Use weighted selection on the `item-type` stream; weights are SILENT, so use equal weights labelled authored-silent. Raise the cap to the sourced 64, or keep an authored lower cap labelled as such.

### 5.8 Presentation

`ItemUse.clip` names the native motion. A fighter body resolver looks it up in that fighter's installed clips. Otherwise it falls back to the generic table in `art-needs.md` section 4. The DK-specific move-id map goes away.

## 6. Blocking silences (need a user decision: author a value and label it, or defer the item)

- Fire Flower: per-flame damage and hit rate.
- Bob-omb: idle-to-walk, walk-to-explode and held fuse timers.
- Hammer: duration (8 s vs 7 s on the same page), Golden Hammer damage, float limit and squeaky chance.
- Super Scope charge time; Star Rod damages (all of them).
- Crate and Barrel HP, explosion damage and contents odds; Heart and Tomato heal rate.
- All item frame data, angles, BKB and KBG except the Home-Run Bat 51-frame swing timing and the Ray Gun 25-frame fire interval.
- Idle despawn timers for every item, and spawn weights.

Native data (WuBoytH SSBU-Dumped-Scripts, already pinned in the DK record) holds most of these. Under the user's rules it can only be supporting evidence, so each such value must be labelled `native-derived (SmashWiki silent)` as the DK items audit already does.
