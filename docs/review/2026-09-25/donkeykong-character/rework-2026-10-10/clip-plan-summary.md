# DK clip plan summary (2026-10-10, CPU-only)

Source of truth: `clip-plan.json` (per-clip actions, native file, total frames, windows, contacts, `nativeSamples`, roles, route status). Samples are 1-based; sample N = last native frame. Rule: first; first/last of each active window; each strike/contact; end/actionable (cancel_frame, else last; loops N-1); fill to gap <= 6 (attacks/specials/throws/swings) or 8 (loops/locomotion/defense/other); cap 12, contacts kept first.

## Totals

- Actions: 226 = 204 with native motion + 22 without.
- Clips to generate: **150** (33 reuse a key of today's 42-clip DK frames.json; the rest are new keys). Aliased keys (same native file) ride on a clip: pack one PNG per alias.
- Cells (poses): **1103**. GPU jobs at 4 poses/job: **276** if cells are pooled across clips of a family, 327 if every clip is its own job set (upper bound).
- 23 clips hit the 12-cell cap.

| family | clips | cells | jobs (pooled) | jobs (per clip) |
|---|---|---|---|---|
| locomotion | 18 | 94 | 24 | 28 |
| defense | 8 | 60 | 15 | 17 |
| ground-attacks | 14 | 142 | 36 | 40 |
| aerials | 5 | 55 | 14 | 15 |
| specials | 14 | 122 | 31 | 32 |
| grabs-throws-cargo | 19 | 172 | 43 | 49 |
| ledge-recovery | 30 | 199 | 50 | 62 |
| items-taunts | 42 | 259 | 65 | 84 |
| **total** | 150 | 1103 | 276 | 327 |

Family "recipient" has no clips: all 5 cargo-recipient rows have no DK motion (see below). Pikachu comparison: 140 clips / 825 cells.

## Cap bit (gap limit not met)

- `idle` N=141: max gap 17 vs limit 8 (locomotion)
- `crouch` N=161: max gap 20 vs limit 8 (locomotion)
- `shield` N=361: max gap 45 vs limit 8 (defense)
- `shield_break` N=161: max gap 20 vs limit 8 (defense)
- `smash` N=60: max gap 9 vs limit 6 (ground-attacks)
- `usmash` N=60: max gap 6 vs limit 6 (ground-attacks)
- `dsmash` N=64: max gap 7 vs limit 6 (ground-attacks)
- `fair` N=62: max gap 9 vs limit 6 (aerials)
- `neutral_special` N=76: max gap 9 vs limit 6 (specials)
- `neutral_special_air` N=76: max gap 9 vs limit 6 (specials)
- `side_special` N=70: max gap 9 vs limit 6 (specials)
- `side_special_air` N=70: max gap 9 vs limit 6 (specials)
- `up_special_ground` N=115: max gap 18 vs limit 6 (specials)
- `up_special_air` N=95: max gap 12 vs limit 6 (specials)
- `down_special_air` N=70: max gap 9 vs limit 6 (specials)
- `bthrow` N=66: max gap 7 vs limit 6 (grabs-throws-cargo)
- `cargo_fthrow` N=65: max gap 7 vs limit 6 (grabs-throws-cargo)
- `ledge` N=101: max gap 12 vs limit 8 (ledge-recovery)
- `getup_attack` N=58: max gap 8 vs limit 6 (ledge-recovery)
- `getup_attack_face_down` N=56: max gap 8 vs limit 6 (ledge-recovery)
- `entry` N=121: max gap 15 vs limit 8 (ledge-recovery)
- `item_carry` N=141: max gap 17 vs limit 8 (items-taunts)
- `item_bat_swing_4` N=81: max gap 10 vs limit 6 (items-taunts)

## Needs route (runtime does not produce the key today)

Judged from `donkeyKongBodyCandidate`, Character.ts committed/item/heavy sheets and `attackMoveToSheets`. `needs route` = no producer found; `routed-per-inventory-only` = inventory says present but presentation code shows no such key.

- `up_special_air_land` - routed-per-inventory-only
- `down_special_air_land` - routed-per-inventory-only
- `entry` - needs route
- `item_bat_swing_1` - needs route
- `item_bat_swing_3` - needs route
- `item_bat_swing_4` - needs route
- `item_sword_swing_4` - needs route
- `item_lgun_shoot` - needs route
- `item_lgun_shoot_air` - needs route
- `item_bat_swing_dash` - needs route
- `item_sword_swing_4_hold` - needs route
- `item_shoot_legs_walk_f` - needs route
- `item_shoot_legs_walk_b` - needs route
- `item_shoot_legs_jump_squat` - needs route
- `item_shoot_legs_landing` - needs route
- `up_special_ground_land` (alias of `up_special_ground`) - needs route
- `item_sword_swing_1` (alias of `item_bat_swing_1`) - needs route
- `item_sword_swing_3` (alias of `item_bat_swing_3`) - needs route
- `item_sword_swing_dash` (alias of `item_bat_swing_dash`) - needs route

Also route-relevant: inventory animation keys `ftilt/ftilt_up/ftilt_down/fsmash/fsmash_charge/item_pickup` are NOT what the runtime routes; plan uses `tilt/tilt_up/tilt_down/smash/smash_charge/item_pickup_stand`. `walk`, `dash`, `jab`-family etc. are routed but have no clip yet in frames.json (new asset, data-only).

## Actions with no native motion (22)

| action | reason (inventory) | proposed source |
|---|---|---|
| buried-recipient | Required visible Headbutt burial and mash/escape state; consumed source mechanics and dedi | reuse: hurt (damage_n_2 sample) lowered/clipped into ground by renderer, or authored half-buried pose |
| buried-escape | Required visible Headbutt burial and mash/escape state; consumed source mechanics and dedi | reuse: jump (a03jumpf early samples) rising out of burial; authored dirt FX |
| item-drop-air | Pure source selector/timeline authored; Character+Scene consumers pending | reuse: air_drift (a04fallf) clip - key already air_drift; no new art |
| item-catch-air | Pending accepted body motion, equipment/grip, root registration and paired collision. | reuse: air_drift/airjump body with item_pickup_stand reach arm; or authored |
| item-catch-aerial | Pending accepted body motion, equipment/grip, root registration and paired collision. | reuse: nair/fair body pose with item grip; or authored |
| item-catch-air-dodge | Pending accepted body motion, equipment/grip, root registration and paired collision. | reuse: air_dodge (b02escapeair) body with item grip; or authored |
| item-pickup-dash-attack | Pending accepted body motion, equipment/grip, root registration and paired collision. | reuse: item_pickup_stand (h00lightget) after dash_attack; ground reach |
| item-pickup-tilt | Pending accepted body motion, equipment/grip, root registration and paired collision. | reuse: item_pickup_stand (h00lightget) after tilt; ground reach |
| item-hammer-ground-jab | Existing authored attack executes; distinct declared ground slot input/body/equipment acce | reuse: item_sword_swing_1 / item_bat_swing_1 clip (h04swing1); native hammer motions only wait/move/air (h05itemhammer*) |
| item-hammer-ground-tilt | Existing authored attack executes; distinct declared ground slot input/body/equipment acce | reuse: item_sword_swing_3 clip (h04swing3) |
| item-hammer-ground-smash | Existing authored attack executes; distinct declared ground slot input/body/equipment acce | reuse: item_bat_swing_4 clip (h06swing4bat) or item_sword_swing_4 (h04swing4) |
| item-hammer-air-use | Existing authored attack executes; distinct declared ground slot input/body/equipment acce | reuse: item_sword_swing_1 clip (h04swing1) in air |
| item-spear-ground-jab | Existing authored attack executes; distinct declared ground slot input/body/equipment acce | reuse: item_sword_swing_1 clip (h04swing1) |
| item-spear-ground-tilt | Existing authored attack executes; distinct declared ground slot input/body/equipment acce | reuse: item_sword_swing_3 clip (h04swing3) |
| item-spear-air-use | Existing authored attack executes; distinct declared ground slot input/body/equipment acce | reuse: item_sword_swing_1 clip (h04swing1) in air |
| item-bomb-ground-jab | Existing authored attack executes; distinct declared ground slot input/body/equipment acce | reuse: item_throw_f clip (h01lightthrowf) - bomb is thrown/placed |
| item-bomb-air-use | Existing authored attack executes; distinct declared ground slot input/body/equipment acce | reuse: item_throw_air_f clip (h02lightthrowairf) |
| cargo-recipient-carried | missing | reuse: captured clip (capture_wait_hi) - DK as victim of another DK; native shoulder-recipient motion not in DK set |
| cargo-recipient-forward-throw | missing | reuse: tumble clip (damage_fly_n) |
| cargo-recipient-back-throw | missing | reuse: tumble clip (damage_fly_n) |
| cargo-recipient-up-throw | missing | reuse: tumble clip (damage_fly_n) |
| cargo-recipient-down-throw | missing | reuse: tumble clip (damage_fly_n) |

## Ambiguities

- Sample convention: 1-based, sample = script frame number for hits (jab ATTACK f5 -> sample 5) and sample N = last native frame (final_frame_index+1). If the lab treats hit frames as 0-based indices, shift every contact by +1/-1 consistently; the reviewed pilots (jab1 native5 at action age 4, standing grab native8 at age 7) support the 1-based reading used here.
- Scripts with MOTION_RATE != 1.0 (AttackS3, AttackS3Hi, AttackS3Lw, SpecialAirHi, SpecialLwLoop) advance the motion slower/faster than script frames; hit script frames are used as samples directly, so the true motion sample can differ by up to ~1 frame.
- Throw release frames are not in dk-scripts-digest (ATTACK_ABS at f0 only); they come from DonkeyKong.ts GrabSpec animationFrames (native-sample-one clock).
- No ATTACK window data exists for catch_attack beyond f2-f2, item swings (h04swing*), item shoots (h11/h10) or heavy-item throws; those clips use only first/end/fill samples (item_light_throw_*: cancel_frame as actionable).
- Long hold loops (idle 141, crouch ~160, shield 361, item_carry 141, shield_break 160, ledge 100, entry 121) cannot meet the 8-frame gap within the 12-cell cap; cap bites, gaps up to 45. Consider 4-6 key poses for these (breathing idle) instead.
- Clips sharing one native file are merged with aliases even when the runtime routes them as distinct keys (air dodge x6, taunt r/l, item_throw weak/strong, bat/sword swings, neutral_special/full, up_special_ground and up_special_ground_land). Packing must emit one PNG per alias key (or the runtime must alias). Directional air dodges and l/r taunts likely need mirror/rotate at render time rather than new art.
- up_special_ground_land has the same native file as the spin (special_hi); inventory gives it no distinct motion. Treated as an alias; confirm it is meant to show the spin end rather than a landing.
- Inventory animation_key differs from the key the runtime actually routes for: ftilt->tilt, ftilt_up->tilt_up, ftilt_down->tilt_down, fsmash->smash, fsmash_charge->smash_charge, item_pickup->item_pickup_stand. Plan uses the routed key (see inventory_keys_differing).
- Taunt clips use all native frames (presentation 80/70/60) not cancel_frame 50.
- Routing was judged from donkeykongBodyPresentation.ts / Character.ts / spriteAnimationDriver.ts reading; inventory entry_route_present disagrees for several (labelled routed-per-inventory-only).
