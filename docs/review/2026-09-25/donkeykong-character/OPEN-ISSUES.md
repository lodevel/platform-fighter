# Donkey Kong — open issues

Start here when asked to "correct Donkey Kong". This list was built at the end
of the 2026-09-25 session from an audit of the shipped strips (after two retry
rounds and the packer residue fix) and a cold-start review of this record. The
raw audit evidence (measurements, file hashes) is in `art/open-frame-defects.json`;
where its cause/fix fields differ from the tables below, **the tables win** — they
were reconciled against the retry history (for example, a reseed already tried and
reverted is not proposed again). The kit, ledger and verification history are in
`README.md`.

State on 2026-09-25: the kit, tools, tests, strips and this record are in the
working tree and **uncommitted** (the user has not asked for a commit). A
`git clean` would destroy most of it.

## Decide with the user first

1. **Scope of "correct".** Section 0 (bugs found in play) comes first
   whatever else is chosen. The user decided on 2026-09-25 to ship the art as
   is and "maybe use a better image tool later". Options: (A) the tool bugs
   and cheap art fixes below, (B) a new image model for the frames the local
   Z-Image Turbo model cannot do, (C) engine gaps, (D) a commit. The default
   proposal is A, then ask about B/C/D.
2. **Image tool.** No replacement has been chosen. Frames marked
   `better-image-model` below failed with every lever the pipeline has (new
   seed, ControlNet strength 1.0).
3. **Record location.** Continue this folder or open
   `docs/review/<new date>/donkeykong-character/`; the probe takes
   `PF_PROBE_OUT` for a new folder.

October 6 full attack-data correction: [current comparison and match evidence](../../2026-10-06/dk-all-attack-values/README.md) supersedes the numeric/variant gaps below. Headbutt now applies its 25 shield-damage bonus; all normal/cargo throw records, grab variants, aerial/charged/angled regions and recovery attack numbers are implemented and saved. Native bury, bone intangibility, exact autolink transport and the accepted existing art remain separate limitations.

## 0. Found in play on 2026-09-28 (highest priority)

October 5 high-damage follow-up: the [launch/scale record](../../2026-10-05/damage-knockback/README.md) corrects the flat floor/blast scale, fast-launch platform masking, erroneous fixed-KB weight flags and distinct inner spin launch records. Contextual angle-367 transport now lets grounded spin reach its finisher in all 32 final match scenarios. Exact autolink transport and moving-anchor/cap behavior, rear hit, grounded travel and existing art defects remain gaps; this does not close the entire fighter audit.

From the user's match (DK vs DK, flat, items medium; replay and screenshot in
`replay-2026-09-28/`). `tools/replay-resim.mjs` re-simulates that replay on a
fresh page and reproduces the live match to the frame (player 1's last stock
at frame 11842 = the recording's last frame). Investigation record: the four
findings below were each confirmed by counterfactual runs and re-checked by a
second agent.

| # | Problem | Cause | Fix direction |
| --- | --- | --- | --- |
| P1 | **A fighter floats up and dies off the top** ("lost gravity"). Engine bug, any fighter. In the replay, idle player 1 is up-thrown at 11384; his hitstun ends mid-air at 11418; at 11430–11437 he falls onto player 2's head; from 11439 he rises at a constant 3.37 px/frame for 404 frames until the top blast zone. | Two mechanisms combine. (a) `referenceLaunch` outlives hitstun: it is cleared only on landing or a new action (`Character.ts` ~4009–4013), and while active `preparePhysicsStep` (~3909–3925) cancels world gravity and adds only its own capped accumulator, so any velocity written from outside never decays. (b) `MatchScene.updateFighterSeparation` (~6059–6116) resolves fighter overlap vertically by *adding* up to 3.5 px/frame of velocity per frame, measured on Matter's velocity-stretched bounds; that push became a permanent upward drift. | Clear `referenceLaunch` once hitstun has ended and the launch velocity has decayed, and resolve fighter-fighter overlap horizontally (or never add upward velocity). Tested: either change alone stops the float in this replay; clamping the push without the first change leaves the fighter hovering. Add a physics test with the replay's shape: up-throw an idle fighter, let him fall onto the thrower's head. |
| P2 | **Aerial lift/drift fixed 2026-10-02.** The historical one-shot -6 impulse used ordinary gravity and lost recovery height. | UFD supplies attack windows/landing lag, not motion. Primary status scripts confirm speed reset, reduced gravity, steering and finite special-fall transition; supplemental numeric parameters remain approximate. Script frame 68 is not independently verified as gameplay frame 44. | Optional sustainedRise now supplies -4.5 entry vy, gravity 0.02975 through game frame 43, preserved entry momentum and stick acceleration 0.25 toward max 8.5. Serialization/factory preserve it; hitlag, interruption and landing are covered. **13 physics and 34 production-browser checks pass** in [the October 2 record](../../2026-10-02/donkeykong-recovery/README.md). Grounded drift, exact aerial total, arm intangibility and exact Ultimate motion parity remain gaps. |
| P3 | **Grounded keyboard jump fixed 2026-10-02.** Up also means jump on P1 W, and old jump buffers launched DK after starting grounded Spinning Kong. | Successful non-charge grounded and aerial up-special starts now clear tap-jump/input buffers and pending jumpsquat; the charge branch already did. Failed starts keep their buffers. | Real Matter tests and production W+G keyboard checks pass for special 0/1/2 frames after Up, staying grounded through 26 frames. See [the October 2 record](../../2026-10-02/donkeykong-recovery/README.md). Aerial speed resets to the authored rise speed, as supported by the status initialization. |
| P4 | **Replays with items do not reproduce across matches.** | (a) The item type is a round-robin counter, `MatchScene.itemSpawnTypeIndex` (~1021, 1382–1394), set once per page and never reset, so the n-th item of a match depends on how many items earlier matches in the tab spawned (rematch, pause-menu restart and Lab test fights reuse the same scene). The comments at ~1015–1017 and ~1379–1380 claiming it is RNG-keyed and snapshotted are wrong. (b) `RecordingController.buildReplayFile` / `buildReplayJson` never pass `getItemSpawnEvents()`, so every saved replay has an empty item log. (c) `BaseStage` builds the simulation geometry from `scene.scale.gameSize` (~374), so anything that resizes the game changes the stage but not the fighters. | Reset the counter at the top of `create()` (next to the other reuse-guard resets ~1858–1867); pass the item log into the replay from both call sites (~1605, ~5388); build stage geometry from the fixed design size. Note `tools/bomb-explosion-regression.mjs` writes the counter directly. |
| P5 | **Smash attacks are nearly impossible on a keyboard** (any fighter, reported with DK's forward smash). In the user's replay, 16 grounded attack presses with left or right held gave 9 dash attacks, 1 forward tilt, item swings and **zero forward smashes**; in 15 of them the direction key had been down 3 or more frames before the attack key (9 while running). Down + attack gave down tilts; up + attack jumps first because up is also jump on this binding. | `classifyGroundedAttack` (`src/characters/groundedAttackInput.ts`) fires a smash only on a "flick": the stick at rest on the previous frame and past 0.7 on the SAME frame the attack key goes down. A keyboard direction is either 0 or 1, so both keys must go down within one 1/60 s frame. The engine already supports a dedicated heavy press (`attackHeavy` → `heavyJustPressed`, checked first), but `buildCharacterInputFromResolver` (`src/input/InputResolver.ts` ~843) never sets it and no binding exists. Also: DK's forward smash charges for up to 60 frames while attack is held (`DONKEYKONG_SMASH.charge.maxChargeFrames`, charging from frame 13), and the user held attack 20–58 frames, so even a successful smash would wait up to a second before hitting. | Ultimate's model: attack (A) and special (B) are separate buttons; a smash comes from attack with a hard tilt, from the right stick (set to smash attacks by default) or from the optional A+B smash setting. Mirror that: add a smash (heavy) key to the keyboard and gamepad bindings and the Controls screen (right stick on a gamepad), wired to `attackHeavy` (up/down + smash key already routes to up/down smash); optionally widen the keyboard flick to a few frames of lead. Keep dash attack from a run (that is Ultimate's behaviour). Add an acceptance check with the user's timing (direction held 3–10 frames, then attack). |
| P6 | **Hand Slap (grounded down special) barely hits.** In the user's replay: 26 grounded Hand Slaps, 4 hits, all with the opponent 60–68 px away; it missed a grounded opponent at 99, 114, 116 and 156 px. | Our kit has ONE ground-only circle, radius 51.5 px (10.3 units), centred at DK's feet, so it only reaches ~51.5 px from his centre. The captured ACMD script really does create four 10.3-unit hitboxes at offset (0, 0, 0) on the `top` bone — the status code moves them afterwards, so the script alone gives no positions. UFD's hitbox GIF (`DonkeyKongHandSlapG`, frames 4–5 and 13–14) shows where they end up: four circles in a row, centres at about −23.7, −8.3, +7.9 and +23.4 units from DK's middle (measured with the circle height = one 20.6-unit diameter → 13.2 GIF px per unit), i.e. a reach of about ±34 units ≈ ±170 px. | Replace the single circle with four ground-only circles at x ≈ ±40 px and ±118 px (radius 51.5 px), at ground level, in `tools/gen-donkeykong-kit.py` for both slap windows; mark the geometry "approximate — measured from the UFD overlay". Keep ground-only (sourced): a slap never hits an airborne opponent, which is also why the second slap misses someone the first one launched. Re-check the aerial variant's hand hitboxes the same way. Add a real-physics test: a grounded opponent at 150 px takes the 14 % slap. |
| P7 | **Main-menu Controls will not let player 1 pick the gamepad preset**, even when player 1 joined with a controller (reproduced in the preview with a simulated pad). A controller-only user also gets stuck: focus starts on player 1's first binding row, the first A press opens a keyboard-only capture, and every pad button is then ignored until Start. | Main-menu Controls is a profile library editor: it opens `RebindingScene` with `players: []` (`MainMenuScene.ts` ~244) on purpose, so `ControlsProfileSession` (~25–27) gives each column a fixed device by number — columns 1–2 keyboard, 3–4 gamepad — and filters presets by that device (`profileOptions` ~42–45, `selectProfile` ~50, the Profile chip `RebindingScreen.ts` ~1272–1283, pad capture skipped for keyboard columns `RebindingScene.ts` ~401). The actual assignment works elsewhere: a pad-joined player 1 plays on `gamepad-standard`, and both the character-select editor (press X on that pad) and Pause → Controls show it. Smaller: clicking a controller-owned player's CONTROLS button with the mouse does nothing and says nothing (`CharacterSelectScene.ts` ~1715–1716); there is only one built-in gamepad preset, so its Profile row cannot cycle. | Needs a user decision. Minimal: let columns with no active player pick presets of either type (switch that column's preview device to the preset's type; accept any connected pad for capture there), start focus on the Profile chip, and show a hint when a pad presses into a keyboard column. Bigger: pass the last character-select roster into main-menu Controls so column 1 shows the pad-joined player 1 as a gamepad player (the 2026-09-23 milestone dropped the roster deliberately). Either way, show feedback when a controller-owned CONTROLS button is clicked. |
**Evidence caveat.** 23 probes in `tools/` call `game.scale.setGameSize(1440, 1000)`,
including this record's `tools/dk-kit-acceptance.mjs` and `tools/dk-visual-shots.mjs`.
That shrinks the stage to 0.75× (offset 95 px) while the fighters stay full size,
so their stage-relative results and the screenshots' proportions are not the live
game's. Fighter-only measurements (hop heights, speeds, damage) are unaffected.
Remove the resize (as done in `tools/replay-resim.mjs`) before re-running them.

## 1. Tool bugs (fix first: they cause art defects)

| # | Bug | Effect | Fix |
| --- | --- | --- | --- |
| T1 | Guide files are keyed by the pose prompt truncated to 60 characters (`pose_hash` in `tools/ufd-pose-canny.py`, `poseHash` in `tools/gen-frames-cn.ts`). Three pairs of different prompts share one file; the last write wins. | `usmash 0` was rendered from `dsmash 0`'s guide, `fair 4` from `uair 0`'s, `run 0` from `run 6`'s. (`jab 0–3` and `attack 0–3` share guides on purpose: identical prompts.) | Key guides per `clip:index` (or a full-prompt hash) in both tools. Changing the key scheme orphans every existing guide: rebuild ALL DK guides (no `--clips`), prune the old keys from `assets/gen/canny-library/manifest.json`, re-stage them into `~/ComfyUI/input/`, and make a missing guide a hard failure in `gen-frames-cn.ts` (today it logs `MISS … skipped` and exits 0, so a clip silently renders nothing). Then diff old vs new guides (only usmash 0, fair 4, run 0 should change) and re-render those three. |
| T2 | One scale for every UFD GIF, but Ultimate Frame Data drew the GIFs at different zooms. | Confirmed: the whole `jab2` strip is ~1.6–1.7× too large (cells carry 12.8–14.6k opaque px against 5.1–5.8k for jab and idle), so DK balloons when jab chains into jab 2. A noisy screen (`art/ufd-gif-zoom.json`, median skin area per GIF) also flags smash, neutral_special, up_special, utilt, uthrow and several throws for a check. | Permanent: measure each GIF's zoom with a pose-independent feature — the hurtbox-bubble radii UFD draws are fixed per body part, so the median radius of the bubbles in a GIF divided by Jab1's gives its zoom (accept a GIF within ±10 % of Jab1) — store a per-GIF factor, apply it in `ufd-pose-canny.py`, regenerate the clips outside tolerance. Interim for jab2 only (no re-render): a per-clip pre-scale in `pack-clips.cjs` (it has no per-clip scale yet) about the frame's horizontal centre and its ground line 144 px above the canvas bottom — scaling about the bottom edge would sink the feet ~58 px. The factor is 0.53–0.63 (skin-area ratio 1.87 → 0.53; packed-cell area ratio ~2.5 → 0.63): pick it by matching jab2's head/eye width to jab's in the packed cells. |
| T3 | `jab` pose 2's guide came from UFD frame 6 (the retract) because the tool shifts to an overlay-free neighbour. | The jab has no drawing with the fist extended. | Pin the schedule entry to `DonkeyKongJab1:4` or `:5` with `"exact": true` (in whichever record folder is chosen; the tools default to the 2026-09-25 `pose-schedule.json`), rebuild the jab and attack guides, re-render jab 2 and attack 2 (same drawing). |
| T4 | `up_special` pose 3 (Spinning Kong frame 11) exceeds the largest canvas (1792×1536). | Fingertips cut at the cell edge. | Add a 2048-wide canvas to `CANVASES`, rebuild that guide, re-render. |
| T5 | The packer's residue keying still misses a few pink pockets and once over-keys. | See the `packer` rows below (down_special_air 6, up_special 2, uthrow 2, utilt 3, usmash 0; a hole punched into side_special 1's arm). | Tune `LOOSE_MAGENTA` / `SMALL_POCKET` in `tools/pack-clips.cjs` against those six cells, or hand-clean their source renders in `assets/gen/frames/donkeykong/` (down_special_air-6, up_special-2, uthrow-2, utilt-3, usmash-0; side_special-1 needs the keying relaxed, not cleaned). |
| T6 | Foot registration: some grounded frames sit below the shared ground line. | DK sinks into the stage for one frame: smash 2 (~13–15 px), dash_attack 1 and jab2 0 (~6 px), dtilt 2. | Re-render, or trim those renders' ground shadow before packing. |

**Whole-kit rescale warning.** The packer fits ONE union rect of every frame
into the 256 px cell, and today the union's width (1720 px, set by the widest
reach) is what limits the fit. Any change to a reach extreme — T2's jab2
pre-scale, T4's wider canvas, a re-rendered wide pose — rescales all 33
strips. After every repack, re-run `tools/contact-sheet.py` (it prints the
idle height, foot gap and the resulting `visualScale.ts` values), update
`visualScale.ts`, and re-inspect every strip, not just the changed clip.

**Tool features some fixes need (not built).** Three rows below point at
guide work the pose tool cannot do yet: removing the translucent hurtbox
bubbles from the silhouette (bair 0), emitting interior lines rather than an
outline only (jab2 3), and inserting a hand-made guide (dtilt 1/3/4). A
hand-made guide must match the batch registration: reference standing height
600 px, a canvas from `CANVASES`, the pose's lowest point 144 px above the
canvas bottom, the silhouette centroid on the horizontal centre, edges drawn
white on black like `edge_map()`, saved as
`assets/gen/canny-library/<key>.png` with a `manifest.json` entry under the
key `gen-frames-cn.ts` looks up (after T1: `donkeykong__<clip>-<index>`).

## 2. Art frames still wrong on the shipped strips

"Frame" is the cell index in `assets/characters/donkeykong/animations/<clip>.png`
(0-based, DK facing right). `attack` is byte-identical to `jab` (same prompts,
same guides); fix jab and attack together.

| Clip | Frame | What is wrong now | Cause | Cheapest fix |
| --- | --- | --- | --- | --- |
| jab / attack | 0 | darker maroon fur than idle and jab 1, a brightness flicker at jab start | render palette | accept (minor) |
| jab / attack | 2 | no forward punch (see T3) | guide | T3 |
| jab / attack | 3 | upright stand, hands on hips, taller than idle; guide is the crouched retract | ignored guide | strength 1.0 (never tried at 1.0) |
| jab2 | 0–3 | whole strip ~1.7× oversize (see T2); frame 0 also ~6 px below ground | GIF zoom | T2 |
| jab2 | 3 | crimson hook-shaped appendage behind the rear foot; no necktie; fists-by-the-face pose not drawn (the outline guide cannot express it) | guide | guide with interior lines, or a better model |
| dtilt | 1, 3, 4 | upright stand instead of the low flattened reach/retract; reseed and strength 1.0 both failed | model | better image model, or a hand-made guide |
| dtilt | 2 | active frame 1.5× taller than frame 0 (86 vs 59 px), feet below the ground line; the arm does punch forward at hip height | guide | re-render with the T6 check (minor) |
| dash_attack | 0 | tall overhead hump and raised fist instead of the low running crouch | ignored guide | strength 1.0 |
| dash_attack | 1 | pose fine, feet ~6 px below ground | registration | T6 |
| dash_attack | 2 | featureless red roll-ball, black speck on its rear edge | render | reseed |
| dash_attack | 3, 5 | upright stands instead of the roll tuck / crouched uncurl | model | better image model |
| dash_attack | 4 | upright stand instead of the decelerating tuck, plus a glowing orb on the belly: the UFD frame (DashAttack:25) carries a white hit-effect flash that the silhouette includes | guide + model | mask the hit effect out of the guide, then a better model |
| bair | 0 | feature-poor red ball: small head, no chest patch, no tie (three seeds failed three ways on the bubble-padded ball guide) | guide | tighter guide (strip hurtbox bubbles), then render |
| bair | 1 | ignores the tucked-ball guide: large standing, striding DK ~1.75× the guide | ignored guide | strength 1.0 |
| bair | 2 | the kicking rear leg is mostly tucked behind the body (minor) | render | accept |
| bthrow | 1 | opaque dark-maroon mass under the arched front arm (reads as a hole) | render | packer or reseed |
| bthrow | 4, 5, 6 | upright right-facing poses; the guides show DK low and turned (facing left) | guide / model | check guide facing, then render |
| smash | 1 | smeared rear hand with a thin spike (minor) | render | accept |
| smash | 2 | two off-palette prongs on the upper back (pink/magenta, ~110 px) that follow fingertip prongs in the guide; feet ~13–15 px below ground. Seed 4243 was tried and was worse (reverted) | guide + render | hand-clean the prongs in the source render (or fix the guide's back outline, then a new seed), T6 |
| down_special_air | 2, 4 | muzzle, raised fist and feet white instead of tan (frame 2 strongly, frame 4 milder; the audit saw a lighter tint on 1 and 3 too). Seeds 4242/4243/4244 all tried on frame 2 | render palette | recolour the white skin to tan in the source renders, or a better model |
| down_special_air | 6 | pink wedge (~43 px) in the torso/hip notch | key residue | T5 |
| up_special | 2 | headless red body with a tan belly oval (the back-quarter view reads as a blob); pink nub on the right flank, magenta rim on the left | render + residue | T5 for the pink; the pose is a back view in the source, so accept or a better model |
| up_special | 3 | chest and hands saturated yellow-orange; fingertips cut (T4) | render palette | reseed, T4 |
| usmash | 0 | magenta halo along the head; rendered from dsmash 0's guide (T1) | T1 + residue | T1 |
| fair | 4 | rendered from uair 0's guide (T1) | T1 | T1 |
| run | 0 | rendered from run 6's guide (T1) | T1 | T1 |
| run, jump, hurt, shield | all | no UFD source: silhouettes come from batch-1 text-drafted renders, so DK runs upright instead of Ultimate's knuckle gallop | no source | video/hand-made silhouettes, or a better model |
| uthrow | 2 | vivid magenta blob (~21 px) in the hand/torso crease | key residue | T5 |
| utilt | 3 | short magenta streak between the feet | key residue | T5 |
| side_special | 1 | a hole punched into the arm/torso silhouette with a magenta rim (packer over-keying) | packer | T5 |
| ledge hang, ledge attack, getup attack | — | no dedicated art. `pose-schedule.json` has `ledge_attack` (its pose 0 is the hang) and `getup_attack` (from `donkeykongGetupAttackU` only; a `…D` source is also extracted) entries, but no guides were ever built (the clips are not in `assets/gen/donkeykong-clips-batch2.json`), there are no `ASSET_KEYS` (`sync-manifest-sheets.py` refuses unknown sheets) and no fighter routes ledge/getup states to dedicated sheets (`defensiveAnimationState` emits ledge.hanging/climbing/rolling with `LEDGE_ANIMATION_FRAMES`) | not built | design first: clip prompts, sheet names and keys, the route in the sprite driver, cell counts, roster-wide test updates |

Fixed by the end of the session (no action): bthrow 2, down_special_air 3,
up_special 3's detached streak, up_special 6, jab 2's disc and palette.

Palette note: retried frames used seeds 4243/4244, so their fur tone can differ
slightly from the seed-4242 frames. `art/open-frame-defects.json` holds the
measured fur colours.

## 3. Engine gaps (need design, some need source data)

| Gap | Status | Source data |
| --- | --- | --- |
| Reference recipient physics across the original roster | partial | Only DK/Link author native launch gravity/speed-up profiles; other recipients currently use fallback native weight 100 with uncompressed Matter flight. [October 5 audit](../../2026-10-05/damage-knockback/200-percent-follow-up.md) measures slower displayed ejection but not reduced forward-tilt travel; custom recipient physics need explicit authored calibration. |
| Headbutt bury and aerial hop | missing (25 shield damage corrected October 6) | the scripts only say `effect=bury` (`sources/dk-scripts-digest.txt`); no bury duration or escape rule is sourced |
| Cargo carry and the four cargo throws | numeric records, carry entry and four release routes corrected October 6; movement/hold/attachment remain calibrated | see the October 6 exhaustive comparison and saved-match acceptance |
| Angled forward tilts | corrected October 6: up/down variants and saved input routes | UFD and pinned AttackS3Hi/Lw records; both facings contact in production |
| Trip attack | corrected October 6: trip state, separate windows and sourced total | pinned SlipAttack script and motion cancel frame 50; both facings contact |
| Per-fighter ledge option tuning | missing | the Lab does not serialize it; ledge timings not sourced |
| Limb intangibility (f-tilt 6–9, u-tilt 5–11, d-tilt 5–7, f-smash 20–26 + no-clang, u-smash, d-smash, u-air head 5–10, Giant Punch arm 4–20, Spinning Kong arms 10–38) | approximate | sourced; the engine has one hurtbox per fighter |
| Giant Punch full-charge 47-frame total, aerial 6 %/25 % variant | corrected October 6, with integer partial damage and separate full/air regions | complete source comparison, real keyboard and saved-match checks pass; arm intangibility remains missing |
| Spinning Kong exact autolink transport, rear hit, horizontal travel | rear regions corrected October 6; transport/travel remain approximate | all per-region numbers and masks compared; 366/367 native transport and grounded travel remain gaps |
| Dash/pivot grab timing and ground/air capsules | corrected October 6: standing/dash/pivot startup 7/10/11 | source comparison and 12 actual contact/state checks in production; movement retention remains authored |
| Getup attack side order, roll distances, short hop lands 2 frames early, fall ramp calibrated to full-hop airtime, air jump not measured in the real engine | approximate | roll travel not sourced |
| Hand Slap shield setoff ×0.58, spot-dodge cancel variant, directional air-dodge landing lag | approximate; per-throw release/recovery corrected October 6 | sourced; these shared interaction gaps remain |

## 4. Resume runbook (this machine)

Everything under `assets/gen/` and `~/ComfyUI` is git-ignored or outside the
repo and exists **only on this machine**: the renders
(`assets/gen/frames/donkeykong*`), the guides (`assets/gen/canny-library/`),
the extracted UFD frames (`assets/gen/dk-ufd/`, reproducible from
`sources/ufd-assets.json`), and the idle keyframe the packer needs
(`assets/gen/_spike/cn-donkeykong.png`; a copy sits in this record as `art/idle-keyframe.png`, which is itself untracked until committed).
Archives: `donkeykong-batch3-round0/` holds the frames as they were before
retry round 1, `donkeykong-batch3-round1/` before round 2. Four shipped frames
were hand-reverted to an earlier render: jab 2 and smash 2 (seed 4242,
round0), bair 0 and pummel 1 (round1).

```bash
# 0. baseline (Node 22). Known pre-existing failures on this branch:
#    Character.landing.physics.test.ts "caps Link air drift at the authored 4.62 px/step…"
#    characterJabSerializer.test.ts "edits 'jab' opening…" and "edits 'jab2' opening…"
npm run typecheck && npx vitest run

# 1. ComfyUI (see memory wsl-toolchain-setup) + model overrides
cd ~/ComfyUI && setsid nohup .venv/bin/python main.py --listen 127.0.0.1 --port 8188 --disable-smart-memory > ~/ComfyUI/comfy.log 2>&1 &
export PF_COMFY_UNET=z_image_turbo_int8_convrot.safetensors PF_COMFY_CLIP=qwen_3_4b_fp8_mixed.safetensors

# 2. guides for the clips you fix (needs scipy → ComfyUI's venv python), then stage them
~/ComfyUI/.venv/bin/python tools/ufd-pose-canny.py docs/review/2026-09-25/donkeykong-character/pose-schedule.json \
  assets/gen/donkeykong-clips-batch2.json --extracted assets/gen/dk-ufd/extracted \
  --reference DonkeyKongJab1:0 --fallback-frames assets/gen/frames/donkeykong-batch1 --clips jab,attack
cp assets/gen/canny-library/donkeykong__*.png ~/ComfyUI/input/

# 3. archive, then render ONLY the frames you fix (never without PF_GEN_ONLY)
mkdir -p assets/gen/frames/donkeykong-batch3-round2 && cp assets/gen/frames/donkeykong/{jab-3,attack-3}.png assets/gen/frames/donkeykong-batch3-round2/
PF_GEN_ONLY="jab:3,attack:3" PF_GEN_SEED=4245 PF_GEN_STRENGTH=1.0 node node_modules/tsx/dist/cli.mjs tools/gen-frames-cn.ts assets/gen/donkeykong-clips-batch2.json
#    if idle-0.png reappears: move it out (the packer synthesises idle from the keyframe)

# 4. pack, calibrate, register
node tools/pack-clips.cjs donkeykong
python3 tools/contact-sheet.py donkeykong docs/review/<date>/donkeykong-character/browser/contact-sheets
#    ↑ prints the idle height, foot gap and the visualScale values; update
#      src/characters/visualScale.ts (donkeykong display size, foot offset) if they changed
python3 tools/sync-manifest-sheets.py donkeykong      # only if a clip's cell count changed
#    if a clip's drawings or cell count changed: python3 tools/dk-animation-counts.py prints the
#    derived startup/active/recovery counts; copy changed ones into the `animation:` literals of
#    tools/gen-donkeykong-kit.py, then python3 tools/gen-donkeykong-kit.py && npx vitest run src/characters/DonkeyKong.test.ts

# 5. verify (preview must be up before the probes)
npm run typecheck && npx vitest run && npm run build
npm run preview > /tmp/preview.log 2>&1 &
until curl -s -o /dev/null http://127.0.0.1:4173/platform-fighter/; do sleep 1; done
PF_PROBE_OUT=docs/review/<date>/donkeykong-character/browser node tools/dk-kit-acceptance.mjs
PF_REWORK_URL=http://127.0.0.1:4173/platform-fighter/ node tools/dk-visual-shots.mjs docs/review/<date>/donkeykong-character/browser/shots
#    stop the preview afterwards: kill the node process listening on :4173 (ss -ltnp | grep 4173)
#    visual inspection: Workflow({scriptPath: 'docs/review/2026-09-25/donkeykong-character/browser/visual-acceptance-workflow.js',
#      args: {sheets, record, round, clips: [...], retried: {clip: [frames]}}})  — `retried` is required
#      (use {} if none); save the returned {rows, remaining} as browser/visual-acceptance-round<N>.json.
#    after rebuilding guides, copy assets/gen/donkeykong-ufd/pose-guides/report.json to art/pose-guides-report.json.
```

## 5. If the user asks for a commit

The working tree also holds the branch's earlier uncommitted work (AI, input,
scenes, skills…), and several shared files carry both that work and the DK
changes, so stage by review, not by `git add -A`. DK work of 2026-09-25:

- New: `src/characters/donkeykongUfdStats.ts`, `DonkeyKong.physics.test.ts`,
  `Character.superArmor.test.ts`, `spriteAnimationDriver.sheets.test.ts`;
  `tools/ufd-pose-canny.py`, `sync-manifest-sheets.py`, `gen-donkeykong-kit.py`,
  `dk-animation-counts.py`, `contact-sheet.py`, `dk-kit-acceptance.mjs`,
  `dk-visual-shots.mjs`; `assets/gen/donkeykong-clips-*.json`; this record
  folder; the new strips under `assets/characters/donkeykong/animations/`
  (and the deleted `jab3.png`). Exclude `tools/__pycache__/`.
- Modified (DK hunks inside possibly shared files): `src/characters/DonkeyKong.ts`,
  `DonkeyKong.test.ts`, `Character.ts` (super armour, shockwave repeat),
  `attacks.ts`, `downSpecialSchema.ts`, `characterSerializer.ts`,
  `fighterMovementProfiles.ts`, `spriteAnimationDriver.ts`,
  `simulationSpriteAnimation.ts`, `CharacterEditorScene.ts`,
  `characters/index.ts`, `visualScale.ts`, `assets/manifest.ts`,
  `Roster.test.ts`, `groundedNormalDriver.test.ts`,
  `movesetAnimationDriver.test.ts`, `assets/characters/donkeykong/frames.json`;
  `tools/gen-frames-cn.ts`, `pack-clips.cjs`, `comfy-style.ts`;
  `docs/ART-PIPELINE.md`, `docs/PROJECT-ROADMAP.md`, `CLAUDE.md`,
  `package.json` (preview `--base`), the add-character skill references and
  `.claude/skills/add-weapon/SKILL.md`.
