# Link takeover triage (2026-10-14)

Goal: Link plays correctly in a real production match. That means every normal,
aerial, smash, special, grab/throw, shield/dodge/ledge state works and looks right,
the Final Smash works, held items work, and Link round-trips through the Character
Lab. Move data follows UFD / SmashWiki. This file is a gap list. Nothing in `src/`,
`assets/`, `data/` or `tools/` was changed by this triage.

## Evidence in this folder

| File | What it is |
|---|---|
| `link-takeover-probe.mjs` | Playwright probe adapted from `tools/link-movement-probe.mjs` and `tools/dk-all-moves-acceptance.mjs`. `PF_PASS=2` selects the second pass. **All input is SIMULATED**: `InputResolver.getMoveVector` / `isActionHeld` / `getSmash` are overridden on each fixed step. No keyboard or gamepad input was used. |
| `probe-run1-boot-failure/report.json` | First run against bundle `index-bsQ4wm9g.js`. The game never left Boot. |
| `probe-pass1/` | Run against rebuilt bundle `index-Dy8I1zeM.js` (sha256 `f7eba6d9…bd5a7`), 45 scenarios plus screenshots. Scenarios before frame ~140 of each fresh match are invalid because of the match-start lock (see B3). |
| `probe-pass2/` | Same bundle. Each fresh match waits 240 frames first. Re-runs locomotion, the jab chain, the fsmash2 timings, aerial setups, specials, defence, items, ledge and the Final Smash (no `resetForRound`, see note). |
| `vitest.link.config.mjs` | Copy of the repo vitest config **without** the roster-mask test excludes, so the Link suites can run at all. |
| `vitest-link.json` | First Link test run (1007 tests), taken before the coordinator's boomerang fix. |
| `vitest-link-rerun.json` | Re-run of the suites that had failed to load, after the coordinator's fixes. |

Probe caveats:
- `resetForRound` bumps the position-reset generation. `FinalSmashController` then rejects that fighter's request (`p.generation !== r.generation`). Pass 1's Final Smash attempt was therefore invalid. Pass 2 ran it in a fresh match without a reset.
- Some misses come from my setup, not from the move. They are marked "untested" below.

## Blockers (each one stops Link being playable at all)

| # | Blocker | Evidence | Status |
|---|---|---|---|
| B1 | **Boot crash from invalid Link data at module load.** The `fair` auto-cancel window had `endFrame: null`, which threw *"compiled character 'link' … must be a finite number"*. After that was fixed, the boomerang had `outboundFrames: 0`, which threw *"SideSpecialMove 'link.side_special': invalid boomerang projectile"*. | `probe-run1-boot-failure/report.json`, and the vitest load errors in `vitest-link.json` | **Fixed by the coordinator** in `linkFreshNormals.ts` and `linkFreshSpecials.ts`. Bundle `index-Dy8I1zeM.js` boots with 0 page errors and 0 console errors. |
| B2 | **The roster mask removes Link from the game.** `ACTIVE_FIGHTER_IDS = ['donkeykong','pikachu']` (`src/characters/activeFighters.ts`). `MatchScene.resolveActiveMatchConfig` runs `maskPlayerSlots`, which silently turns a `link` slot into Donkey Kong (probe `boot.unpatchedMatch`: `p1Id: donkeykong`). Link is also hidden from Character Select and from the Lab list (`CharacterEditorScene` filters on `isActiveFighter`). `vite.config.ts` excludes every `src/characters/Link*.test.ts` plus `referenceAutolink.test.ts`, so `npm test` has never run Link's suites. | Probe pass 1 boot section; `vite.config.ts` `MASKED_FIGHTER_TEST_EXCLUDES` | **Open.** Every in-game result below needed an in-page bypass (`resolveActiveMatchConfig` was wrapped). |
| B3 | **Link is invisible most of the time.** `assets/characters/link/frames.json` has **41 of 270** required body resources installed (`completionState: PARTIAL1842_…_RUNTIME_UNVERIFIED`). By design, `MatchScene.applyInitialFreshLinkPose` calls `setVisible(false)` whenever `getLinkBodyPose()` is null. The following have **no art**: walk, dash, run, turn, crouch, jumpsquat and the grounded jump, shield, rolls, ledge (cliff), damage/tumble/down/getup, grab and throws, all four specials, item carry/use, taunts, the match entry, results, and the Final Smash. Each fresh match also starts with about 140 frames during which Link is not actionable and is invisible (entry presentation without art). | Probe "invisible" frame counts; screenshots `probe-pass2/22-shield.png` (shield bubble with no Link inside), `90-final-smash-early.png`, `95-item-beamSword.png` | **Open.** This is the largest gap. |
| B4 | **All four specials fail closed.** They enter their move but never produce an article or a hit. The bow startup clock loops 0→15 and restarts without ever releasing an arrow. The boomerang and the bomb never spawn. Ground and air Spin Attack never hit. The render dependencies say why: *"Persistent own Bow lacks actual paired body"*, *"Loaded Arrow MODEL ROOT/axis attachment"*, *"Persistent own Bow back requires exact articleModelRoot profile/registered root bow.back"*. Special hit geometry also comes from art-bound outgoing poses that do not exist for special motions (`runtimeOutgoingPoses` covers only the 16 normals). | Probe pass 1 and pass 2 (specials rows); `Link.specials` / `groundSpin` / `bow` / `specialReference` physics suites fail | **Open.** |

## Per-move / per-feature status

Damage shown is base damage. The engine's 1.05 freshness bonus has been divided out, so DK's % in-game is this × 1.05 × 1.2 (1v1). Angles are native degrees; KB is reference knockback. "Visible" means a body pose was rendered.

| Feature | Status | Evidence (probe, simulated input) |
|---|---|---|
| Boot to menu | works (after B1 fix) | 25.6 s to PasswordGate under SwiftShader; 0 page errors; heap 322 MB |
| Selectable in menus / match | **broken** (B2) | `link` slot becomes DK without the bypass |
| Match-start entry | **broken** | ~140 frames invisible and not grounded; entry art (`j00entryr`) and Parasail article not installed |
| Idle | works | `a00wait1` visible once the lock ends |
| Walk / dash / run | works mechanically, **invisible** | Dash 9.9 px/f and run 7.67 px/f, matching the UFD-derived values in `link-movement-probe`; no walk/dash/run pose |
| Turnaround, crouch | **invisible** | No pose |
| Jump (full, short, double) | works, partly invisible | Rising part invisible; `a04fall*` and `jump_f/b` aerial poses visible |
| Jab 1-2-3 | works | Holding attack gives jab→jab2→jab3: 3.0/3.0/4.0, 361/361/30°. Tapping every 4 f reaches only jab2. Visible. |
| Ftilt | works | 13.0 @361; visible |
| Utilt | works | 11.0 @85; visible |
| Dtilt | works | 9.0 @85; visible (4 invisible frames at the crouch transition) |
| Dash attack | works | 14.0 @45; 14 invisible frames (the dash before it) |
| Fsmash (strike 1), uncharged and charged | works, **verify data** | Two contacts per strike 1: 7.0 @69 then 5.0 @361. Charged 60 f: 9.75 + 12.87. Visible. Check both packets against UFD. |
| Fsmash strike 2 (follow-up) | **broken** | Pressing attack at +8/+14/+20/+26 f never enters `link.smash2` |
| Usmash | works | 4 / 3 / 11 @107/105/90; visible |
| Dsmash | works | 16.0 @78 (front); visible |
| Nair | works | 11.0 @361; visible |
| Fair | works | 10.0 @44 (2nd hit only connected at this spacing); visible |
| Bair | works | 5.0 @70 + 7.0 @361; visible |
| Uair, dair | untested (setup missed); animation visible | Move entered and pose rendered, no contact with my placement. Dair rebound untested. |
| Landing lag poses | works | `c05landingair*` visible |
| Neutral-B Bow | **broken** (B4), invisible | Startup loops; no arrow |
| Side-B Boomerang | **broken** (B4), invisible | No boomerang spawned |
| Up-B ground Spin | **broken** (B4), invisible | No hit |
| Up-B air recovery | partly works, invisible | Rises (vy -12 → 0) with no hits; helpless/landing not checked |
| Down-B Bomb pull / detonate / throw | **broken** (B4), invisible | No bomb entity; the attack input then does a normal fsmash |
| Standing grab | works mechanically, **invisible** | `whiffStartup → holding → throwing → cooldown`; DK captured |
| Pummel | works, invisible | +1.3 base |
| F/B/U/D throws | works mechanically, **invisible** | DK% after throw: 6.93 / 6.93 / 8.82 / 7.56 (pass 1) |
| Dash grab, pivot grab | untested | My dash grab whiffed |
| Shield | works mechanically, **invisible** | `active`, health 50 → 44 while held; bubble drawn with no Link |
| Shield vs incoming hit | untested | DK fsmash did not reach in my setup |
| Spot dodge (dodge button) | works | `b02escapen` visible |
| Spot dodge (shield + down) | **broken or input mismatch** | No escape anim; check against DK first |
| Forward/back roll (shield + side) | **broken or input mismatch**, no art | No movement, no escape f/b pose |
| Air dodge | works | `active:air`, `b02escapeair` visible |
| Ledge grab / getup | **broken or setup**, no art | Link fell past the ledge and was KO'd; `ledgeHang` stayed `idle` |
| Getting hit (hitstun / tumble) | works mechanically, **invisible** | Link took 26.46% and was launched; no damage pose |
| Respawn | works | Respawned after the ledge-test KO |
| Final Smash (Ancient Bow) | activates; **invisible, no visible effect, no hit observed** | Ball granted → neutral-B → `link:ancient-bow` phases 0..~130, then exit. Link invisible throughout; DK (standing elsewhere) took 0%. No Link Final body art in `frames.json`. |
| Item: Beam Sword | mechanics work, **invisible** | Pickup OK; jab swing 4.0, fsmash swing 17.65; Link and sword not drawn |
| Item: Ray Gun | partly works, invisible | Picked up; shooting not confirmed; the smash-throw hit DK for 14.8 |
| Item: Home-Run Bat | **swings miss**, invisible | Jab and fsmash swings ran, 0 contacts at 110 px |
| Item: Bob-omb | works, invisible | Pickup; throw exploded on DK for 30.1 |
| Sword beam article | spawned with **missing art** | During one fsmash: *"Missing own-model article profile/texture sword-beam"*. Check whether Ultimate Link should fire a beam here at all. |
| Character Lab save round-trip | data OK; **UI untested** | `characterSerializer.test.ts` 90/90 pass. Link is not listed in the Lab (B2). `authorableCharacterRegistry` 1/36 failing. `CharacterEditorScene` has 3 type errors on Link-specific fields. |

## Typecheck (`tsc --noEmit -p tsconfig.json`): 53 errors

These were taken before the coordinator's two data fixes, which change runtime data, not types. Grouped by cause:

- **Link / Final Smash work in progress (most of it):**
  - `FreshLink.ts` ×6: implicit any; `number|null|undefined` vs `number|null`; `LinkCrumpleReceivingState.elapsed` missing; `ItemDefinition.type` not in the `Pick<>`.
  - `linkFreshNormals.ts` ×1 (`number|null`).
  - `linkFreshRecoveryAttacks.ts` and `linkRecoveryAttackRuntime.ts`: `hitWindows.group` is a number where the schema wants a string.
  - `linkBodyProfileValidation.ts` ×2 (possibly undefined).
  - `linkSpecialController.ts` ×1.
  - `Character.ts:3271` (Final pose sheet `string|null`).
  - `finalSmashMeter.ts`, `FinalSmashChoreography.ts` (unused import).
  - `HitboxDamageHandler.ts:671` and `MatchScene.ts:2754` (`unblockable` missing from `AttackCollisionHit`).
  - `MatchScene.ts`: the Link article/bomb/arrow block at lines 2660–3562 (`platform.solid` label literal typing, `HeldItemHandle.id`, `this` any, the 1800 literal), plus 1256–1392 (Matter body `vertices` / `id` typing in the source terrain code).
  - `MatchScene.ts:5832` (`combatCollisionHitId` is a number, Link grab packet ids).
  - `MatchStart.ts:444` and `characterSnapshot.ts:33` (`as const` on a non-literal, `linkRuntimeRevision`).
  - `CharacterEditorScene.ts` ×3 (Link paired notes, taunt spec).
  - `ResultsScene.ts` ×2 (Fresh results frames).
- **Shared / non-Link:** `pikachuPresentation.ts:17` (the `fx__pikachu_final_elec` clip shape), `MatchScene.ts:5121` (`Phaser.Physics.Matter.Matter`).
- **Tests:** `simulationSpriteAnimation.test.ts` ×4, `donkeykongRenderMetrics.test.ts`, `replayTypes.test.ts` (replay version 7 vs 8), `linkIntrinsicUiPreview.test.ts` ×2, `linkFrozenClankPose.test.ts`.

None of these stopped the Vite build (Vite does not typecheck), but `npm run build` runs `tsc` first and will fail.

## Tests (Link suites with the mask removed)

First run: 1007 tests, 296 failed. After the coordinator's fixes, the re-run of the load-failing suites gave 248 tests, 60 failed.

- **Data invalid at load (fixed by the coordinator):** the boomerang `outboundFrames: 0` broke `Link.test`, `Link.bow`, `Link.groundSpin`, `authorableCharacterRegistry`, `characterFactory`, `characterEditorFields` and `referenceAutolink`. All of these now load.
- **Harness/mock gaps (not gameplay):** `perFighterSmoke` ×16, `fighterRegistry` ×2 and `characterFactory` ×3 fail with *"Cannot set properties of undefined (setting 'sourceReceivingRequired')"*. FreshLink writes `body.plugin`, which the shared MockScene does not provide.
- **Stale expectations from the legacy 10-move kit:** `characterSpec` ×3 (expects 10 moves, gets 24) and `Link.test` ×5.
- **Physics suites that see zero contacts:** `Link.*Launch`, `normals`, `combat.integration`, `rebound` and `specialReference`, about 230 tests. In-game, the same normals DO hit. A Node check (`linkRegisteredOutgoing` for every active frame) resolves hit geometry for all 16 normals. So the normal-move failures are a harness/fixture problem, probably spacing or receiving setup written for the legacy kit (e.g. *"jab startup step 27 has no fighter overlap"*). The specials failures are real (B4).
- **Real clock/data mismatches:**
  - `linkNormalBodyClock` ×3: Bair Hit2 anchors 14/16 vs expected 15/17.
  - `Link.referenceKnockback` ×1: late uair record.
  - `Link.bow` ×8: arrow speed 0.067 vs 0.5.
  - `linkUiPresentation` ×1: page key `c02attackhi3__physical174_p3` vs `c02attackhi3`, a packing rename.
  - `authorableCharacterRegistry` ×1.
- **Tooling tests broken:** `tools/link-runtime-input-origin.test.mjs` fails to parse (invalid JS). `tools/link-runtime-geometry-proof.test.mjs` contains no suite.

## Performance and correctness side effects of the art bank

- `assets/characters/link/frames.json` is 55 MB, of which `runtimeBodyProfiles` is about 25 MB. Three modules import it statically (`assets/manifest.ts`, `characters/linkBodyRuntime.ts`, `finalSmash/finalBodyPose.ts`), so it is inlined into the 30 MB `index-*.js` and parsed and validated at boot for every player, even in DK-vs-Pikachu matches.
- 41 of 270 resources already take **121 MB of encoded RGBA pages** (507 pages, 563 Link texture keys at boot). At that density, full coverage would be roughly 800 MB. For comparison, DK's whole folder is 78 MB and Pikachu's is 26 MB. **This density is not viable for a web build.** The resolution and packing policy has to change before the missing art is produced.
- `docs/review/2026-10-12/link-character/rework/art` holds 69 GB of staging.

## Work packages (disjoint files, so several agents can run in parallel)

Dependency order: WP0 first (it unblocks every in-game check). WP2 and WP3 decide how B3 is solved. The rest can run in parallel.

| WP | Scope | Files touched | Size |
|---|---|---|---|
| **WP0 Unmask Link** (blocker B2) | Add `link` to `ACTIVE_FIGHTER_IDS`. Drop the Link entries from `MASKED_FIGHTER_TEST_EXCLUDES`. Fix the roster-hardcoded menu tests that then run. | `src/characters/activeFighters.ts`, `vite.config.ts`, `src/scenes/characterSelect*.test.ts`, `lobby*.test.ts` | small |
| **WP1 Decide the art policy** (blocker B3) | A user decision: (a) keep strict fail-closed and finish ~229 resources at the Fresh standard, or (b) add an explicit, logged *fallback pose* (nearest installed motion) so Link is never invisible, then fill the art progressively. Also set a per-fighter texture budget (target in DK's range, under 100 MB) and a resolution/packing change, before any more art is made. | Decision only; then `src/scenes/MatchScene.ts` (`applyInitialFreshLinkPose` and the Link render block only), `src/characters/linkBodyPresentation.ts` / `linkBodyRuntime.ts` | small (decision) + medium (fallback code) |
| **WP2 Missing body art**, in priority order | 1. locomotion (walk/dash/run/turn/brake, squat, jumpsquat, grounded jump, landing); 2. damage/tumble/down/getup; 3. shield + escape f/b; 4. catch/catch wait/pummel/4 throws; 5. all specials (n start/hold/shoot, s throw/catch, hi ground/air, lw pull); 6. cliff catch/wait/climb/attack/roll/jump; 7. item carry/pickup/throw/swing/shoot; 8. entry/taunts/results; 9. Final body. Use the standard ComfyUI pipeline at the new budget, and reuse the existing rendered banks only if they fit that budget. | `assets/characters/link/**`, `tools/install_link_*.mjs`, `tools/gen-*` | **large** (the long pole) |
| **WP3 Specials runtime** (blocker B4) | Make bow release, arrow spawn, boomerang, bomb pull/detonate/throw and Spin hits work. Hit geometry should come from UFD hitbox tables (the way the grab already uses wiki rows), not from art-bound outgoing poses. Article sockets should fall back to an authored hand/root offset when the paired socket is missing. Then re-enable the `Link.specials` / `bow` / `groundSpin` / `specialReference` suites. | `src/characters/linkSpecialController.ts`, `linkSpinController.ts`, `linkBow.ts`, `linkBoomerang*.ts`, `linkRemoteBomb*.ts`, `linkArrowLifecycle.ts`, `linkFreshSpecials.ts`, the FreshLink special section, and the MatchScene Link-article block (about lines 2600–3560) | **large** |
| **WP4 Normals data and follow-up** | Make fsmash strike 2 enter. Check the jab tap cadence (a tap reaches only jab2). Check the fsmash strike-1 two-packet values (7 @69 + 5 @361) and every damage/angle/BKB/KBG/frame value against UFD and SmashWiki (SmashWiki wins). Fix the Bair Hit2 clock mismatch and the late-uair record. | `src/characters/linkNormalRules.ts`, `linkFreshNormals.ts`, `linkSelectedNormalPackets.json`, `linkNormalBodyClock.ts`, `linkSmashFollowupCharge.ts` | medium |
| **WP5 Defence and ledge** | First establish a DK baseline with the same simulated inputs for shield + down (spot dodge), shield + side (rolls) and ledge catch. Then fix whatever is Link-specific. Add tests for shield vs incoming hits and shield break. | `src/characters/FreshLink.ts` (defence overrides only), `linkPassiveShield*.ts`, `linkShieldBreak*.ts`, `linkLedgeJump*.ts`; probe in this folder | medium |
| **WP6 Final Smash** | Ancient Bow: verify the arrow spawns, travels, hits and launches; add a camera/visual; Link's Final body pose (needs WP2 item 9 or a fallback). | `src/finalSmash/linkAncientBow.ts`, `src/characters/linkAncientFinal.ts`, MatchScene `spawnAncientFinalArrow` / Final block | medium |
| **WP7 Held items** | The item mechanics work. What is missing: drawing the held item at Link's socket (beam sword invisible), Home-Run Bat swings missing at normal spacing, confirming Ray Gun shots. | `src/characters/linkItemContextEquipment.ts`, `linkHeldItemSocket`/`heldItemSocket.ts` (Link branch), `linkItemShotEmission.ts`, `assets/characters/link/item-muzzles.json` | medium |
| **WP8 Lab round-trip** (after WP0) | Lab lists Link; edit → save → start match with the custom Link; fix the 3 `CharacterEditorScene` type errors and the `authorableCharacterRegistry` failure. | `src/scenes/CharacterEditorScene.ts`, `src/characters/authorableCharacterRegistry.ts`, `characterSerializer.ts` | small–medium |
| **WP9 Typecheck green** | Fix the 53 errors listed above. Split by file group so it does not collide with WP3 and WP7: an agent owning `MatchScene.ts` should coordinate with WP3/WP6/WP7. | the files listed above | small–medium |
| **WP10 Test suites honest** | Give MockScene a `body.plugin`. Replace the legacy-kit expectations (`characterSpec`, `Link.test`). Re-base the physics launch suites on Fresh spacing, or delete the ones that duplicate the probe. Fix or remove the two broken `tools/link-*.test.mjs`. | `src/characters/*Link*.test.ts`, `perFighterSmoke.test.ts`, `characterSpec.test.ts`, the shared mock scene, `tools/link-runtime-*.test.mjs` | medium |
| **WP11 Bundle and boot cost** | Stop inlining `frames.json` into JS (load it as a JSON asset, or split `runtimeBodyProfiles` out of the bundle) and skip Link parsing when Link is not in the match. | `src/assets/manifest.ts`, `src/characters/linkBodyRuntime.ts`, `src/finalSmash/finalBodyPose.ts` | medium |

## Honest effort estimate

- **Code alone** (WP0, WP3–WP11, assuming WP1 chooses a fallback pose), giving every move functional but many shown with fallback poses: about **1.5–2.5 agent-weeks**. WP3 (specials) is the biggest code item.
- **Art (WP2)** is the long pole. About 229 missing motion resources, plus item/Final/entry art. At the Fresh pipeline's current standard (per-drawing anatomical fits, a 128 MiB budget for 15 % coverage) there is **no credible ETA**: it took several days to reach 41/270, and it is not viable size-wise. With the standard DK/Pikachu ComfyUI pipeline at a sane resolution: roughly **2–4 weeks** of generation and review.
- **Total to the stated goal: roughly 4–6 weeks of multi-agent work**, provided the art budget and fallback policy (WP1) are decided first. Without that decision, the previous approach shows that the work does not converge.

Do not resume the 831-row ledger, receipts or native collision proofs. None of it is needed for this goal.
