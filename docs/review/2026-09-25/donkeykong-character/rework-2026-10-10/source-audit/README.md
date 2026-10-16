# Donkey Kong source audit (2026-10-11)

Read-only audit of every Donkey Kong gameplay value against the sources of truth set by the
user rule of 2026-10-11:

- UltimateFrameData (UFD): https://ultimateframedata.com/donkey_kong and https://ultimateframedata.com/stats
- SmashWiki: https://www.ssbwiki.com/Donkey_Kong_(SSBU), its move subpages (`/Neutral_attack/Hit_1`,
  `/Forward_tilt`, ..., `/Up_special`, `/Down_special`, `/Floor_attack_(front|back|trip)`, `/Edge_attack`) and the
  mechanic pages Edge, Shield, Perfect shield, Air dodge, Spot dodge, Roll, Jump, Dash, Walk, Traction, Hitlag,
  Shieldstun, Lag, Grab, Grab release, Pummel, Footstool Jump, Tech, Tripping, Stale Moves, 1v1 multiplier,
  Smash attack, Knockback, Stun, Short hop, Jump-canceling.

Native files (scripts, motion list, param dumps) are supporting evidence only and lose every conflict.
They are quoted below only to break a tie between UFD and SmashWiki, or to explain where a value came from.

- Row data: `audit.json` (1291 rows; `meta` holds the counts). Every row has `area, item, engineValue,
  engineLocation (file:line), sourceValue, sourceQuote, sourceUrl, verdict, notes`.
- Snapshot: repo HEAD `26e6e3f` plus the uncommitted working tree on 2026-10-11 (DK files were modified and
  `donkeykongAttackData.ts` is untracked). Another agent edits `src/` at the same time, so line numbers can drift.
- Pages were fetched on 2026-10-11 as raw HTML (UFD) and `action=raw` wikitext (SmashWiki).
  No file under `src/`, `assets/`, `tools/` or `inventory.json` was modified.

## Unit conversion used

The conversion is 5 world px per native unit. One native frame is one fixed 60 Hz step. Speeds in
u/frame × 5 give px/step, and accelerations in u/frame² × 5 give px/step².

I checked it both ways:
- Walk: 1.365 × 5 = 6.825, which equals `walkMaxSpeed`.
- In-match measurements (locomotion qualification): dash 10.45 = 2.09 × 5, run 9.37 ≈ 1.873 × 5 = 9.365, full-hop rise 170.0 = 34 × 5.
- Geometry: SmashWiki's standing grabbox (z up to 13.7, r 5.8) gives 19.5 u, which is UFD's "Grab Range 19.5".

No value needed `UNIT_UNCERTAIN`.

## How damage multipliers work in the engine

The brief asks about a "1v1 1.05× multiplier". In the engine, 1.05 is the **freshness bonus**
(`STALE_FRESH_MULTIPLIER`, `combat.ts:721`). It applies to any move that is not in the stale queue, in any
player count. That matches SmashWiki Stale Moves (Ultimate: 1.05). Ultimate's separate **1v1 multiplier is
1.2× damage taken** (2 players, items off; SmashWiki "1v1 multiplier"). It does not change hitlag, hitstun or
shieldstun, and the engine does not model it. See MISMATCH M18 below.

UFD's shield-stun column is consistent with fresh damage (× 1.05). Its shield-lag column is mostly consistent
too, but two rows look computed without freshness (see "UFD vs SmashWiki" below).

## Counts per area

| area | MATCH | MISMATCH | SOURCE_SILENT | UNIT_UNCERTAIN |
|---|---|---|---|---|
| conversion | 1 | 0 | 0 | 0 |
| movement | 27 | 3 | 9 | 0 |
| ground attacks | 54 | 4 | 0 | 0 |
| aerials | 32 | 0 | 0 | 0 |
| specials | 40 | 6 | 2 | 0 |
| grabs-throws-cargo | 49 | 5 | 3 | 0 |
| getup-ledge-trip attacks | 12 | 1 | 0 | 0 |
| ledge | 6 | 5 | 0 | 0 |
| defense | 18 | 8 | 4 | 0 |
| tech-footstool-trip | 3 | 0 | 6 | 0 |
| combat-universal | 3 | 1 | 1 | 0 |
| shield lag/stun (engine formula vs UFD, per move) | 69 | 1 | 0 | 0 |
| hitbox values (every SmashWiki hitbox row × damage/angle/BKB/KBG/FKB/radius/hitlag/shield damage/top-bone y,z) | 904 | 14 | 0 | 0 |
| **total** | **1218** | **48** | **25** | **0** |

The 48 MISMATCH rows reduce to 32 distinct findings (M1–M32; M33 repeats M13): 12 of the hitbox rows are
the same Spinning Kong hit-1 swap, 2 are the dash-attack shield-damage field, the 3 normal-throw
invincibility rows are one fix, and the Hand Slap shieldstun appears twice.

What matches: all 13 aerial/ground attack timings (startup, active, FAF, landing lag, autocancel,
intangibility), every per-hitbox damage, angle, BKB, KBG and hitlag except Spinning Kong hit 1, all throws,
the grab boxes, pummel, dodge and air-dodge frame data, the ledge option frames, and all movement stats except
hard landing.

## MISMATCH list with proposed fixes

Severity tags: **[DK]** is a Donkey Kong data value. **[engine]** is a shared/universal mechanic that DK
inherits; fixing it touches every fighter.

### Movement
- **M1 [DK] Hard landing lag 4 → 5.**
  - Sources: UFD stats "Landing" table row "DK 5 2"; SmashWiki attribute `ellag = 5` ("Empty landing lag").
  - Fix: `donkeykongUfdStats.ts:46` `hardLandingFrames: 5`, and correct the comment, which misread the Mario row.
  - Effect: one more frame of lag on every hard landing.
  - Invalidates: locomotion qualification `donkeykong.hard-land` (asserts 4).
- **M2 [DK] Pivot dash frames 17 are stored but never used.**
  - Location: `donkeykongUfdStats.ts:22`. The dash turn is a native-timed 21-step turn (`donkeykongTurnBrake.ts:17`).
  - Fix: first confirm what UFD means by "Pivot Dash Frames". Then drive the post-turn dash length from 17.
  - Invalidates: locomotion `donkeykong.dash-turn` and `donkeykongTurnBrake.test.ts`.
- **M3 [DK] Carry walk ×1.1 is missing.**
  - Source: SmashWiki DK/Forward_throw: "walk speed and acceleration are increased by 1.1×" while carrying an opponent or heavy item.
  - Fix: scale walk max and acceleration by 1.1 in the cargo and heavy-item walk paths (`Character.ts:4116`, `donkeykongHeavyCarry.ts`).
  - Invalidates: `donkeykong.cargo-walk` (grabs-tails / grabs-throws-cargo) and the heavy-item walk rows in items-taunts.

### Ground attacks
- **M4 [DK] Angled forward tilt total 34 → 35.**
  - Source: SmashWiki: "due to an oversight it will also last 1 frame longer (FAF 35 → 36)". UFD lists one total, 34, for all three angles.
  - Native support: AttackS3Hi/Lw motion rate is 0.91, unangled is 0.9.
  - Fix: `DonkeyKong.ts:141` `recoveryFrames: 26` in `angledForwardTilt`.
  - Invalidates: ground-attacks `donkeykong.forward-tilt-up` and `-down` (duration), and any DK test asserting 34 for the angled variants.
- **M5–M7 [DK] Smash attacks auto-release at 60 frames.**
  - Source: SmashWiki Smash attack: in Ultimate a smash can be held a further 2 s after full charge (180 frames in total).
  - Fix: add `charge.maxHoldFrames: 180` to `DONKEYKONG_SMASH`, `_USMASH` and `_DSMASH` (`DonkeyKong.ts:272/306/342`), as `Pikachu.ts:53` does.
  - Invalidates: the three `*-charge` rows in ground-attacks, and `DonkeyKong.knockback.physics.test.ts` / `DonkeyKong.test.ts` if they assume a release at 60.

### Specials
- **M8 [DK] Giant Punch uncharged endlag: UFD and SmashWiki disagree.**
  - Engine = UFD: endlag 35, total 62 counted from the press.
  - SmashWiki: interruptible 70 from the press (63 from release), so endlag 42.
  - Native special_n cancel_frame 63 supports SmashWiki.
  - Proposal: adopt SmashWiki, `recoveryFrames: 42` at `DonkeyKong.ts:605` and `:577`. This needs the user's call because the two sources conflict.
  - Invalidates: specials `giant-punch-*-partial` and `donkeykongPunchControls.test.ts`.
- **M9 [DK] Spinning Kong grounded hit 1 KBG/FKB swapped.**
  - SmashWiki rows ids 0–5: `ks=30 fkv=90`.
  - Engine (from the native parse, `dk-scripts-digest.txt:224` "kbg=90 fkb=30"): KBG 90, FKB 30.
  - Under the rule SmashWiki wins: set growth 30, fixed 90 in `donkeykongAttackData.ts` (SpecialHi frame 19, ids 0–5), `DonkeyKong.ts:759` and `:768`.
  - Effect: the trap hit's launch becomes nearly fixed (90 FKB) instead of percent-scaled.
  - Recommend re-reading the SmashWiki page first, since the two numbers look transposed by one side.
  - Invalidates: specials `spinning-kong-ground-first` and `DonkeyKong.sourceMechanics.test.ts` / `DonkeyKong.test.ts` assertions on SpecialHi hit 1.
- **M10 [DK] Aerial Spinning Kong animation 63 → 70.**
  - Source: SmashWiki "Animation length 70" (Lag 27 after the final hit at 39–43).
  - Fix: `DonkeyKong.ts:710` `recoveryFrames: 27`.
  - Effect: 7 more frames before helpless fall.
  - Invalidates: specials `spinning-kong-air-final` / `-air-land`, and `DonkeyKong.recovery.physics.test.ts` timings around the helpless transition.
- **M11 [DK] Hand Slap mash window.**
  - Engine accepts presses only at elapsed 13–26 (`DonkeyKong.ts:837`).
  - SmashWiki: presses count "at any point during the startup or loop portions", and presses on loop frames 20–26 repeat twice.
  - Fix: `windowStart: 0`, `windowEnd: 33`, plus the double-repeat quirk for loop frames 20–26 (elapsed 26–32).
  - Invalidates: specials `hand-slap-ground-repeat`; `DonkeyKong.test.ts:281`.
- **M12 [DK] Hand Slap grounded hitbox placement.**
  - Engine: all four ids are one r 10.3 u sphere at the feet (`DonkeyKong.ts:830/833`). The script rows carry x=y=z=0 because the status code positions them.
  - SmashWiki: "Distance between grounded hitboxes 15u", "Grounded hitbox offsets [0, 5, 6.1]", and "DK's longest ranged attack ... hits a good deal behind him".
  - Fix: position ids 0–3 per those parameters, after deciding the exact layout (e.g. pairs at ±(6.1 + 15k)) and checking it against the UFD hitbox GIF.
  - Effect: much longer reach.
  - Invalidates: specials `hand-slap-ground-first/second`, and collision-geometry tests.
- **M13 [DK + engine] Hand Slap shieldstun ×0.58 is applied to pushback only.**
  - The engine gives shieldstun 13; UFD gives 8 and the SmashWiki Shieldstun table gives 0.58×.
  - Fix: pass the per-hitbox multiplier into `computeShieldstun` (`combat.ts:754`, `shieldState.ts:543`, parry path `Character.ts:10654`).
  - Effect: the slap is 5 frames less safe on shield.
  - Invalidates: the defense `shield-block` measurements if they used the slap; `shieldState.test.ts` / `combat` tests on shieldstun.

### Grabs, throws, cargo
- **M14 [DK] Normal throws have no throw invincibility.**
  - Source: SmashWiki "Invincibility": back 1–15, up 1–14, down 1–19.
  - Fix: `invincibilityFrames` 15/14/19 on `DONKEYKONG_GRAB.throws.back/up/down` (`DonkeyKong.ts:909–911`). Check the `throwSchema.ts:140` bound, which requires invincibilityFrames ≤ animationFrames + 1.
  - Invalidates: grabs `back-throw`, `up-throw`, `down-throw`; `Character.throwHits.physics.test.ts` if it hits the thrower.
- **M15 [DK] Cargo entry invincibility 16 → 15.**
  - Source: SmashWiki Carry "Invincibility 1-15, Animation length 15".
  - Fix: `DonkeyKong.ts:908` `invincibilityFrames: 15`, keeping cargo entry at frame 16.
  - Invalidates: `DonkeyKong.sourceMechanics.test.ts:114` and grabs `forward-throw-cargo-entry`.
- **M16 [DK] Cargo throws lack knockback armor.**
  - Source: SmashWiki DK: "gains Knockback-based Armor when he starts a throw ... resist up to 16 Units of Knockback".
  - Fix: during cargo throws (ground and air), apply a knockback-armor threshold of 16 KB using the existing heavy-armor consumer.
  - Invalidates: grabs `cargo-*-throw-*`; `donkeykongHeavyArmor*.test.ts`.
- **M17 [DK] Dash-attack shield damage.**
  - SmashWiki's dash-attack rows omit `sd`. The template omits it when 0, and the other DK rows list it when nonzero.
  - Engine and native use 1.
  - Fix: set `shield_damage` 0 for AttackDash frames 9 and 13 in `donkeykongAttackData.ts`.
  - Low impact (1 shield HP); low confidence because the source is silent by omission.
  - Invalidates: ground-attacks `dash-attack-*` only if shield HP was measured.

### Combat / defense (engine-wide; DK inherits)
- **M18 [engine] The 1v1 1.2× damage-taken multiplier is not modelled.**
  - Fix: in `MatchScene` hit resolution, multiply final percent damage by 1.2 when there are 2 players and items are off. Hitlag, hitstun, shieldstun, KO thresholds and knockback damage terms stay unchanged, per SmashWiki.
  - Invalidates: every qualification that asserts damage "×1.05 fresh" (aerials, ground attacks, specials, throws, pummel 1.6).
- **M19 [engine] Shield regeneration.** 0.25 → 0.08 HP/frame (`shieldState.ts:248`). Tests: `shieldState.test.ts`, `Character.test.ts`, UI shield bubble tests.
- **M20 [engine] Shield damage multiplier 1.19× is missing.** It applies to damage and to added shield damage (`shieldState.ts:524`). Tests: `shieldState.test.ts`, defense `shield-block` / `shield-break`.
- **M21 [engine] HP after shield break.** 10 → 37.5 (`shieldState.ts:251`).
- **M22 [engine] Shield-break stun.** Flat 180 → `400 − percent`, with mashing −3 per stick input (`shieldState.ts:250`). Invalidates: defense `shield-break`.
- **M23 [engine] Parry hitlag is 3 frames short.**
  - Engine: defender +8, attacker +11 over shield hitlag.
  - SmashWiki: +11 / +14 for direct hits; indirect is attacker +14, defender +2.
  - The relative advantage is already right; the absolute freezes are not.
  - Fix: `combat.ts:776–777`.
  - Invalidates: defense/ledge `parry` rows; `combat.electric.test.ts`, `referenceCombatModifiers.test.ts`.
- **M24 [engine] Shield grab after shieldstun lacks the +4 startup.**
  - Sources: UFD "Shield Grab (Grab, post-Shieldstun) — 12 frames" against grab 8; SmashWiki Shieldstun "+4 frames".
  - Not found in the out-of-shield grab path (`Character.ts:3590`); verify, then add +4 when the grab follows shieldstun.
- **M25 [engine] Spot-dodge attack cancel at 21 is missing.**
  - Sources: UFD "21/26"; SmashWiki "can now be canceled 5 frames earlier ... into any ground attack".
  - Fix: allow ground attacks and specials (not grab or dash attack) from frame 22 of a spot dodge.
  - Invalidates: defense `spot-dodge`.
- **M26 [engine] Dodge staleness is missing.**
  - SmashWiki: duration D·(1+P), with P += 0.06 per dodge up to 0.3; intangibility starts 3 frames later when fully stale. DK's fully-stale values are listed on the Spot dodge, Roll and Air dodge pages.
  - Invalidates: none of the current qualifications, which use fresh dodges.

### Ledge (engine defaults; DK lacks Pikachu's overrides)
- **M27 [engine] Hang intangibility.**
  - Engine: fixed 24 (`ledgeHangState.ts:411`).
  - SmashWiki: `60·(airtime/300) + 44 − (percent/120·44)` frames after the 19-frame grab, 23–123 in total.
  - Invalidates: ledge `ledge-hang`.
- **M28 [DK] Maximum 6 ledge grabs without landing.** Set `maxGrabsWithoutGround: 6` in DK `ledge` (`fighterMovementProfiles.ts:376`), copying `pikachuMovement.ts:32`.
- **M29 [DK] Regrab catch slowdown.** Set `catchMotionRatesByGrab: [1, 1, 0.9375, 0.875, 0.8125, 0.75]` (`pikachuMovement.ts:31`). Invalidates: ledge `ledge-catch` on regrabs.
- **M30 [DK/engine] Getup-option intangibility on regrab.**
  - SmashWiki: 0.8× after the 1st regrab, 0.5× after the 2nd, none from the 3rd, for getup, jump, attack and roll alike.
  - DK has none of this. Pikachu's `attackProtectionFramesByGrab: [25, 20, 12, 0]` covers ledge attack only; the other options need engine support.
  - Invalidates: ledge `ledge-getup/-jump/-roll/-attack` on regrabs.
- **M31 [engine] Maximum hang time.** 360 → 390 frames (6.5 s) (`ledgeHangState.ts:410`).

### Ground attacks / getup
- **M32 [DK] Ledge-attack intangibility on regrabs.**
  - SmashWiki DK/Edge_attack: 1–25, then 1–20 on the 2nd grab, 1–12 on the 3rd, none from the 4th.
  - Fix: `attackProtectionFramesByGrab: [25, 20, 12, 0]` (same change as M30).

### Shield lag/stun per move
- **M33 = M13.** The Hand Slap grounded shieldstun row (engine 13 vs UFD 8). The other 69 per-move shield lag/stun rows match.

## SOURCE_SILENT (still native-only or authored; flag for the user)

**Movement**
- Full-hop opening per-step split `[-38.47, -28.41, -18.34, -8.28]` px. The 93.5 px total (initial height 18.7) is now SmashWiki-sourced; only the split is authored.
- Hard-landing trigger: 4 steps at terminal speed. SmashWiki says the timer is character-dependent but gives no value.
- Jump takeoff horizontal: `jump_speed_x 0.95 / _mul 0.8 / _max 1.6` and the clamp formula (authored reading).
- Air-jump horizontal (`jump_aerial_speed_x_mul`): not modelled.
- Dash-turn 21 / run-turn 33 / run-brake 19 durations, and dash→run at native frame 18. UFD's "Fast 1-5 / Normal 6-15 / Slow 16" turnaround split is not modelled; only the 15 window end is used.
- Analog walk curve `(stick − 0.3)/0.45`.
- Vertical-launch gravity 0.084672 (the 1.8 fall speed is sourced).
- Movement body 60×84 px.

**Specials and grabs**
- Spinning Kong air reduced-gravity duration (43 frames).
- Dash-grab momentum retain 0.5 and +5.5 px range bonus; pivot-grab momentum 0.
- Heavy-item / carry armor threshold (32 reaction frames, KB×0.4 proxy).
- Cargo action restrictions (air-jump ban, etc.).

**Defense**
- Roll slide speed 10 px/step and facing reversal at frame 19.
- Directional air-dodge landing-lag curve (linear interpolation 19→11). The endpoints are sourced.
- Shield regeneration delay of 30 frames.

**Tech and footstool**
- Tech lockout of 40. SmashWiki gives 40 for Melee and 30 for Smash 4, and nothing for Ultimate.
- Surface-tech durations: ceiling 26, wall-jump 40; passive wall speeds 0.5 / 1.3 / 2.7 / 1.
- Footstool performer 9 steps; recipient lock 9 (ground) / 36 (air); jump ×1.3 / ×0.7; contact range 8×6 u.
- Footstool repeat velocity ×0.75. SmashWiki says only "approximately half the rebound"; 0.75² ≈ 0.56 is consistent.

**Not applicable**
- Short-hop aerial ×0.85. It applies only to the jump+attack macro, which the engine does not have.

**Not audited (engine path not located; listed as SOURCE_SILENT placeholders, not cleared)**
- Spinning Kong air "enables ledge grabs from both sides starting on frame 14".
- Directional air dodge "can grab edges after the first 24 frames".
- Ledge-jump total of 14 frames (UFD) has no DK engine field.

Presentation-only timing (`frames.json` `actionFrameStarts`, attack/body tails, clip loops) was skipped per the brief.

## UFD vs SmashWiki disagreements

1. **Giant Punch uncharged endlag.**
   - UFD: endlag 35, total 62 from the press.
   - SmashWiki: interruptible 70 from the press (63 from release), endlag 42.
   - Native special_n cancel_frame 63 supports SmashWiki.
   - Engine follows UFD (M8). Needs a decision.
2. **Spinning Kong grounded rung damage.**
   - UFD: 1.3. SmashWiki: 1.4 (hitbox rows and moveset).
   - Engine uses 1.4, as the rework already chose, with native SpecialHi agreeing. Marked MATCH against SmashWiki.
3. **Giant Punch full-charge time.**
   - UFD: 111 frames. SmashWiki: 110 frames, with partial damage `base + 18·(charge/110)` rounded down.
   - Engine uses 111, so the partial-damage steps land one frame later than SmashWiki's formula. Likely a counting-convention difference.
4. **Forward tilt angled total.**
   - UFD lists 34 for all angles. SmashWiki says angled moves last 1 frame longer (FAF 36).
   - Not a direct contradiction, since UFD does not separate the angles; SmashWiki is more specific (M4).
5. **Shield lag for dash attack (late) and dair (foot), and shieldstun for aerial Hand Slap hit 2.**
   - UFD's values equal the formula without the 1.05 freshness bonus, while its other rows (e.g. dash attack early shieldstun 12) need it.
   - SmashWiki Hitlag says fresh damage is factored.
   - Engine follows SmashWiki; recorded as MATCH with a note. UFD up-tilt shieldstun 9 corresponds to the 9% arm hitbox, not the listed 10%.
6. **Spinning Kong hit 1.** SmashWiki `ks=30 fkv=90` vs native `kbg=90 fkb=30`. This is SmashWiki against supporting evidence, not against UFD (UFD gives no knockback values); SmashWiki wins under the rule (M9).
7. **Dash attack shield damage.** SmashWiki omits it (0) vs native 1 (M17).

## Values the rework recorded as "authored", now settled by the sources

- **Full-hop initial height 18.7:** SmashWiki Jump table. The per-step split is still authored.
- **Run acceleration 0.044 + 0.07337·stick:** SmashWiki Dash table.
- **Ledge catch 19:** SmashWiki Edge (already confirmed).
- **Spinning Kong rungs 1.4:** SmashWiki (UFD disagrees).
- **Air-dodge landing-lag endpoints 19/11 and neutral 10:** UFD and SmashWiki. The curve shape is still authored.
- **Footstool 9 steps:** still native-only.
- **Jump horizontal formula (0.95 / 0.8 / 1.6):** still native-only.
- **Spinning Kong ground and air motion parameters** (0.034 / 0.015 / 1.1 / 0.04, initial vertical speed 0.9, air acceleration 0.05, max air speed 1.7, gravity ×0.07): SmashWiki Up special Parameters. All match at ×5.
- **Headbutt startup speed and gravity multipliers** (0.5 / 0.67 horizontal, 0 / 0.5 vertical, gravity 0.5): SmashWiki Side special Parameters, all matching.

## Qualifications that the fixes would demote

| fix | qualification rows |
|---|---|
| M1 | locomotion `hard-land` |
| M2 | locomotion `dash-turn` |
| M3 | grabs `cargo-walk`; items-taunts heavy-walk rows |
| M4 | ground-attacks `forward-tilt-up`, `forward-tilt-down` |
| M5–M7 | ground-attacks `forward-smash-charge`, `up-smash-charge`, `down-smash-charge` |
| M8 | specials `giant-punch-ground-partial`, `giant-punch-air-partial` |
| M9 | specials `spinning-kong-ground-first` |
| M10 | specials `spinning-kong-air-final`, `spinning-kong-air-land` |
| M11 | specials `hand-slap-ground-repeat` |
| M12 | specials `hand-slap-ground-first`, `hand-slap-ground-second` |
| M14 | grabs `back-throw`, `up-throw`, `down-throw` |
| M15 | grabs `forward-throw-cargo-entry` |
| M16 | the eight `cargo-*-throw-*` rows |
| M18 | every damage assertion |
| M19–M25 | defense `shield`, `shield-block`, `shield-break`, `parry`, `spot-dodge`; ledge-recovery `parry` |
| M27–M32 | ledge-recovery `ledge-catch`, `ledge-hang`, `ledge-getup`, `ledge-jump`, `ledge-roll`, `ledge-attack` |

M13 has no separate qualification row beyond `shield-block`.
