# Movement and combat integration follow-up

Link art is now **deferred by user request**: [the generation handoff](../../art/link/generation-handoff.md) provides per-pose instructions, sourced normal-attack timing, proposed canvas/anchors, and supervised acceptance for a future generator. It covers 16 normal attacks plus a remaining-state brief. No new images are claimed; authorized mechanics and verification can continue independently. The character skill includes this deferred-art workflow.

Character workflow: use the project [$add-character skill](../../../.agents/skills/add-character/SKILL.md) for new fighters and character completion work. It requires source-to-runtime coverage for movement, defense, inputs and moves; inspected sprite generation and collision alignment; and evidence from the running production build. Targeted fixes use the relevant subset. The old Claude skill now redirects to this shared workflow.

Latest launch correction: [October 5: stage scale, high-damage launches and DK spin finisher](../2026-10-05/damage-knockback/README.md). The flat main floor is now 800 px at the reference movement scale, KO limits are closer, pass-through platforms preserve fast launches, and grounded Spinning Kong reaches its finisher in the tested setups. TypeScript/build and **80 production scenarios / 256 assertions** pass on `index-B4ia6NWm.js`. Exact autolink transport remains calibrated; three previously documented Link test failures remain.

The [subsequent 200% report](../2026-10-05/damage-knockback/200-percent-follow-up.md) remains conditional on identifying the user's served build and tune. The public site still serves September 7 gameplay, and an old saved DK tune can produce about five times weaker launch than BASE. Expanded local checks cover 42 grounded-attack matchups and 24 defender-input scenarios; this does not verify the user's currently loaded match or claim every attack at 200% must KO.

Latest recovery correction: [October 2: DK aerial Spinning Kong recovery](../2026-10-02/donkeykong-recovery/README.md). The move now sustains lift and steering, returns to ordinary gravity, and ends in helpless fall; grounded W+G no longer triggers an unintended jump. **832 affected-area tests**, TypeScript/build and **34 production browser checks** pass on `index-1uuMguBt.js`. Numeric motion remains project calibration informed by supplementary sources; UFD supplies the attack windows and landing lag.

Latest UFD implementation: [September 23 — Link ground movement from UFD stats](../2026-09-23/ufd-stats/README.md). Walk, initial dash and run now use sourced values; initial dash gets its distinct burst, and locomotion survives saved tunes. **947 focused tests** and TypeScript pass, with real-match movement measurements. The sprite-generation attempt returned no image; art remains pending a working generator.

Latest animation follow-up: [September 23 — Link frame inspection and collision audit](../2026-09-23/frame-inspection/README.md). Character Lab now steps through normal attacks with actual sprite poses and live hit regions on the same scale. The audit identifies mismatched visible reach, reused poses and missing animated geometry. **88 focused tests**, TypeScript, the production build and three browser checks pass; screenshots and the next authoring steps are in the record.

Latest gameplay follow-up: [September 23 — input windows and responsiveness](../2026-09-23/input-windows/README.md). Early buffered jab and optional follow-up presses now activate at their authored openings. The focused **478 tests** and TypeScript check pass; overall gameplay feel still needs controller playtesting.

Current continuation: [September 23 — per-player Controls in character selection](../2026-09-23/player-controls/README.md). The approved design keeps the roster active while players edit their own controls. Controllers open their own panel with X or their card's Controls button; the mouse edits keyboard players. Named profiles preserve device ownership, shared edits create a copy, and capture consumes menu actions until release. **375 files / 11,304 tests**, TypeScript/build and **13 browser checks** pass on `index-DH_JqEPY.js`, with zero page errors. The preview is running at <http://127.0.0.1:4173/platform-fighter/>. The MainMenu/Pause library remains unchanged, and the reported skin mismatch remains unreproduced.

Previous continuation: [September 23 — connected-controller refactor](../2026-09-23/controller-boundary/README.md). Shared controller filtering and physical-index lookup now serve the affected scene input paths, and menu button history is cleared even when disconnect events are missed. Historical verification: **65 affected files / 2,079 tests**, TypeScript/build, and both relevant browser probes (**15 + 6 checks**) pass on `index-CiXJE12M.js`. The Phaser cleanup workaround remains isolated; player ownership, profiles and skins are preserved.

Previous continuation: [September 23 — playtest input and item repair](../2026-09-23/playtest-input-repair/README.md). This replaces the device selector with reusable named binding profiles and addresses the P2-keyboard/P3-controller report, capture/Confirm feedback, mouse interference, bomb effects and item lifetimes. Its complete-suite baseline is **369 files / 11,254 tests**, with TypeScript/build and all three production browser probes passing on `index-DU0SLTOZ.js`. The reported preview-to-match skin discrepancy remains **unreproduced**, with the exact fighter/colour details still needed; it is not claimed fixed.

Previous continuation: [September 23 — controller and rematch regressions](../2026-09-23/controller-session-regressions/README.md). Its **363 files / 11,204 tests** and four production browser journeys passed on `index-Cfka7DlF.js`, but the subsequent playtest exposed gaps in those checks and the device-selector design. The record below remains the historical September 14 milestone; use the current handoff for behavior and evidence.

Previous milestone: [September 22 — combined Link and combat mechanics](../2026-09-22/combat-parity/README.md), implementing the requested five areas together after the [jab pass](../2026-09-22/jab-launches/README.md).

The combined pass adds reference special/projectile launches, inward jab tips and distinct forward-air variants, capsule collision and source-ID priority, authored Link dodge timing, release parries and ledge-regrab protection, weighted staling, rage, hitlag and SDI. Lab saves preserve the new fields and its preview displays capsule regions. Exact autolink algorithms, animated bone geometry, native dodge travel/landing, full ledge timing and some shared combat rules remain explicitly unfinished; their list is in the combined record.

Previous combat verification on September 23: **361 files / 11,179 tests passed** in a clean full-suite run. TypeScript/build and all four combat browser harnesses passed on `index-DN4pX3Za.js`, with zero browser errors; that artifact matched all 270 runtime source-map entries. Detailed results and remaining accuracy gaps are in the combined record. Link's grab/throw records and release timing remain the next separate kit audit after playtesting the controller fixes.

Continuation on `rework/gameplay`, preserving the deterministic 60 Hz engine. Replay playback remains ultralow priority and 3D presentation remains deferred.

## Changes

- Link has a distinct 145 px air jump, compared with the existing 139 px full hop and 66.9 px short hop. Backward air drift preserves facing so delayed back air stays available. Walking or being launched off a floor consumes the ground-only jump slot.
- Ledge drops and human/CPU ledge jumps restore the same air-jump budget. Holding down declines a catch, and a viable jump takes precedence over catching a nearby ledge. Hitlag preserves both rising and descending trajectories.
- Ordinary Link landings commit for two or five steps. Autocancel replaces the aerial penalty with ordinary recovery; move penalties are not added together. Buffered attacks, jumps and charged specials, plus held shield, respect the first actionable step.
- Link's forward-air first hit can carry an airborne opponent into its second strike. Early back-air and up-smash strikes hold their intended link windows. Real Matter tests cover neutral opponents, defense attempts, facing, weight and escape at the edge of the hitbox.
- Platform crossing history is invalidated on a position reset. Resetting under a floating platform no longer snaps the fighter upward, and platform assists store their corrected position for the next step.
- Pickups and bomb throws respect pending touchdown and the first free landing step. Buffered bomb throws retain their direction and cancel on item loss, expiry or reset.
- New air-jump and landing values survive character save/load and appear in the Lab movement controls. The footer now explains how to reach the second page.

## Scope and remaining work

The reference heights, landing durations and authored strike windows have source evidence. The terminal-speed duration used to classify hard landing and the motion carry used for forward air are calibrated for this engine; they are not exact ports of Ultimate's internal formulas.

Special and air-dodge landing commitment continues in the [September 15 record](../2026-09-15/README.md), followed by [down-air rebound](../2026-09-15/rebound/README.md). Remaining mechanics work includes collision/launch calibration, the precise directional dodge rule, and detailed Link/roster parity. Human controller, sound and balance acceptance is still needed. The existing sprites limit pose detail; this pass keeps simulation poses readable without claiming new animation art.

Detailed evidence: [air movement](air-movement.md), [ordinary landing](landing.md), [combat and item integration](combat-review.md), and [browser review](physics/README.md).

## Verification notes

The aggregate run identified two fixtures that still expected free air drift to turn the fighter, and one jab-chain fixture that pressed attack on Link's initial soft landing. Those tests now retain their acceleration and combo assertions under the new rules. The smoke fixture also passed a copied body to its ground-contact event; using the real body makes its grounded jump tests exercise the actual three-step squat. Added grounded turning coverage for all thirteen fighters. The three affected files pass **383 tests**.

The initial aggregate run was interrupted when WSL reported resource exhaustion and restarted while finishing an upgrade. No complete-suite result is claimed for `full-tests-interrupted.txt`. Final verification uses four test workers and sequential browser runs. The production build passed after correcting TypeScript annotations in the movement parser and a fixture.

The completed [aggregate run](full-tests.txt) reports **320 files passed, 10,428 tests passed, and one failed test**. Its only failure was the factory save/load fixture still tuning the ground jump while testing a raw airborne jump. That fixture now explicitly authors and checks `airJumpImpulse` and `airJumpRiseAccel`, verifies that ground tuning remains intact, and preserves its move/animation assertions. The [final factory rerun](factory-final-tests.txt) passes all **23 tests**. Thus all **321 files / 10,429 distinct tests** are verified across the aggregate run and targeted rerun; there was no further runtime change or fresh all-files rerun after that test-only correction.

Production build: **passed**, artifact `index-DaTd3UWA.js`. See [build output](build.txt).

Final TypeScript check: **passed** after the fixture edits (`tsc --noEmit`, exit 0).
Whitespace verification: **passed** (`git -c core.autocrlf=false diff --check`).

All four production browser harnesses passed against the same artifact with
**zero page errors**:

- [Physics, landing, platform resets and Lab/menu acceptance](physics/production/physics-sep14.json): 145 px air jump, preserved facing, 2/5-step landing, earliest buffered actions, correct ledge-walk resources, stable float contacts, editor page visibility and hint fit.
- [Grounded movement regression](production/link-movement-probe.json): full/short heights remain 139/66.9 px, with full/short/fast-fall durations 45/32/31/23 integrations including contact and 4.62 px/step peak air speed.
- [Bomb and charge integration](production/link-bomb-charge-probe.json): carrying, transfer, throwing, remote detonation and grounded charge behavior remain valid.
- [CPU-first controls](production/cpu-first-controls.json): four actual menu/match/restart scenarios retain P2's own controls while P1 is a CPU.

Production preview is available at `http://127.0.0.1:4173/platform-fighter/`.
Browser physics uses manually stepped resolver input; menu checks use keyboard
events. This is not a human gamepad, audio or balance acceptance claim.
