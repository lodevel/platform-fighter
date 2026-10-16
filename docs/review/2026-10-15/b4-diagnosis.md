# B4 phase A — Link held items: diagnosis

Date 2026-10-15. Scope: package B4 of `docs/review/2026-10-14/link-takeover/PLAN.md` (held items through the shared
socket and shot path; why the Home-Run Bat misses; Link item code paths). Phase A only adds tests and this record. No
edits to `Character.ts`, `FreshLink.ts`, `src/characters/link*.ts` or `MatchScene.ts` (B3 owns them right now).

## What was run

| Evidence | Where |
|---|---|
| Real-Matter tests: Link and Donkey Kong under identical input, a real DK as the target through the real `HitboxDamageHandler` (collision events + live-hurtbox sampler, as MatchScene wires it) | `src/items/linkHeldItems.physics.test.ts` (81 tests) |
| Shared fixture extended: Link allowed; optional `victimAt` places a DK target and records `contacts` | `src/items/itemPhysicsFixture.ts` |
| Game build (`node --max-old-space-size=8192 node_modules/vite/bin/vite.js build`, exit 0) and a Playwright probe on the preview (`http://127.0.0.1:4173/platform-fighter/`); **all input simulated** at the DeviceInputDispatcher, as `tools/link-playable-probe.mjs` | screenshots and `probe.json` in `docs/review/2026-10-15/b4/` |

Command: `npx vitest run src/items/linkHeldItems.physics.test.ts --poolOptions.threads.maxThreads=4 --poolOptions.threads.minThreads=1`
→ **72 pass, 9 fail** (the 9 are listed under "Expected red" below). The other suites that use the fixture
(`homeRunBat`, `shootingItems`, `throwingItems`, `hammerLock`, `healingItems`, `containerRuntime`, `shootingTurn`,
`DonkeyKong.knockdown-support`) stay green. `src/characters/heavyCarry.physics.test.ts` has 2 red tests
(`TypeError … reading 'filter'` in `recordStockLossWithStats`). That suite transpiles `MatchScene.ts` from source, so
the failure comes from the in-progress B3 edits there, not from the fixture.

## Results: where Link matches DK

All of these pass for both fighters, with identical numbers:

- **Pickup** (`pickup-standing`, `pickup-walking`): the callback fires on the planner frame from each fighter's profile, and the item is drawn at a hand socket on every step.
- **Battering swings**: Beam Sword at 110 px and Home-Run Bat at 80 px, for jab, forward tilt, dash attack and forward smash. Each gives exactly one contact on the use's first active frame, with the cited damage and angle (sword 4/9/8/13 at angles 361/361/45/361; bat 7/13/16/30 at angles 361/361/45/40; values from the definition files).
- **Socket rows**: every carry and swing step has one, within 110 px of the body centre. The Beam Sword forward smash points the blade forward on its first live frame, for both facings.
- **Hammer**: the damage areas come from the socket, and within one 16-frame swing the head passes in front of the body at hurtbox height.
- **Shooting cadence**: Ray Gun with a press every 25 frames, Super Scope tap and 110-frame hold, and the Fire Flower stream while walking all fire on the same steps with the same ammo as DK.
- **Bob-omb throws**: 4 directions × ordinary/strong, ground drop and dash throw. Each releases on the profile frame from a drawn-hand socket, and the release velocity follows the throw profile (sign per direction; a strong throw is faster than an ordinary one). The air Z-drop releases on entry.
- **Crate** (heavy): pickup and 4 throws each fire one callback on the plan frame.
- **Catch**: the dash attack, tilt, aerial, air-dodge and air-stationary catch contexts, from age 0. Holding an item gives no catch context.

## Divergences and causes

### 1. Home-Run Bat "0 contacts at 110 px": a reach problem for every fighter, not a Link bug
- The bat's swing box is authored as `BAT_HITBOX = { offsetX: 36, width: 56 }` (`src/items/HomeRunBat.ts:30`). Its front edge sits **64 px** in front of the body centre.
- A DK target at 110 px between centres exposes its hurtbox from about 80 px. DK holding the same bat also gets 0 contacts at 100, 110 and 130 px, and hits at 60 and 80 px. Link does exactly the same.
- The probe placed the target at 110 px: `tools/link-playable-probe.mjs:333` (`reset({ dist: 110 })`). The Beam Sword (front edge 80, fsmash 96) reaches 110 px, which is why it "worked" in the triage.
- In-game evidence agrees: `b4/probe.json` shows the bat's jab active on frame 3 and the forward smash on frame 50, with Link drawn and holding the bat.
- The bat geometry is labelled *authored* (SmashWiki silent; `game_BatSwing*Common` not dumped). No source gives a reason to lengthen it. **Phase B:** test the bat at its own spacing in the probe; leave the data alone.

### 2. Ray Gun drawn behind Link, barrel pointing down, while the shot leaves in front (Link only)
- Test: `link shoots from the drawn item › Ray Gun: barrel forward when the shot leaves` → angle −164.9° (DK: 90°).
- Screenshot `b4/link-rayGun-fire.png`: the gun is drawn behind Link's back leg, and the shot (`probe.json` `fire.shots`) leaves at +56 px in front.
- **Cause:** Link's sockets and axes always come from the `HaveR` bone.
  - `tools/link-build-final.py:100` builds `itemAttachmentPoses` from `r['sockets'][hand]`.
  - `tools/link-build-final.py:110` sets `hand = render.ITEM_HAND`.
  - `tools/link-render-clip.py:101` defines `ITEM_HAND = 'HaveR'`.
- In Link's native shooting motions, `HaveR` stays behind the body and `HaveL` is the extended hand. The raw renders in `docs/review/2026-10-14/link-takeover/final-staging/raw/` show it:
  - `h11itemshoot-006` (the shot drawing): `HaveR` at (−22.5, −0.7) with axes y 94°, z −163°. `HaveL` at (+26.7, −9.9) with axes **y 1.1°, z 91.1°, in-plane length 1.0**. That is exactly DK's gun convention at its shot frame (y 0°, z 90°).
  - `h12itemscopefire-000`: `HaveL` at (+12.7, −14.1), y 89.9° (Super Scope along y, as DK's 90.8°).
- The battering motions (`h04swing1/3/4`, `h06swing4bat`) do swing `HaveR` forward. For example, `h04swing3` puts `HaveR` at +45..+47 px with y 90–103° on its active drawings. So the per-clip hand is the issue, not the whole bone choice.
- Before rebuilding, confirm against the native data that Ultimate Link's shooting motions hold the item in `HaveL`. The raw evidence above is strong, but it is pose evidence, not the attach call.

### 3. Ray Gun press cadence (Link only): a Link-only admission path
- Test: `Ray Gun, presses 12 frames apart` fails on Link. DK shoots on steps 8 / **32 / 56**; Link shoots on 8 / **33 / 58**. Ammo matches.
- **Cause:** `FreshLink.mayAdmitItemShooting` (`src/characters/FreshLink.ts:885-893`) refuses a Ray Gun press less than 25 frames after the previous admitted one. That is a separate clock beside the shared shooting session (`itemShooting.ts`, which ends at 24). Related pieces:
  - state `sourceRayAdmission` (`FreshLink.ts:85, 92, 137, 448, 485-489`);
  - reader `getSourceRayAdmission` (`:895`);
  - its own test, `src/characters/linkRayAdmission.test.ts`.
- The base hook is `Character.mayAdmitItemShooting` (`Character.ts` ≈6860, called ≈10910). No other fighter overrides it.

### 4. Shots do not leave the drawn item (every fighter)
- Test: `the shot leaves the drawn muzzle` is red on DK and Link for the Ray Gun, Super Scope and Fire Flower.
  - DK: shot 46–56 px behind the drawn muzzle.
  - Link: 30–78 px off, made worse by §2.
- **Cause:** `Character.queueItemShot` (≈6852) places a shot at `position + facing·shot.spawnOffsetX, position.y + spawnOffsetY`, a fixed authored body offset per `ItemShot` (`RayGun.ts:32`, `SuperScope.ts:37/60`, `FireFlower.ts:33`). `consumeItemShots` (≈6834) only retargets for Pikachu's upper-body layer. The drawn item is never consulted.
- The task asks for shots to spawn from the socket, so this is a shared change.

### 5. Socket position versus the swing box (observation, every fighter; not B4 code)
- Drawings are sparse, so on some active frames the hand drawing is a wind-up drawing. The item is drawn correctly in that hand, but away from the box. Examples:
  - DK bat jab, frame 3: socket (−33.5, −40), so the drawn bat ends behind DK while the box is in front.
  - Link bat forward smash, frame 50: drawing `h06swing4bat` sample 45 (overhead wind-up, `b4/link-homeRunBat-fsmash-active.png`), while the box is live in front.
  - Link bat forward tilt, frame 7: tip at about +10..+21 px; the box reaches 66 px.
- Contacts are unaffected, because swing boxes are body-relative by design. Listed so the art tier can add contact drawings. No phase-B code change.

### 6. Master Sword drawn in hand while an item is carried (observation)
- `probe.json`: `getLinkEquipmentState().sword === 'normal'` during the carry, jab and forward tilt with a Beam Sword or bat. It is `'back'` only on the bat forward smash.
- Screenshots `link-beamSword-carry.png` and `link-rayGun-carry.png` show the Master Sword and the item in or near the same back hand.
- This comes from Link's own gear presentation (`linkItemContextEquipment.ts`), which is B3/art territory. Check it against native item-motion visibility before changing it.

## Is `LINK_ITEM_PROFILE` / `linkItemProfile.ts` still needed?

**The data, yes. The file, no.**

`LINK_ITEM_PROFILE` is a `FighterItemProfile`: toss multipliers, the pickup/throw callback frames, dash motion rate and catch range. That is exactly the per-fighter data the shared planner is designed for. DK and Pikachu carry the same fields inline in `FIGHTER_ITEM_PROFILES`, and the provenance is the same (prcFighterParam @609dc95f row + ItemLight* callbacks). The new tests confirm it drives the shared planner like DK's row: release on the profile frames 7/9/11/6/5/4, pickup 2.

The file itself should go:
- its header still says "STAGED … not imported by the game", which is false;
- its three other exports (`LINK_NATIVE_ITEM_MOVEMENT`, `LINK_ITEM_CALLBACKS`, `LINK_ITEM_EQUIPMENT_EVENTS`) have **zero importers**;
- it makes `src/items/itemActions.ts` import from `src/characters/`, inverting the layer direction.

SmashWiki could not be fetched from this session (domain blocked), so the Link release frames were not re-checked against SmashWiki's Item_throw table in phase A. Do that check when the row moves.

The same "data, not code path" rule applies to the heavy-item plan:
- `getLinkHeavyItemPlan` / `stepLinkHeavyCarry` / `LINK_HEAVY_CARRY_SOURCE` (`linkHeavyItems.ts`) are per-fighter data, but they are selected by `id === 'link'` branches in `Character.ts` (≈1269, 4932, 5085, 9078) and `MatchScene.ts` (≈3093, `donkeyKongHeavyReleaseVelocity(…, id==='link'?'link':…)`).
- Pikachu uses the identical pattern, so this is one shared refactor.

## Phase B edit plan (file → change)

Order: data and tests first, then the shared code once B3 releases `Character.ts`, `FreshLink.ts` and `MatchScene.ts`.

1. **`src/items/itemActions.ts`**: move `LINK_ITEM_PROFILE`'s object into `FIGHTER_ITEM_PROFILES.link` beside DK and Pikachu, with its provenance comment, and drop the import. **Delete `src/characters/linkItemProfile.ts`.** Check its frames against SmashWiki Item_throw (Link row); SmashWiki wins.
2. **`src/characters/heldItemSocket.ts`**: add one `heldItemMuzzle(socket, visual)` helper (socket + axis × `visual.height` × `max(.35, length)`). This is the rule `MatchScene.syncHeldItemRender` uses to draw the sprite, so the drawing and the shot share one implementation.
3. **`src/characters/Character.ts`** (after B3):
   - `consumeItemShots`: compute each shot's origin as `heldItemMuzzle(getHeldItemSocket(), item.visual)` at drain time, so the displayed pose wins. Keep `spawnOffsetX/Y` only as the fallback when no socket row exists.
   - Delete the Pikachu-only `selectShootingLayerLayout` retarget there; the socket already includes the layer offsets.
   - Delete the `mayAdmitItemShooting` hook and its call (≈6860, ≈10910).
   - Replace the `id==='link'` / `id==='pikachu'` heavy-item branches (≈1269, 4932, 5085, 9078) with one per-fighter heavy profile lookup (plan function + carry parameters), the heavy counterpart of `fighterItemProfile`.
4. **`src/characters/FreshLink.ts`** (after B3): delete the `mayAdmitItemShooting` override, `getSourceRayAdmission`, the `sourceRayAdmission` field, and its snapshot/restore lines (85, 92, 137, 448, 485-489, 885-895). **Delete `src/characters/linkRayAdmission.test.ts`.**
5. **`src/scenes/MatchScene.ts`** (after B3):
   - replace the heavy release `id==='link'?'link':…` selector (≈3093) with the per-fighter heavy profile;
   - draw the held sprite through `heldItemMuzzle`'s shared rule, if not already identical.
6. **`tools/link-build-final.py`**: choose the item hand per clip. Use `HaveL` for the shooting clips (`h11itemshoot*`, `h12itemscope*`, and the Fire Flower clips that alias them), and keep `HaveR` for the rest. Do this only after confirming in native data that Link's shoot motions hold the item in `HaveL` (see §2).
   - Re-pack from the existing raw renders, which already record both hands. This regenerates `assets/characters/link/frames.json` (`itemAttachmentPoses`) and `item-axes.json`; no re-render is needed.
   - Record the build identity and the new sha256 lines.
7. **`src/characters/linkHeavyItems.ts`**: fold into the per-fighter heavy profile from step 3. Drop the "STAGED" header.
8. **`tools/link-playable-probe.mjs:329-343`**:
   - per-item spacing (bat 80 px, sword 110 px), recorded in the report;
   - add a Ray Gun shot-origin read (`s.projectiles` minus Link articles) beside the socket.
   - Re-run with `--shots` into a dated folder.
9. Re-run `src/items/linkHeldItems.physics.test.ts` plus the item suites that use the fixture; all must be green.

## Expected red until phase B

| Test (in `src/items/linkHeldItems.physics.test.ts`) | Fighter | Turns green with |
|---|---|---|
| `Link fires shooting items exactly like Donkey Kong › Ray Gun, presses 12 frames apart` | Link | step 4 (delete the Ray admission) |
| `link shoots from the drawn item › Ray Gun: barrel forward when the shot leaves (facing 1)` and `(facing -1)` | Link | step 6 (HaveL sockets for shooting clips) |
| `link shoots from the drawn item › 'rayGun' / 'superScope' / 'fireFlower': the shot leaves the drawn muzzle` | Link | steps 2–3 + 6 |
| `donkeykong shoots from the drawn item › 'rayGun' / 'superScope' / 'fireFlower': the shot leaves the drawn muzzle` | DK | steps 2–3 (shared shot origin) |

Outside this file: `src/characters/heavyCarry.physics.test.ts` (2 red) is caused by the in-flight `MatchScene.ts` edits (see "What was run").

## Screenshots (simulated input, preview of the build made for this record)

`docs/review/2026-10-15/b4/` holds:
- `link-beamSword-{carry,jab-active,ftilt-active,fsmash-active}.png`
- `link-homeRunBat-{carry,jab-active,ftilt-active,fsmash-active}.png`
- `link-rayGun-{carry,fire}.png`
- `probe.json` (socket, drawn item container position, angle and scale, sprite key, equipment and shots per shot; page errors: none)

The held item's container sits exactly on `getHeldItemSocket()` on every frame. Beam Sword and bat are drawn in Link's hand along the socket's +Y axis. The Ray Gun is drawn in the hand the data names (`HaveR`), which is the wrong hand for the shot pose (§2).

The probe script is session scratch (`held-probe.mjs`, adapted from `tools/link-playable-probe.mjs`). It is not committed; step 8 folds the needed reads into the maintained probe.

## Phase B part 1 (done 2026-10-15; no B3-owned file touched)

| Step | Change | Evidence |
|---|---|---|
| 1 | `LINK_ITEM_PROFILE`'s values now live in `FIGHTER_ITEM_PROFILES.link` (`src/items/itemActions.ts`) beside DK and Pikachu. `src/characters/linkItemProfile.ts` is deleted, including its three exports that had no importers. `src/items/` no longer imports from `src/characters/` for this. | `itemActions.test.ts` green; all release/pickup frame tests in `linkHeldItems.physics.test.ts` green. SmashWiki is still unreachable from this session, so the SmashWiki check of Link's row remains open. |
| 2 | `heldItemMuzzle(socket, visual)` and `HELD_ITEM_MIN_FORESHORTENING` (.35) added to `src/characters/heldItemSocket.ts`. They give the drawn far end of a held item: socket + axis × `visual.height` × max(.35, length), or null without an axis. The B4 test's muzzle now calls it. | `src/characters/heldItemSocket.test.ts` (3 tests) |
| 6 | `tools/link-build-final.py` now selects the item hand per motion with `item_hand()`. It is `HaveL` for `h11itemshoot*` and `h12itemscope*`, `HaveR` for everything else, in both `itemAttachmentPoses` and `item-axes.json` (per-drawing and per-native-frame axes). `check` also asserts that socket angles equal the item-axes +Y. Re-packed from `final-staging/raw` (no re-render). | See "Native confirmation" and "Re-pack" below |
| 8 | `tools/link-playable-probe.mjs`: target spacing per item (`ITEM_SPACING`: bat 80 px, the rest 110 px, recorded as `spacing`). An `itemShots` readout (shot origin, held socket, item height and facing, relative to Link) from a wrapped `consumeItemShots`. The probe records the inputs to `heldItemMuzzle` and does not recompute it. | `b4/probe-items/` |

### Native confirmation of the shooting hand (step 6)
- **Native motion data:** `b4/native-hand-visibility.py` was run with the ComfyUI venv Python on the `.nuanmb` motions.
  - In every item motion the held Master Sword mesh `link_ken` is visible and the stowed `link_kenb` is hidden.
  - The `Sword1` bone sits on `HaveR` (0.30–0.64 native units; 7–16 from `HaveL`).
  - So during the shooting motions `HaveR` holds the Master Sword. The extended, empty `HaveL` fist is the only free hand.
- **Pose evidence** (`b4/hand-evidence.txt`, both hands per drawing, from the raw renders):
  - At the shot drawing `h11itemshoot` n7, `HaveL` is at +26.7 px with +Y 1.1° and +Z 91.1°, which is DK's `HaveR` gun frame at its shot frame (+Y 0°, +Z 90°).
  - `HaveR` is at the hip, at −22.5 px.
  - `h11itemshootair` and `h11itemshootairloop` are the same (`HaveL` z 90.8°). `h12itemscopefire` n1 has `HaveL` +Y 89.9°, matching DK's scope at 90.8°.
- **The swings stay on `HaveR`:**
  - `h04swing3` puts `HaveR` at +45..+47 px with +Y 90–103° on its active drawings, while `HaveL` is behind.
  - The `h04swingdash` raw drawings show the back hand driving the blade forward.
- **What is not native:** the attach call itself is in game code we do not have. This is pose + visibility evidence, recorded here.

### Re-pack and install (step 6)
- **Command:** `~/ComfyUI/.venv/bin/python tools/link-build-final.py pack --raw docs/review/2026-10-14/link-takeover/final-staging/raw --out <scratch>/pack --jobs 16`. Result: 220 clips, 1570 drawings, 0 failures.
- **`check`:** 0 schema problems, 0 drawings over the 3 px sink limit.
- **Compared to the installed set** (= `final-staging/sha256.txt`): all 218 PNGs and `pack-report.json` are byte-identical. Only `frames.json` and `item-axes.json` changed:
  - In `frames.json`, only the `itemAttachmentPoses` of the 21 `h11itemshoot*` / `h12itemscope*` clips and `meta.toolSha256['link-build-final.py']` changed.
  - In `item-axes.json`, the same 21 clips changed, plus its `source` / `bone` header.
- **Installed:** the two files were copied into `assets/characters/link/`. Then `sha256sum -c` against `b4/repack/sha256.txt` passed: all 222 installed files match. The repack record (frames.json, item-axes.json, sha256.txt, checks.json, pack-report.json) is in `b4/repack/`.
  - New `frames.json` sha256: f9695880ab61c237a99e0e24970fabd4968f3e3bf742af26ecbc6e3efb158db9.
  - New `item-axes.json` sha256: 8a0d1139cc8c17be482007993cbab442b5aff1f5d9e0ddcf80fec840537c06ec.

### Test state after part 1
- `src/items/linkHeldItems.physics.test.ts`: **74 / 81**. Both "Link › Ray Gun: barrel forward when the shot leaves" tests turned green from the re-pack.
- Link's drawn muzzle is now in front of him: Ray Gun (58.7, −8.0), previously (−30.2, 29.1).
- The 7 red tests are left for part 2: the Ray Gun 12-frame cadence on Link, and the shot-origin test for 3 items × DK and Link.
- Also green: itemActions, heldItemSocket, nativeItemThrow, BobOmb, itemCatchAcquisition, homeRunBat, shootingItems and Pikachu.item-body.
- tsc reports no errors in the changed files.

### In-game check after part 1 (simulated input; new build, preview :4173)
- **Maintained probe:** `node tools/link-playable-probe.mjs --out docs/review/2026-10-15/b4/probe-items --only item --shots`. 0 page errors.
  - **Home-Run Bat at 80 px:** 1 contact (jab, 7.35 = 7 × the freshness bonus, angle 361). At 110 px it had 0.
  - **Beam Sword at 110 px:** 4.2 (jab) and 18.5 (charged forward smash).
  - **Ray Gun:** shot 5 at angle 90, then the smash throw 15.5.
  - **Bob-omb:** 14.7 + 4.55.
  - **Ray Gun `itemShots`:** the origin is still the fixed (+40, −6). The socket is now (+26.7, −9.9) at 91.4°, the extended front hand; the item height is 32. The origin moves to the muzzle in part 2.
- **Screenshots:** `b4/after-repack/link-rayGun-fire.png` shows the Ray Gun in Link's extended front hand, barrel forward, with the shot leaving just in front of the barrel. Before the re-pack (`b4/link-rayGun-fire.png`) it was behind Link, pointing down. The Beam Sword and bat drawings are unchanged (`b4/after-repack/`).

## What part 2 needs (B3-owned files, after B3 lands)

1. **`src/characters/Character.ts`**
   - **Shot origin:** in `consumeItemShots`, set each event's `x, y` to `heldItemMuzzle(this.getHeldItemSocket(), this.equippedItem.definition.visual)` at drain time. That is world coordinates, since `getHeldItemSocket()` is world. If the muzzle is null (no socket axis) or there is no visual, keep the queued `position + facing·spawnOffsetX, position.y + spawnOffsetY`.
     - Then delete the `selectShootingLayerLayout` retarget in `consumeItemShots`; `selectHeldItemSocket` already adds the layer offset.
     - If nothing else imports `selectShootingLayerLayout`, check whether it can become a private helper.
     - Makes the 6 "shot leaves the drawn muzzle" tests green. Re-run `shootingItems.physics.test.ts`, `shootingTurn.physics.test.ts` and `Pikachu.item-body.physics.test.ts`; the Pikachu upper-layer origin must not move.
   - **Ray admission:** delete `protected mayAdmitItemShooting` and its single call in the shooting admission. No fighter other than FreshLink overrides it.
   - **Heavy items:** replace the `this.id==='link'` / `'pikachu'` heavy-item branches with one per-fighter heavy profile lookup: `stepLinkHeavyCarry`, `LINK_HEAVY_CARRY_SOURCE` acceleration and maximum speed, and `getLinkHeavyItemPlan` / `getPikachuHeavyItemPlan`. The lookup should be `{ plan(action), carry: { maximumSpeedNative, accelerationAddNative?, step? } }` keyed by `CharacterId`, the heavy counterpart of `fighterItemProfile`, living in `src/characters/donkeykongHeavyItems.ts` or a new `heavyItemProfiles.ts`.
2. **`src/characters/FreshLink.ts`**
   - Delete the `mayAdmitItemShooting` override, `getSourceRayAdmission`, the `SourceRayAdmission` type/field, its reset and its snapshot write and restore (the `sourceRayAdmission` lines).
   - Delete `src/characters/linkRayAdmission.test.ts`.
   - Makes "Ray Gun, presses 12 frames apart" green. Check any snapshot-schema test that lists `sourceRayAdmission`.
3. **`src/scenes/MatchScene.ts`**
   - The heavy release `donkeyKongHeavyReleaseVelocity(…, id==='pikachu'?'pikachu':id==='link'?'link':'donkeykong')` should read the same per-fighter heavy profile.
   - `syncHeldItemRender` should use `HELD_ITEM_MIN_FORESHORTENING` instead of its literal `.35`, so the drawn sprite and `heldItemMuzzle` share the one rule.
   - `heavyCarry.physics.test.ts` transpiles MatchScene methods; re-run it.
4. **`src/characters/linkHeavyItems.ts`**: move its data into the heavy profile from item 1 and delete the file, or keep it as the data module with the "STAGED" header removed.
5. Then re-run the B4 suite (expect 81/81), the item suites, and `tools/link-playable-probe.mjs --only item --shots`. Expect bat contacts at 80 px and Ray Gun `itemShots[].origin` at the drawn muzzle.

## Phase B part 2 (done 2026-10-15, after B3 landed)

| Step | Change |
|---|---|
| 3 (shots) | `Character.consumeItemShots`: every queued item shot leaves at `heldItemMuzzle(getHeldItemSocket(), item.visual)`. That is read when the shots are drained, so the displayed pose wins. The fixed `spawnOffsetX/Y` in `queueItemShot` is now only the fallback when there is no socket axis or no visual. The Pikachu-only `selectShootingLayerLayout` correction is deleted from `Character`. `selectShootingLayerLayout` is now private to `heldItemSocket.ts`, since the socket already includes the upper-layer offset. This applies to every fighter and every item shot (Ray Gun, Super Scope, Fire Flower, Star Rod star). |
| 3 / 4 (admission) | `Character.mayAdmitItemShooting` and its call are deleted; a fire press always starts the shared shooting session. In `FreshLink.ts`, the Ray admission override, `getSourceRayAdmission`, the `SourceRayAdmission` type and field, its reset and its snapshot write and restore are deleted. `src/characters/linkRayAdmission.test.ts` is deleted. |
| 3 / 5 / 7 (heavy) | One per-fighter heavy profile, `FIGHTER_HEAVY_ITEM_PROFILES` / `fighterHeavyItemProfile(id)` in `src/characters/donkeykongHeavyItems.ts`. Details below. |
| 5 (render) | `MatchScene.syncHeldItemRender` uses `HELD_ITEM_MIN_FORESHORTENING` instead of `.35`, the same rule as `heldItemMuzzle`. |
| probes | `tools/link-bomb-charge-probe.mjs` and `tools/link-specials-parity.mjs` no longer call the deleted `getRemoteBombs()`. Details below. |

**The heavy profile** holds each fighter's native ItemHeavy* callbacks (pickup and release frames, back-throw REVERSE_LR before or after the release, THROW_ITEM_OFFSET), its carry (`groundOnly`, and `walk`: null for DK's SmashWiki cargo walk, else a native speed cap plus a calibrated acceleration multiplier or the native lift add), and its `lift` fighter_param record.
- `heavyItemPlan(fighter, action)` builds the plan over the shared timeline and throw table. It replaces `getDonkeyKongHeavyItemPlan`, `getPikachuHeavyItemPlan` and `getLinkHeavyItemPlan`, which were three copies of one template.
- `stepGroundOnlyHeavyCarry` replaces `stepPikachuHeavyCarry` and `stepLinkHeavyCarry`, which were identical.
- `donkeyKongHeavyReleaseVelocity` takes any `CharacterId`.
- `Character.ts`: the `id==='link'` / `'pikachu'` branches (carry step, walk acceleration and maximum, the ground-only action guard, action creation) now read the profile.
- `MatchScene.ts`: the release selector passes `character.id`, and the airborne heavy drop uses `carry.groundOnly`.
- **Behaviour change:** Link now drops a heavy item when airborne, like Pikachu; both have ground-only carries. Everything else is unchanged numerically.
- `src/characters/pikachuHeavyItems.ts` and `src/characters/linkHeavyItems.ts` are deleted. `pikachuHeavyItems.test.ts`, `donkeykongHeavyItems.test.ts`, `heavyCarry.physics.test.ts` and the B4 test now call `heavyItemPlan` and the profile `lift`.

**The bomb probes** read the bomb from the scene's Link articles plus its `LinkRemoteBombItem`.
- Both now set `linkIntroPolicy: 'none'`, so the match entry does not lock Link.
- The bomb-charge probe asserts the item-based bomb (`link-remote-bomb`, drawn by the generic item renderer) and Spin charge without a live hitbox.
- The specials probe accepts `PF_SPECIALS_ONLY=<id substring>`.

### Results (part 2)
- **Typecheck:** `tsc --noEmit`, 0 errors in the whole project.
- **Tests:** `npx vitest run src/items …heavy/socket/Link suites` gives 38 files, **569 / 569**.
  - That includes `src/items/linkHeldItems.physics.test.ts` **81 / 81**, `heavyCarry.physics.test.ts`, `donkeykongHeavyItems`, `pikachuHeavyItems`, `heldItemSocket`, `shootingItems`, `shootingTurn`, `homeRunBat`, StarRod and `Pikachu.item-body`.
  - Unrelated red found while widening the run: `ultimateUniversalRules.physics.test.ts`, 4 shield-break tests (break stun reads 0). None of the touched code is on that path.
- **Build:** vite build OK; the preview on :4173 serves it.
- **Item probe** (`b4/probe-items-part2/`, input simulated, 0 page errors):
  - Bat at 80 px: 7.35. Beam Sword: 4.2 / 18.5. Ray Gun: 5 and 15.5. Bob-omb: 14.7 + 4.55.
  - **Ray Gun shot origin (+58.7, −9.1) = the drawn muzzle** (socket (+26.7, −9.9) at 91.4°, item height 32). Before part 2 it was the fixed (+40, −6).
  - `b4/after-part2/link-rayGun-fire.png` shows the shot leaving the barrel tip.
- **Bomb probes:** both now get past setup, then stop on old-kit expectations that are not part of B4:
  - `link-bomb-charge-probe.mjs`: the Spin release check (`released.elapsed` 3 vs the legacy 6 / 18.2) fails before any bomb step.
  - `link-specials-parity.mjs`: `bow-0` sourced damage fails. With `PF_SPECIALS_ONLY=bomb`, `bomb-side-1` times out waiting for `getActiveAttack().framesElapsed === 10` after the detonate press.
  - These belong to the specials runtime (WP3). The probes need their Spin / bow / detonate expectations re-derived from the fresh Link data.
