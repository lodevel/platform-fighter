# Ultimate items: art needs (DK, Pikachu, generic fallback, item sprites)

Sources:
- Native motion lists, pinned at WuBoytH/SSBU-Dumped-Motion-Lists `3f14a9d4…`:
  - DK: `docs/review/2026-09-25/donkeykong-character/sources/motion-list.yml` (191 item-related motions)
  - Pikachu: `docs/review/2026-10-06/pikachu-character/sources/motion-list.yml` (183 item-related motions)
- Installed clips: `assets/characters/{donkeykong,pikachu}/frames.json`.
- DK plan: `docs/review/2026-09-25/donkeykong-character/rework-2026-10-10/clip-plan.json`. Every item clip in that plan is installed.

Native motion names are the art contract. Body strips use the engine's existing key names (e.g. DK `item_pickup_stand` = native `item_light_get`).

User decision: only DK and Pikachu get item body art. Every other fighter uses the generic fallback (section 4).

## 1. Native motions per first-pass item

There is no `item_harisen_*` motion in either list, which confirms the Fan is not in Ultimate.

Empty-ammo motions (`*_empty`) are excluded. In Ultimate an empty shooter is thrown, not fired (`universal-rules.json` `attackInput.emptyShootingItem`). They stay out unless a source shows they play.

| Item / family | Native motions needed | DK installed | DK missing | Pikachu installed | Pikachu missing |
|---|---|---|---|---|---|
| Home-Run Bat | `item_bat_swing_1` (jab), `_3` (ftilt), `_4` (fsmash), `_dash`. No `_4_hold` exists natively, which matches the bat fsmash being uncharged. | 4 | 0 | 0 | 4 |
| Beam Sword | `item_sword_swing_1`, `_3`, `_4`, `_4_hold` (charge), `_dash` | 2 (`_4`, `_4_hold`). `_1`, `_3` and `_dash` are aliases to the bat drawings, with no own strip. | 3 own strips (to replace the aliases) | 0 | 5 |
| Star Rod | `item_starrod_swing_1`, `_3`, `_4`, `_4_hold`, `_dash` | 0 | 5 | 0 | 5 |
| Hammer | `item_hammer_wait`, `_move`, `_jump` (the swing loop is the body motion) | 0 | 3 | 0 | 3 |
| Golden Hammer | `item_golden_hammer_wait`, `_move`, `_jump` | 0 | 3 | 0 | 3 |
| Ray Gun | `item_lgun_shoot`, `_air`, `_upper` (upper body while walking) | 2 | 1 (`_upper`) | 0 | 3 |
| Super Scope | 19 non-empty: `item_scope_{start,wait,fire,rapid,end}` + `_upper` variants of start, wait, fire, rapid and end, `item_scope_fall`, `item_scope_air_{start,fire,rapid,end}` + their `_aerial` variants | 0 | 19 | 0 | 19 |
| Fire Flower | `item_fflower_shoot`, `_loop`, `_upper`, `_loop_upper`, `_air`, `_air_loop`, `_aerial` | 0 | 7 | 0 | 7 |
| Shooting legs (Ray Gun, Scope, Flower) | `item_shoot_legs_walk_f`, `_walk_b`, `_jump_squat`, `_landing` | 4 | 0 | 0 | 4 |
| Light pickup and carry (all light items) | `item_light_get`, `item_light_walk_get`, `wait_item` (engine `item_carry`), `squat_wait_item` | 3 | 1 (`squat_wait_item`) | 3 | 1 (`squat_wait_item`) |
| Light throws (Bob-omb, Banana Peel, Capsule, empty shooters, any thrown light item) | `item_light_throw_{f,b,hi,lw}`, `_air_{f,b,hi,lw}`, `_dash`, `_drop` | 10 | 0 | 9 (1 sparse frame each) | 1 (`_dash`) |
| Smash-throw variants | `item_light_throw_{f4,b4,hi4,lw4}` + `_air_*4` | 0 own (8 aliases to the weak throws) | 0 required (own strips optional) | 0 | 8 (or aliases, like DK) |
| Food (eat) | `item_light_eat`, `item_light_walk_eat`. Whether Heart Container and Maxim Tomato also play an eat motion is SOURCE_SILENT. | 0 | 2 | 0 | 2 |
| Heavy (Crate, Barrel) | `item_heavy_get`, `item_heavy_throw_{f,b,hi,lw}` (+ `*4`), `landing_heavy`. DK carry is `super_lift_*` (9). Non-DK carry is `item_heavy_walk` (absent from DK's list). | 14 (5 heavy + 9 super_lift); 4 `*4` aliases | 1 (`landing_heavy`) | 0 | 11 (`item_heavy_get`, 4 throws, 4 `*4`, `item_heavy_walk`, `landing_heavy`) |
| Hand poses (optional, grip composition) | `item_hand_grip`, `_have`, `_pickup`, `_smash` | 0 | 4 (optional) | 0 | 4 (optional) |

### Totals (first-pass scope)

| | Native motions in scope | Installed own strips | Missing (required) | Missing (optional) |
|---|---|---|---|---|
| DK | 100 | 39 (+15 alias keys) | **45**: 3 sword, 5 star rod, 6 hammer/golden hammer, 1 ray gun upper, 19 scope, 7 flower, 2 eat, 1 squat_wait_item, 1 landing_heavy. That is 42 new families plus 3 sword strips to retire the bat alias. | 4 hand poses; 12 `*4` strong-throw strips (aliases are acceptable) |
| Pikachu | 92 | 12 (all sparse, 1-5 drawings) | **68**: 4 bat, 5 sword, 5 star rod, 6 hammer/golden hammer, 3 ray gun, 19 scope, 7 flower, 4 shoot legs, 1 squat_wait_item, 1 throw dash, 2 eat, 11 heavy (its 4 `*4` may be aliases, leaving 7) | 4 hand poses; 8 light `*4` strips |

Rough frame budget: DK strips run 2-12 drawings each, and the existing Pikachu strips have 1-5. Scope and flower motions are mostly short loops.

### Where art is not the blocker

Clips that are already installed but never selected (DK items-taunts qualification, PARTIAL rows) are **engine** gaps, not art gaps:
- `item_bat_swing_3`, `_4`, `_dash`
- `item_sword_swing_4`, `_4_hold`
- `item_shoot_legs_*`
- `super_lift_walk_slow`, `super_lift_walk_fast`

They become reachable with the per-input dispatch, the shooting-move state and a heavy gait selector (`phases.md`).

## 2. DK specifics

- Routing today: `src/characters/donkeykongBodyPresentation.ts`.
  - `DONKEYKONG_ITEM_ATTACK_SHEETS` maps 3 test move ids to clips.
  - `DONKEYKONG_PENDING_SHEET_FALLBACK` holds the aliases, including sword to bat.
  - Replace both with `ItemUse.clip` lookup (`engine-gap.md` section 5.8).
- Weapon art is drawn separately from the body. The DK qualification notes "Hands draw no grip". The held item is placed at DK's per-frame source socket. Grip alignment per new clip has to be checked against that socket, with no new hand art unless the optional hand poses are drawn.
- `super_lift_walk_slow` / `_middle` / `_fast` need a speed-linked gait selector. The DK walk speed (1.365, UFD) is sourced. The gait thresholds are native-derived, because SmashWiki is silent on them.
- DK clips for Hammer and Golden Hammer are new families. Their swing hitbox comes from the item, and the body clip only loops while the hammer timer runs.

## 3. Pikachu specifics

- Routing:
  - `Character.getPikachuItemPresentationState`
  - `selectPikachuAuxiliaryBody` (`pikachuAuxiliaryBody.ts`)
  - Socket: `pikachuItemAttachment.ts` (`sourceHave`, only for carry, pickup, throw and locomotion sheets)
- Every new Pikachu item strip needs `Have` socket samples added beside its drawings, the same way the existing `sourceHave` table is built. Otherwise the held item has no anchor in that clip.
- Pikachu has no item clip plan yet. Produce one in the same format as DK's `clip-plan.json` before generating art (the add-character workflow, art pipeline runbook section 2b, UFD/native pose guides).

## 4. Generic fallback for other fighters (11 fighters with no item art)

Keep one table in one module (e.g. `src/items/itemFallbackPose.ts`), used whenever a fighter has no clip for `ItemUse.clip`.

| Item use | Fallback body clip (fighter's own) | Item visual |
|---|---|---|
| jab / ftilt / dashAttack / fsmash swing | the fighter's own `jab` / `tilt` / `dashAttack` / `smash` sheet (current `attackMoveToSheets` path) | weapon sprite at the hand anchor, rotated by the item's per-use arc (`ItemVisual.arcs[use]`, replacing `computeWeaponAngle`), plus the existing `SwingTrail` along the real hitbox sweep |
| fsmash charge | the fighter's own smash charge hold (existing charge presentation) | weapon held at the arc start angle |
| fire (shooter) on ground / in air / walking | idle, walk or air sheet (locomotion continues). Keep `suppressFighterPose` semantics, but do not freeze the body. | gun sprite at the hand anchor pointing forward, plus a muzzle flash |
| Hammer lock | ordinary idle / walk / jump sheets | hammer sprite looping its overhead arc (`ItemVisual.lockArc`) |
| pickup / carry | ordinary locomotion | item at the hand anchor (`FIGHTER_HAND_ANCHORS`) |
| light throw / drop | the fighter's own grab-throw sheet if present, otherwise `attack`, otherwise `idle` | item released at the hand anchor |
| heavy carry / throw | ordinary walk (slowed) / `attack` | crate or barrel drawn above the head anchor |
| eat | `idle` with a short scale pulse | food sprite at the hand anchor, then a heal effect |

Damage areas stay visible through the existing hitbox and trap debug drawing, following `add-spawned-object`.

## 5. Item art (sprites and effects)

Existing reusable assets are in `assets/sprites/items/`: `bat.png`, `sword.png`, `hammer.png`, `raygun.png`, `bomb.png`, `explosion.png` (strip). Concept art for the same six is in `assets/concept-art/items/` (not preloaded). `spear.png` is retired. The art style must be Brawlhalla-style clean 2D cartoon (`docs/ART-STYLE.md`).

| Item | Sprites needed | Notes |
|---|---|---|
| Home-Run Bat | held/ground | `bat.png` can stay if it reads as the Ultimate bat |
| Beam Sword | handle plus glowing beam (2 layers) | new; the current `sword.png` is a metal blade |
| Star Rod | rod; star projectile; spent-star fade | new |
| Hammer | hammer; headless handle; flying head | `hammer.png` may serve as the base. Head and handle must separate. |
| Golden Hammer | golden hammer; podium growth frames; squeaky variant (same art) | new |
| Ray Gun | gun; beam projectile; muzzle flash | `raygun.png` reusable |
| Super Scope | scope; small shot; charged shot (grows by stage); muzzle | new |
| Fire Flower | flower; flame particle strip; burning thrown flower | new |
| Bob-omb | idle; walk cycle (2-4 frames); red flash state | new (`bomb.png` is a generic bomb); `explosion.png` reusable |
| Banana Peel | peel | new |
| Food | first pass: one sprite per food type in use. 36 regular types exist; recommend a subset with heal values from the table, plus a heal effect. | new; a heal-number popup is optional |
| Heart Container | heart | new |
| Maxim Tomato | tomato | new |
| Crate | normal skin (Futuristic and Presents skins are later); break debris | today drawn from rectangles; needs a sprite |
| Barrel | barrel; rolling rotation; break debris | new |
| Capsule | capsule; open/break burst | new |
| Containers (shared) | explosion (reuse `explosion.png`); spawn flash; despawn blink | reuse |

Count: 15 item sprites (16 items without the Fan, with Golden Hammer sharing hammer-style art), about 8 projectile or effect strips, and 3 container break effects.
