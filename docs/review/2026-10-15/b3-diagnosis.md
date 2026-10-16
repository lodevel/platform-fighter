# B3 phase A: Link defence/ledge diagnosis and the Character.ts collapse plan

Date: 2026-10-15. Phase A scope: diagnosis and tests only. **Phase B part 1 is done**: steps 1, 2 and 11 are
finished (see "Phase B part 1 — done" below). Part 2 waits until A4.2 releases the files. `Character.ts`, `FreshLink.ts` and `MatchScene.ts` were
**not edited**. Another agent (A4.2) is editing them now.

**Line numbers.** `C:` and `FL:` refer to a frozen snapshot taken at the start of this run:
- `Character.ts`: sha256 `b9e85fdd…f14c`, 14,488 lines.
- `FreshLink.ts`: sha256 `9458f8f7…a64`.

The live files have already moved by a few lines. Phase B re-anchors each edit on the method or the quoted
code, not on the number. Other files are cited at their live line numbers as of 2026-10-15 01:00.

## 1. Tests written (all expected-failing cases fail for a stated cause)

File: `src/characters/linkDefenceLedge.physics.test.ts`.
- The lowercase name is not matched by the roster-mask glob, so the default config runs it:
  `npx vitest run src/characters/linkDefenceLedge.physics.test.ts`.
- It uses a real Matter world built the same way as `Character.referenceLocomotion.physics.test.ts`.
- DK and Link are built through `instantiateFighter`, so each gets its registry class.
- Both fighters get **identical** `CharacterInput` sequences.
- Every expectation is that fighter's published value. Sources are cited in the file header.

**Current result: 37 passed, 12 failed (49).**

| Area | DK | Link | Source asserted |
|---|---|---|---|
| Shield-chord input contract (resolver plus Character) | pass | pass | `defaultDodgeResolver` |
| Spot dodge, forward roll, back roll (duration, intangibility, travel) | pass | pass | UFD: spot 26 total, intangible 3–17; forward roll 30, 4–15; back roll 35, 5–16 (both fighters) |
| Neutral air dodge | pass | pass | UFD: DK 48 total, 4–32; Link 49 total, 3–30 |
| Shield depletion 0.15/frame, drop 11 frames | pass | pass | SmashWiki Shield; UFD "Shield Drop 11 (universal)" |
| Shield breaks after ceil(50/0.15) frames | pass | pass | SmashWiki Shield |
| Shield jump: launched upward and intangible while rising | **FAIL** | pass | SmashWiki Shield break / Shield jump |
| 400 − p stun after the landing knockdown, then the wake-up animation, then 37.5 HP | **FAIL** (no wake-up) | pass | SmashWiki Stun; native `furafura_end` |
| Ledge catch from a fall with the body against the wall | pass | pass | — |
| Hang actionable on catch frame 20 | pass | **FAIL** (frame 19 accepted) | native `cliff_catch` cancel 20 (DK and Link rows identical) |
| Ledge get-up: 34 total, intangible 1–33 | pass | **FAIL** (28 total) | UFD Ledge Stats |
| Ledge roll: 45 total; intangible 1–28 (DK) / 1–26 (Link) | pass | **FAIL** (36 total) | UFD Ledge Stats |
| Ledge jump: intangible 1–12 | pass | **FAIL** (2–13) | UFD Ledge Stats |
| Ledge attack: 55 total; intangible 1–25 (DK) / 1–22 (Link); ends standing on stage | pass | **FAIL** (falls off the stage) | SmashWiki DK and Link (SSBU) Edge attack |
| Trip: `slip_down` intangible frames 1–5 | **FAIL** | pass | native `slip`/`slip_down` xlu 1..6, identical rows |
| Trip stand: intangible 1–16, actionable from frame 22 | **FAIL** (1–22, actionable at 30) | **FAIL** (1–14, actionable at once) | native `slip_stand` xlu 1..17, cancel 22 |
| Trip attack reachable | pass | pass | — |

Sources:
- `docs/review/2026-10-12/link-character/rework/sources/ufd/{moves.json,stats.html}`
- `…/sources/native/{,donkey/}motion_list.yml`
- `…/sources/shield-break-phases/wiki-capture.json`
- `…/sources/wiki-move-captures.json` (Link Edge attack)
- the DK UFD page in `docs/review/2026-09-25/donkeykong-character/…/ufd-donkey_kong.html`

## Phase B part 1 — done (2026-10-15)

`Character.ts`, `FreshLink.ts` and `MatchScene.ts` were not touched.

**Coordinator rulings:**
- Source priority is SmashWiki > UFD > native.
- Ledge-roll intangibility therefore follows UFD (Link 1–26), because SmashWiki gives no value.
- Wall and ceiling tech become **one shared path** (step 6b).

**Step 1 — Link ledge data and a single Link movement profile.**
- `linkFreshMovement.ts` now has a `ledge` block:
  - catch 19, climb 34, getup intangibility 33, roll 45 / 26, jump 12;
  - Ultimate regrab penalties and option scaling;
  - `attackProtectionFramesByGrab`, derived from `linkAttackData.json` as `intangibleUntilByGrab − 1`, which
    gives [22,18,11,0].
- Every value is cited in the file.
- The duplicate `LINK_MOVEMENT_PROFILE` block in `fighterMovementProfiles.ts` is deleted. That module now
  imports and re-exports Link's one profile, the same pattern as Pikachu's.
- The two profiles disagreed on five fields. The single profile takes the sourced value for four of them,
  which changes Link in matches:

  | Field | Before (in-game) | Now | Source |
  |---|---|---|---|
  | `fastFallSpeed` | 2.56 (uncited) | **3.04** | SmashWiki and UFD |
  | `softLandingFrames` | 4 | **2** | UFD |
  | `hardLandingFrames` | 6 | **5** | UFD; SmashWiki "empty landing lag 5" |
  | `dashDanceWindowFrames` | 14 | **12** | UFD `dashFrames` |

  `groundAccel` keeps the native-derived 0.65835. The deleted block had an uncited 0.66.
- `Character.referenceDodge.physics.test.ts` updated for the sourced rules:
  - It waits out the 19-step catch.
  - It now expects SmashWiki Edge's rule: regrab protection refreshes after **any hitstun**, which is
    DK's shared rule, instead of the old "damaging launch only".

**Step 2 — ledge-attack root motion.**
- New `src/characters/linkLedgeRootMotion.ts`: the native `Trans` track of Link's `g02cliffattack` (samples
  0–54, sha256 `47239cec…436a`, evaluated with `tools/link_native_pose.py`). Wired in
  `buildFreshLinkRecoveryAttack` for `link.ledgeAttack`.
- The corner-anchored projection is now one shared helper, `projectCornerAnchoredLedgeRoot`, in
  `ledgeRootMotionSchema.ts`. DK and Link both use it. DK's values are unchanged: `DonkeyKong.sourceFixes`
  and `Character.ledgeRootMotion` pass.
- No `Character.ts` change was needed. The shared attachment in `applyLedgeReleasePhysics` is not gated by
  fighter id.

**Step 11 — probes.**
- Both `docs/review/2026-10-14/link-takeover/link-takeover-probe.mjs` and the maintained
  `tools/link-playable-probe.mjs` now simulate input at the `DeviceInputDispatcher` (`sampleActions`,
  `sampleMoveX/Y`, `sampleSmash`). The real `InputResolver.update` therefore derives edges and the
  shield + stick dodge chord.
- Ledge placement is now body half-width from the wall.
- The takeover probe gained two options:
  - `PF_P1=donkeykong` runs the same scenarios with DK as player 1, as an identical-input baseline;
  - `PF_ONLY=<regex>` filters scenarios.
- Not run: probes are batched for the coordinator.

**Parity test now: 42 passed, 8 failed (50).** The remaining failures are:

| Failing test | Fighter | Fixed by step |
|---|---|---|
| ledge jump intangibility | Link | 5 |
| trip stand | Link and DK | 6 |
| trip-fall intangibility | DK | 7 |
| shield jump and wake-up | DK | 8 |

Other failures seen in the touched suites are pre-existing, caused by move data elsewhere or by legacy-kit
expectations, and are not caused by these edits:
- `Character.airMovement` bair facing ×2
- `Character.landing` `maxRunSpeed 7.8`
- `characterLandingSerializer` `LINK_UP_SPECIAL.groundedVariant`
- `ordinary/specialLanding` `link.neutral_special`
- `characterReferenceKnockbackSerializer` ×10

## 2. What the triage reported, and the cause of each

1. **"Rolls (shield+side) and spot dodge (shield+down) broken": probe artefact, not a Link bug.**
   - `link-takeover-probe.mjs:47` replaces `InputResolver.isActionHeld` with a lookup into its own input
     record.
   - The `dodge` bit is computed by `defaultDodgeResolver` inside `InputResolver.update`
     (`src/input/InputResolver.ts:555`) and read back through `isActionHeld(playerIndex,'dodge')` (`:1001`).
   - With the override in place, `dodge` was always false. Shield plus stick then only holds the shield, and
     DK does exactly the same.
   - In the engine, Link's spot dodge and rolls match UFD frame for frame, and Link's roll travels as far as
     DK's (tests pass).
   - Probe fix (B3 probe step): send `dodge: true` with the chord, or leave `isActionHeld` alone and
     override `getMoveVector` and the binding store only.
2. **"Ledge grab: Link fell past the ledge": the probe placement, plus a real but shared reach limit.**
   - The probe drops Link 30 px outside the floor (`link-takeover-probe.mjs:299`).
   - The grab radius is the body half-width: `computeLedgeDetection` at C:13634 feeds
     `halfWidth: this.tuning.width/2` to `isWithinLedgeRadius` (`ledgeDetection.ts`).
   - Link's half-width is 23 px (`LINK_TUNING.width 46`) and DK's is 30, so DK catches at +30 and Link
     cannot.
   - With the body touching the wall, Link catches (test passes).
   - The general gap is that no fighter has a sourced cliff-catch box; it is always the body width. That is
     noted under Risks and not fixed in B3.
3. **Real Link-only defects** (tests fail; DK passes the same test):
   - **L1. No ledge tuning.**
     - `FRESH_LINK_MOVEMENT_PROFILE` (`src/characters/linkFreshMovement.ts:6`) has no `ledge` block, so Link
       runs on `LEDGE_HANG_DEFAULTS` (`ledgeHangState.ts:425`): catchFrames 0, climbFrames 28,
       getupIframes 12, rollFrames 36, rollIframes 24, jumpIframes 8, and no regrab penalties.
     - DK's block is `fighterMovementProfiles.ts:136–140`.
     - This one cause explains the catch-19, get-up and roll failures.
   - **L2. Ledge jump intangibility off by one (2–13).**
     - Link's jump goes through the Link-only branch `applyLedgeReleasePhysics` C:13807–13817
       (`beginLinkLedgeJumpPreparation`).
     - Its xlu is counted from the step after the release (`linkLedgeJumpPreparationSourceXlu`, read in
       `hasWholeSourceProtection` C:12017–12018).
     - DK's shared path (`jumpIframes` from `ledgeHangState`) gives 1–12.
   - **L3. Ledge attack drops Link off the stage.**
     - `buildFreshLinkRecoveryAttack` (`linkFreshRecoveryAttacks.ts:27–40`) emits `link.ledgeAttack` without
       `ledgeRootMotion`.
     - `applyLedgeReleasePhysics` C:13866–13895 therefore zeroes velocity and never attaches the climb
       (`if (native.ledgeRootMotion && corner)`), and gravity takes him.
     - DK has `DONKEYKONG_LEDGE_ATTACK_ROOT_MOTION` (`donkeykongLedgeRootMotion.ts`, wired at
       `DonkeyKong.ts:977`). Pikachu has `PIKACHU_LEDGE_ATTACK_ROOT_MOTION`.
     - Duration (55) and intangibility (1–22) are already right. The 1–22 comes from the hard-coded
       `[22,18,11,0]` at C:13869 and `intangibleUntilByGrab` [23,19,12,1] in `linkAttackData.json`.
   - **L4. Trip stand.**
     - The neutral or timeout stand at C:4456–4461 has three paths:
       - DK: `beginDonkeyKongGroundRecovery('getup',29,22)`. That is the down_stand row, and it is also used
         for a trip.
       - Pikachu: its own path.
       - Everyone else, including Link: `setInvincibility(GETUP_IFRAME_FRAMES=14)` with no commitment.
     - The native rows are identical for both fighters:
       - `down_stand_u/d`: xlu 1..23, cancel 30, so 29 locked frames and intangible 1–22.
       - `slip_stand`: xlu 1..17, cancel 22, so 21 locked and intangible 1–16.
     - So DK is right for a knockdown get-up but wrong for a trip. Link is wrong for both.
4. **Shared-path gaps that Link currently covers with Link-only modules.** Deleting those modules without
   lifting the behaviour would regress Link. DK already fails these tests:
   - **S1. Shield break.**
     - Shared `beginSourceShieldBreak` (C:2801) returns early unless Link (C:2803).
     - DK just stands in the `broken` stun: no shield jump, no intangibility, no `furafura_start`
       landing, and no 33-frame wake-up.
     - Link gets all of these from `linkShieldBreakReceiving` + `linkShieldBreakPhysics` (pop height 41 native
       units, gravity from the fighter, intangible except in the last 5 s of a timed match).
   - **S2. Trip fall intangibility, frames 1–5.**
     - Only Link has it, via `linkCommonRecoverySourceXlu` (C:12022) after `beginSourceReactionPhase`
       (C:9699).
     - That call is gated to Link at C:2845.

## 3. Link-only receiving modules: verdicts

Roster scan: no DK, Pikachu, Link, item or Final Smash data sets `sourceCrumple`, `sourceSleepBind`,
`authoredDamageMotionFamily`, `authoredProneDamageVariant` or `authoredRecipientTemplateFamily`. The only
producers were deleted fighters (Puff for sleep, and so on).

| Module | Reached by | Shared path instead | Ultimate covered by the shared path? | Verdict |
|---|---|---|---|---|
| `linkRecipientTemplateOverride` | Captor GrabSpec `authoredRecipientTemplateFamily`. **No producer.** | Default `thrown_<dir>` / `shouldered_donkey` routes plus `sourceCaptureMotionFamily` (C:7582) | yes | **DELETE** |
| `linkRollReceiving` | `authoredDamageMotionFamily:'roll'`. **No producer.** | `admitSourceDamageReceipt` (C:12596–12609) plus the ordinary `damage_fly_*` route | yes (presentation only) | **DELETE** |
| `linkCrumpleReceiving` | `sourceCrumple` (Ryu/Ken/Kazuya/Ridley). **No producer.** | Ordinary flinch/launch in `applyHit` | yes (nothing to cover) | **DELETE** |
| `linkSleepBindReceiving` | `sourceSleepBind` with sleep/bind attr. **No producer** (Puff removed). | Ordinary launch | yes | **DELETE** |
| `linkShieldBreakReceiving` + `linkShieldBreakPhysics` | **Any** shield break on Link (victim-gated, C:2803) | `shieldState` 400 − p stun in place (C:4507–4525) | **no** (S1) | **DELETE after lifting** pop, pop intangibility, landing, loop and wake into the shared break for all fighters |
| `linkPassiveShieldSdi` | Reflectable projectile into Link's passive shield (Pikachu, Fire Flower, Link mirror) | None. Ordinary SDI needs `pendingKnockback`, so no fighter gets SDI on a shielded hit | consistent with the other shield paths | **DELETE** (user decision 5). The passive shield keeps block stun only. |
| `linkProneFood` | Food item, Link prone, attack pressed. Still reachable; gated by revision at C:2875 and MatchScene ~2887. | Prone attack becomes the getup attack. Food is eaten only standing. | no fighter eats prone | **DELETE** (user decision 5: Link-only, shared path wins). Removes about 60 lines of MatchScene reservation code. |
| `linkLedgeJumpPreparation` + `linkLedgeJumpPhysics` | Link's own ledge jump | Generic ledge jump (C:13836–13844) with `jumpIframes`. DK passes the UFD test on it. | yes for UFD values (L2) | **DELETE**, and give Link `jumpIframes: 12` |
| `linkCommonRecoveryPresentation` | Trips (Banana Peel slip), down-bound, prone hit, wall and ceiling tech (gated C:2845) | Shared knockdown/trip/getup. Wall/ceiling tech exists only for DK (C:4258+) and Pikachu (C:4298+). | trip xlu: **no** (S2); tech: no generic path | **DELETE** the trip/down parts after lifting the slip xlu 1–5 into `applyTrip`. Wall/ceiling tech: **ruled** to move onto one shared surface-tech path for all three fighters (step 6b), then delete the Link copy. |
| `linkCommonEventPresentation` | prone-hit-3 (**no producer**); gait-exit, terrain impact and clank (presentation only) | Shared `attackClank` plus ordinary fall/damage routes | yes (no gameplay) | **DELETE** |
| `linkPassiveShield` (per drawing) | Reflectable projectile vs Link idle, walk or crouch | none | — | **KEEP, simplified:** one capsule per state, `{standing, walking, crouching}`, root-relative and mirrored by facing. Selected by `isCrouching()` / walk state instead of the drawing route. Drop `pose.passiveShield` from `linkBodyProfileValidation.ts:26,147–151,170`. |

Dead schema fields after the deletes. Remove each from `attacks.ts`, `combat.ts`, `attackHitWindows.ts`,
`HitboxDamageHandler.ts` (~681–684, ~810–813), `linkSpinContactSelection.ts:35–36`, `characterSerializer.ts`
and `linkIntrinsicAuthoring.ts`:
- `sourceCrumple`
- `sourceSleepBind`
- `authoredDamageMotionFamily/Source`
- `authoredProneDamageVariant/Source`
- GrabSpec `authoredRecipientTemplateFamily/Source` (`grabSchema.ts:1,175–176,247`)

Also remove the matching Final-lease snapshot keys in Character (capture C:3034–3061, restore C:3095–3188):
- `shieldBreak*`, `sourceRollReceiving`, `recipientTemplate`, `crumple`, `sleepBind*`, `bindImmunity*`,
  `proneFood*`, `rawHorizontalInput`, `ledgeJump*`, `commonRecovery`, `sourceCommonEvent*`
- `shieldBreakMash` is shared: keep it.

## 4. The `getLinkRuntimeRevision()==='ultimate-rebuild-v1'` branches (36 grep hits)

Equivalence:
- `LinkRuntimeRevision` (`src/types/index.ts:74`) has one member.
- The base returns `null` (C:1285). Link returns the const (FL:105–106).
- So `rev==='ultimate-rebuild-v1'` is exactly "is the Link class", and every production path builds Link
  with `id:'link'`.

**Trap.** Eight tests build a **base** `Character` with `id:'link'`. After the collapse they take Link paths:
- `Character.referenceLocomotion` :33
- `Character.landing` :51 and the `physicsWorld({id:'link'})` helper at ~188–246
- `Character.referenceDodge` :34
- `Character.specialLanding` :33
- `Character.airMovement` :35
- `Character.ordinaryLanding` :33
- `Character.physics` :46
- `captureAttachmentIntegration` :32

Switch them to `new Link(...)`, or to a neutral id.

| C: line | Method | Collapses to |
|---|---|---|
| 1106 | getCaptureAttachmentPose (Link pose anchor) | a protected hook overridden in Link (or `id==='link'`) |
| 1285 | getLinkRuntimeRevision | **delete**, together with FL:105–106 |
| 1286–1287 | supportsHeavyItemCarry | `true` for all three fighters; delete the method or make it a data flag |
| 1413, 1415 | advanceSourceChainedAttack (smash follow-up charge, deferred tick) | move into a Link override of the method |
| 2803 | beginSourceShieldBreak | **goes with S1**: the shared break replaces it |
| 2845 | beginSourceReactionPhase | **delete** (linkCommonRecoveryPresentation) |
| 2874 | beginSourceProneFood | **delete** (linkProneFood) |
| 2900 | notifyLinkPassiveShieldContact | drop the revision guard; delete the SDI part |
| 2932 | setFinalVictimPresentation guard | drop the clause |
| 3268 | setFinalSmashControl footstool reset | reset unconditionally (fields are inert for DK/Pikachu) |
| 4076, 5644 | footstool mini-jump velocity | a per-fighter `footstoolJumpVelocity` hook; DK and Pikachu already branch by id there |
| 4216 | footstool recipient recovery frames | Link data: `LINK_FOOTSTOOL_SOURCE` values on Link's tuning |
| 4275 | Link wall/ceiling tech | **delete** with linkCommonRecovery (or keep as data, see §3) |
| 5723 | grounded reset of the Link footstool repeat count | reset unconditionally |
| 7490, 7494 | capture recipient height `'high'` | Link data field (motion height) |
| 7579 | beginLinkRecipientTemplateOverride | **delete** |
| 9258, 9291, 9296 | footstool head box / identities / recipient side | Link override (`queueFootstoolJump`, `applyFootstoolRecipient`) or `id==='link'` |
| 9722 | applyAttackClank `beginLinkClankPresentation` | **delete** (linkCommonEventPresentation) |
| 12102 | applyHit direct-throw presentation | `id==='link'` (re-check after A4.2: the presentation may be gone) |
| 12297 | applyHit sleep-bind repeat | **delete** |
| 12653 | applyHit: knockback>0 while shielding drops the shield | **shared candidate.** In Ultimate a launching hit always ends the shield. Check DK/Pikachu (pendingKnockback while shield raised) before making it unconditional, else `id==='link'`. |
| 12657 | beginLinkRollReceiving | **delete** |
| 12665 | down-hit reaction phase | **delete** |
| 12921, 12929 | notifySourceGaitSupportLoss / notifySourceTerrainImpact | **delete** |
| 12989 | sourceShieldContactAllowsBlock (exact bubble geometry) | Link override, or `id!=='link'` |
| 13807 | Link ledge-jump preparation | **delete** (L2) |
| 13869 | ledge attack `[22,18,11,0]` | **delete the branch**: Link's `ledge.attackProtectionFramesByGrab` (L1) |

Outside Character.ts, `linkRuntimeRevision` the field goes away:
- `types/index.ts:74,80`
- `characterSnapshot.ts:31`
- `MatchStart.ts:444`
- `authorableCharacterRegistry.ts:42`
- `characterSerializer.ts:106,156,2690,2697,2730`
- `linkUiPresentation.ts:14`
- `scenes/linkResultsPresentation.ts:21`
- MatchScene (live): 1468, 1476, 2216, 2232, 2895, 4479, 5296, 5368, each becoming `id==='link'` or `true`

`ReplayFile.ts:560,685,963` inject and validate the field. Phase B must keep **reading** old replays: accept the
field and ignore it, and stop writing it. Check whether `REPLAY_VERSION` needs a bump. A writer change alone
does not change determinism.

## 5. Phase B edit plan (ordered)

Each step: edit, then run `npx vitest run src/characters/linkDefenceLedge.physics.test.ts` plus the listed
targeted suites.

1. **DONE (part 1). Link ledge data (fixes L1; no Character.ts edit).**
   - In `linkFreshMovement.ts`, add `ledge`:
     - catchFrames 19, climbFrames 34, getupIframes 33, rollFrames 45, rollIframes 26, attackIframes 0,
       jumpIframes 12
     - `...ULTIMATE_LEDGE_REGRAB_PENALTIES`
     - `optionIntangibilityScaleByGrab: ULTIMATE_LEDGE_OPTION_INTANGIBILITY_SCALE_BY_GRAB`
     - `attackProtectionFramesByGrab` = `intangibleUntilByGrab.map(n=>n-1)` from
       `linkAttackData.recovery['link.ledgeAttack']`, which gives [22,18,11,0]
   - Cite the UFD Ledge Stats and SmashWiki Link Edge attack in comments.
   - Delete the duplicate `LINK_MOVEMENT_PROFILE` in `fighterMovementProfiles.ts:60–122` and point the map
     (`:236`) and `characters/index.ts:432` at the one Link profile. Two profiles for one fighter are a
     duplication: the map is used for the Lab/profile lookup and FreshLink uses the other.
   - Expected: the catch, get-up and roll tests go green for Link.
2. **DONE (part 1), except the C:13869 ternary. Link ledge attack root motion (L3).** The ternary is now
   redundant (Link's tuning carries [22,18,11,0]); delete it in step 3.
   - Generate `LINK_LEDGE_ATTACK_ROOT_MOTION` from native `g02cliffattack` Trans (Link), the same way
     `donkeykongLedgeRootMotion.ts` was made (`tools/link_native_pose.py`, kept per the plan). Put it in a
     data module or in `linkAttackData.json`.
   - Attach it in `buildFreshLinkRecoveryAttack` for `link.ledgeAttack`.
   - Character C:13869: replace the ternary with `this.tuning.ledge.attackProtectionFramesByGrab` (step 1
     supplies the value).
   - Expected: the ledge-attack test is green.
3. **Collapse the revision branches** (§4), one commit:
   - Delete `getLinkRuntimeRevision`, the field, the type, and the serializer/snapshot/MatchStart writers.
   - Fix the eight `new Character({id:'link'})` tests.
   - Turn the data branches (4216, 7490/7494, 13869) into Link tuning fields, and the behaviour branches
     (1106, 1413/1415, 4076/5644, 9258–9296, 12989) into protected hooks overridden in `FreshLink.ts`, so
     Character.ts keeps no `id==='link'` checks where a hook already exists.
4. **Delete the unreachable receiving modules** (§3 rows marked DELETE with no producer):
   - recipientTemplate, rollReceiving, crumple, sleepBind, commonEvent (prone-3 and presentation)
   - their Character fields, snapshot keys, schema fields and tests
   - Targeted suites: `characterSerializer`, `attacks`, `combat`, `HitboxDamageHandler`, `grabSchema`.
5. **Ledge jump (L2):**
   - Delete the C:13807–13817 branch and `linkLedgeJumpPreparation` / `Physics` (fields C:1821–1852, C:4171,
     C:6600–6606, C:12017–12018, C:13180–13181, the snapshot keys, and FL:168,772,910).
   - Expected: ledge-jump test green with the step 1 `jumpIframes 12`.
6. **Shared ground recovery (L4):**
   - Generalise `beginDonkeyKongGroundRecovery` (C:1507) and `donkeykongCommittedBody` into one shared
     committed-recovery record for every fighter.
   - At C:4456–4461, choose `slip_stand` (21 locked, intangible 1–16) when `this.tripped`, else `down_stand`
     (29 / 1–22).
   - Delete the generic `GETUP_IFRAME_FRAMES` fallback for Link. Pikachu keeps its own path, or moves onto
     the shared record when the same rows are confirmed for him.
   - Expected: trip-stand tests green for DK and Link.
6b. **One shared surface-tech path (coordinator ruling).**
   - Ultimate gives every fighter wall tech, wall-jump tech and ceiling tech.
   - Today DK has its own copy (C:4258+), Pikachu has his (C:4298+), and Link has a third inside
     `linkCommonRecoveryPresentation` (C:4275–4296, with `LINK_SURFACE_TECH_SOURCE_PARAMETERS`).
   - Replace the three with one shared `surfaceTech` step in Character. Per-fighter data goes on the tuning:
     - wall tech impulse x;
     - wall-jump impulse x/y;
     - ceiling tech impulse x;
     - intangibility (native wall 1–21, ceiling 1–18);
     - action-defer frames (21/27);
     - the presentation sheet keys.
   - Delete the DK-, Pikachu- and Link-specific branches and `donkeyKongSurfaceTech*` / `pikachuSurfaceTech*`.
   - **Risk:** DK and Pikachu surface-tech timing must stay identical. Encode their current values as their
     data rows, and diff against their existing surface-tech tests (`Pikachu.surface-tech.physics`, the DK
     tech tests) and the goldens.
7. **Shared trip-fall intangibility (S2):**
   - In `applyTrip` (C:9686), give 5 frames of whole-body intangibility for every fighter (native `slip` /
     `slip_down` xlu 1..6).
   - Then delete `linkCommonRecoveryPresentation` and the C:2845/9699/12666/4348 calls, with the §3 decision
     on wall/ceiling tech.
8. **Shared shield break (S1):**
   - Move the phases (pop → `furafura_start` landing → 400 − p loop with mash → 33-frame wake → tail) and
     the pop intangibility (except in the last 5 s) from `linkShieldBreakReceiving` / `Physics` into the
     shared break in `shieldState` / Character.
   - Parameters: pop height 41 native units × 5 px with the fighter's `referenceLaunch.gravity`.
   - Then delete both modules, their snapshot keys (C:3034–3036, 3095–3099), FL:264,301–302,763,778,813,911,
     and MatchScene `setSourceShieldBreakLastFiveSeconds` (it becomes shared, so keep the call and point it
     at the shared setter).
   - Expected: the DK shield-break tests go green.
9. **Prone food and passive-shield SDI:**
   - Delete `linkProneFood` (Character C:2864–2885, 3608–3622, and the MatchScene reservation code
     ~1430–1504, ~2881–3213, ~6111/6418/6902/8540).
   - Delete `linkPassiveShieldSdi` with `sourceHorizontalTerrainLimit` and the `setSourceTerrainBodies` calls.
10. **Passive shield, per-state capsule** (`FreshLink.getLinkPassiveShieldWorldSurfaces` FL:1247–1255): §3 row.
11. **DONE (part 1). Probe:** fix the chord in `link-takeover-probe.mjs` (send `dodge:true`, or stop overriding
    `isActionHeld`). Add ledge placement at body half-width. Rerun the defence and ledge scenarios for DK and
    Link with the same input.

## 6. Risks (DK and Pikachu behaviour that changes; goldens)

| Step | Changes for | Golden impact |
|---|---|---|
| 1, 2, 3, 4, 5, 9, 10 | Link only (data, dead code, Link-only modules) | DK/Pikachu goldens **identical**, provided step 3 maps each branch exactly. Watch 3268/5723 ("reset unconditionally"): the fields must be inert for DK/Pikachu. |
| 3 (12653) | DK/Pikachu **if** made unconditional | Shield state after a launching hit while shielding. Keep it Link-only unless DK is shown to be wrong. |
| 6 | **DK**: a trip stand becomes 21 locked / 16 intangible instead of 29 / 22. **Pikachu**, if moved onto the shared record. | Goldens that contain a trip shift (Banana Peel, trip-chance hits on DK). |
| 6b | DK and Pikachu surface tech moves onto the shared path, with values intended to be identical | Must stay identical: diff the goldens |
| 7 | **DK and Pikachu** get 5 intangible frames at the start of every trip | Same as step 6 |
| 1 (done) | **Link**: fast fall 3.04, landing 2/5, dash-dance 12, ledge timings | Goldens with Link change. DK/Pikachu are not affected. |
| 8 | **DK and Pikachu**: shield break now pops them up, makes them intangible, adds the land and wake phases, and total lockout grows by about 50 + 33 frames | Any golden with a shield break shifts. Snapshot schema changes (shared shield-break state replaces the Link keys). Replay rewind needs the new fields in the snapshot. |
| 3 | Snapshot/replay field `linkRuntimeRevision` removed | Old replays must still load: read and ignore the field. |
| Not changed | Ledge grab reach = body half-width for every fighter (Link 23 px, DK 30 px). Ultimate uses a per-fighter cliff-catch box. | Unsourced in the repo, so **no edit proposed**. Flag for a later shared ledge-box task. |

Further risk notes:
- **UFD and native disagree on ledge-roll intangibility.** UFD gives DK 1–28 and Link 1–26. The native
  `cliff_escape_quick` xlu gives 1..31 and 1..29. The tests use UFD, as the shipped DK value does.
- **Concurrency.** A4.2 is rewriting Link presentation in `Character.ts` / `FreshLink.ts` (the
  `linkCommonBodyRoute` callers listed in §3 may disappear first). Phase B must start from the post-A4.2
  file and re-grep each anchor.

## 7. Commands used (targeted, two worker threads)

```
npx vitest run src/characters/linkDefenceLedge.physics.test.ts --poolOptions.threads.maxThreads=2 --poolOptions.threads.minThreads=1
```

No build, goldens, probe or full suite were run, per the package rules.
