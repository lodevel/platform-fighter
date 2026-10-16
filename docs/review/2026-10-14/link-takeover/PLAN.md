<!-- Planning agent output, 2026-10-14, read-only analysis of the tree. User decisions so far: DK/Pikachu pipeline and scale; missing pose = invisible. -->

# Plan: finishing Link (playable, DK/Pikachu pipeline)

Everything below comes from reading the tree as it is on 2026-10-14 (read-only). Nothing was changed.

## 0. Facts that drive the design

1. **DK is the model, and it works without per-drawing geometry.**
   - DK's damage comes from move data: `DK_NATIVE_ATTACKS` in `donkeykongAttackData.ts`, with SmashWiki overrides in `donkeykongSourceMoves.ts`.
   - Each hit is a capsule on a `hitWindows[]` entry, in fighter-local pixels at 5 px per native unit (`dkSourceHits`).
   - Positions for non-root bones come from `tools/dk-native-hit-positions.py`, which reads the posed native skeleton.
   - Hurtboxes are the generic `postureBodyHurtbox()` plus per-move protection windows. Only 16 DK clips carry `hurtboxPoses`.
   - DK's frames.json is 1.2 MB and contains only `meta`, `animations` and `runtimeFinalFxProfiles`.
2. **Link's geometry is what makes it fail.**
   - Every Link normal is `hitbox 1×1, sourcePoseRequired:true`. `FreshLink.getSourceAttackCollisionHits` reads `runtimeOutgoingPoses`, which exist only for the 16 normals.
   - `FreshLink.unsunkActiveHurtboxes()` returns `[]` when no pose exists. **So whenever Link is invisible, he also has no hurtbox and cannot be hit.**
   - Projectiles spawn from per-drawing sockets (`arrow-release`, `boomerang-release`, `bomb-root`). With no special art, there is no socket, so the specials fail closed.
3. **What the 41 installed resources actually contain.**
   - 1,842 drawings, about one per native frame (DK averages about 7 drawings per clip).
   - `scaleToWorld` = 0.29412, i.e. 17 art px per native unit. DK and Pikachu use 0.4666667.
   - The installed pages are 1,213 MB decoded. After downscaling they would be about 480 MB.
   - Each drawing has about 70 contour-scanline hurt capsules. That is most of the 25 MB of `runtimeBodyProfiles`.
   - `runtimeEquipmentBindings` (1.8 MB) is proof receipts only.
4. **The existing Link drawings are cel renders of the native model, not ComfyUI output.** They use the authored UV atlas "atlas-v4/cel-v3" posed by native motions. Because the native skeleton and the art share one scale (5 world px per native unit), hit capsules computed from native bones line up with both the existing drawings and any new art posed from native-motion guides.
5. **The standard packer already exists.** `tools/dk-rework-pack.py` takes cutouts with a root pixel and native samples, writes per-clip strips with a fixed root at 0.4666667 world per px (wrapping at 4096 px), and outputs `animations` entries with `root`, `scaleToWorld`, `bodyCentreFromRootY` and `nativeSampleIndices`. DK's native-timed path (`selectDonkeyKongNativeSampleFrame`, `getDonkeyKongBodyRenderMetrics`) consumes exactly that format.
6. **Constraints from the port.**
   - The gate merge step 5a edits `simulationSpriteAnimation.ts` (`createArtFrameSelector`).
   - Step 4 edits `manifest.ts`, `spriteAnimationDriver.ts`, `characterFactory.ts`, `characterSerializer.ts`, `activeFighters.ts` and `vite.config.ts`.
   - Step 5 extracts MatchSim from `MatchScene.ts`, and its goldens include Link scenarios.
   - **Port step 8 (user decision 2026-10-13) removes the Character Lab in step 9.**

## a. Hit and hurt geometry: move to DK-style data. Yes.

**Decision:** Link's hit, hurt and article geometry becomes move data, generated once from native bones and committed, the same way DK's is. The art only provides pixels, a root and native-sample timing.

- **Hitboxes.**
  - Generalize `tools/dk-native-hit-positions.py` into `tools/native-hit-positions.py --fighter dk|link`, using `dk_native_pose.py` or `link_native_pose.py`. Delete the DK-only script in the same change.
  - It emits capsules per gameplay age and packet id for:
    - the 16 normals;
    - the 4 recovery attacks (getup ×2, trip, ledge);
    - ground and air Spin Attack;
    - grab and catch boxes;
    - article release points for arrow, boomerang, bomb and Ancient Arrow.
  - Output goes to `src/characters/linkAttackGeometry.json`.
  - Link moves then carry real `hitWindows[].collisionHits`. Where a capsule moves within a strike, split it into per-frame windows that share one `group` (one hit per victim per group).
  - Remove `sourcePoseRequired` and the 1×1 hitbox from all Link moves.
- **Hurtboxes.** Use the base `postureBodyHurtbox()` plus SmashWiki intangibility and protection windows (`hurtboxModifiers` / `protectionWindows`). Link then always has a hurtbox, visible or not.
- **Article spawn points.** Use authored `spawnOffsetX/Y` per move or phase, taken from the same tool at the release frame.
- **Cross-check.** For the 16 normals, the tool must reproduce today's `runtimeOutgoingPoses` within 1 px. After that check, `runtimeOutgoingPoses` is deleted.

### What happens to each frames.json key

| Key | Fate |
|---|---|
| `runtimeBodyProfiles` | The converter (b) turns it into standard `animations` entries (cells, root, `nativeSampleIndices`, `loopDuration`, `actionFrameStarts`, `itemAttachmentPoses` from the 109 `item` sockets). Then deleted, together with receiving contours, headContact, captureSupport, passiveShield, bakedArticles, and the sword/waist attachments. |
| `runtimeOutgoingPoses` | Cross-check input for the hit tool, then deleted. |
| `runtimeBodyProfileAliases` | Becomes the converter's rename table (native motion name to engine sheet name), then deleted. |
| `runtimeEquipmentBindings`, `runtimeTextureSources`, completion/receipt fields | Deleted. |

### Link modules: keep, replace or delete

**Keep (gameplay; data rewritten as described):**
- Kit and data: `Link.ts`, `FreshLink.ts` (shrinks a lot), `linkFreshKit`, `linkFreshMovement`, `linkMovement`, `linkUfdStats`, `linkFreshGrab`, `linkNormalRules`.
- Move builders, rebuilt from the data: `linkFreshNormals`, `linkFreshRecoveryAttacks`, `linkFreshSpin`, `linkFreshSpecials`.
- Special mechanics: `linkSpecialController`, `linkSpinController`, `linkSpinTiming`, `linkBow`, `linkBoomerang`, `linkBoomerangFlight`, `linkRemoteBomb`, `linkRemoteBombPhysics`, `linkArrowLifecycle`, `items/LinkArrowItem`, `items/LinkRemoteBombItem`.
- Small mechanics and profile data: `linkSmashFollowupCharge`, `linkItemProfile`, `linkHeavyItems` (plan data, same pattern as Pikachu), `linkFootstool` (contact-profile data only).
- Simplify:
  - `linkIntrinsicStateValidation` and `linkArticlePlanValidation` (snapshot parsing).
  - `linkSpinContactSelection`, reduced to a data lookup.
  - `linkAncientFinal` and `finalSmash/linkAncientBow`.
  - `linkPassiveShield`: one fixed capsule per state (idle/walk/crouch), not per drawing. **User decision.**
- Keep or delete together with the Lab (decision 1): `linkIntrinsicAuthoring`, `linkIntrinsicCombatPacket`, `linkSourceMoveIdentity`.
- Conditional:
  - `linkSwordBeam`: keep only if SmashWiki confirms Ultimate Link fires a beam on forward smash; otherwise delete.
  - `linkNativeAttackPacket`: becomes the reader for the condensed `linkAttackData.json`, or is folded into it.

**Replace with a shared path or data, then delete:**
- Body pipeline, replaced by `animations` plus the shared native-timed clip clock:
  - `linkBodyRuntime`, `linkBodyPresentation`, `linkBodyProfileValidation`.
- State-to-pose routing, replaced by the shared body candidate (A4) and `actionFrameStarts`:
  - `linkCommonBodyRoute`, `linkCommonPresentationController`, `linkCommonMotionFacts`;
  - `linkAirPresentation`, `linkDamagePresentation`, `linkContextualPresentation`;
  - `linkGuardReleasePresentation`, `linkLandingPresentationLease`, `linkIntrinsicPresentation`;
  - `linkRecoveryAttackRuntime`, `linkNormalBodyClock`.
- Articles, replaced by authored offsets plus `src/match/linkArticles.ts`:
  - `linkArticlePresentation`, `linkArticleCollisionGeometry`, `linkArticlePairClank`.
- Item shots, replaced by the shared shot path that DK and Pikachu use: `linkItemShotEmission`, `linkQueuedItemShot`, `assets/characters/link/item-muzzles.json`.
- Attack height, baked into the attack data: `linkSourceAttackHeight`.
- Shield tilt, replaced by the shared shield: `linkShieldTilt` and its Facts JSON.
- UI previews, replaced by the shared idle drawing (also what `port/fighters/poses.ts` uses): `linkUiPresentation`, `linkIntrinsicUiPreview`.
- Source packet JSONs, condensed into one `linkAttackData.json` that holds only fields the runtime reads (like `DK_NATIVE_ATTACKS`) plus a SmashWiki override table: `linkSelectedNormalPackets.json`, `linkSelectedSpecialPackets.json`, `linkSourceNormals.json`, `linkSourceRecoveryAttacks.json`.

**Delete (proof, lease and observer infrastructure; no gameplay):**
- Equipment family: `linkEquipment`, `linkEquipmentBindings`, plus Normal/Intrinsic/ItemContext/Landing/Taunt equipment modules and their `*Facts.json`.
- Capture leases: `linkCaptureEquipmentLease`, `linkCaptureActionEquipment` and its Facts JSON, `linkFreshCaptureSource.json`.
- Composition and presentation leftovers: `linkHandOverlayBindings`, `linkHandOverlayPresentation`, `linkShootingComposition`, `linkShootingComponents`, `linkFrozenClankPose`, `linkOwnBowArticle`.
- Source bookkeeping: `linkSourceBindings` (it has no importers), `linkSourceClock`, `linkSourceContactReference`.
- Custom texture loader: `src/assets/fresh{EncodedTextureSources,LinkTextureResidency,RgbaSourceManifest,SourcePixelMetrics}.ts`, the PreloadScene branch, and the `chargeReadout` ink-top use.
- Results: `src/scenes/linkResults{Callbacks,FxAnchors,Presentation}.ts` and `linkResultsCallbackFacts.json`, replaced by the shared results path once the win clips exist.
- Character.ts receiving duplicates (package B3 confirms each one is covered by a shared path or unreachable in a DK/Pikachu/Link roster, then deletes it):
  - `linkCrumpleReceiving`, `linkSleepBindReceiving` (no sleep or crumple attacker remains after step 4);
  - `linkRollReceiving`, `linkShieldBreakReceiving`, `linkShieldBreakPhysics`;
  - `linkProneFood`, `linkRecipientTemplateOverride`;
  - `linkCommonRecoveryPresentation`, `linkCommonEventPresentation`;
  - `linkLedgeJumpPreparation`, `linkLedgeJumpPhysics`, `linkPassiveShieldSdi`;
  - the ~36 `getLinkRuntimeRevision()==='ultimate-rebuild-v1'` branches (only once step 4 has removed legacy Link).
- Tools (proof only):
  - installers: `install_link_*`;
  - runtime proofs: `link-runtime-*`, `link-*-proof*`, `link-collision-parity`, `link-runtime-observers`;
  - geometry, equipment and qualification scripts: `link_physical_*`, `link_*equipment*`, `qualify_link_*`, `review_link_*`, `link_anatomical_*`, `link_audited_*`, `link_conditional_*`, `link_immutable_*`, `link_pinned_*`, `link_targeted_uair14*`, `link_author_raster_v2.*`, `link_normal_745*`, `link_normal_exclusive_745*`, `prepare-link-normal-landing-gear-demand.py`;
  - shooting guides: `link-composed-shooting-guide*`;
  - old scripts and probes: `_build-link-idle.cjs`, `_drive-link.cjs`, and the `link-*-launch.mjs` probes (the physics suites cover them).
  - Keep `link_native_pose.py`, `link-native-guide.py`, `link_native_uv_raster.py` and `link-native-article-guide-v2.py`.

## b. Downscaling the 41 installed resources in one deterministic tool

1. **`tools/fighter-pack.py`.** It replaces `dk-rework-pack.py`, gains `--fighter` and keeps `ppu`/`bodyHeight` as spec fields. Delete the old file in the same change. It must re-pack one DK clip byte-identically.
2. **`tools/link-convert-installed.py`** (one-shot). For each profile and drawing, in order:
   - crop the cell from its page PNG (`render.sheet`/`frameIndex`; the PNGs are lossless sources, not the `.rgba` files);
   - set root = (originX·frameWidth, originY·frameHeight);
   - write a fighter-pack spec with ppu 17 (5/0.29412) and bodyHeight 72. The scale factor is s = 0.29412/0.4666667 = 0.6303, so a 330 px idle becomes about 208 px.
   - Rename clips to engine sheet names: `a00wait1→idle`, `a01walkmiddle→walk`, `c00attack11/12/13→jab/jab2/jab3`, `c01attacks3s→tilt`, `c02attackhi3→utilt`, `c02attacklw3→dtilt`, `c00attackdash→dash_attack`, `c03attacks4s/s2/charge→smash/smash2/smash_charge`, `c04attackhi4(+charge)→usmash(_charge)`, `c04attacklw4(+charge)→dsmash(_charge)`, `c05attackair{n,f,b,hi,lw}→nair/fair/bair/uair/dair`, `c05landingair*→landing_air_*`, `a03jumpf/b→jump/jump_b`, `a03jumpaerialf/b→airjump/airjump_b`, `a04fall*→fall/air_drift/fall_b/fall_aerial*/fall_special*`, `b02escapen→spot_dodge`, `b02escapeair→air_dodge`.
   - Write per clip:
     - `nativeSampleIndices` = startAge+1 for each drawing;
     - `loopDuration` = loopFrames;
     - `actionFrameStarts` for normals, baked from the current `linkNormalBodyClock` mapping (mostly −1 offsets), so that module can be deleted;
     - `itemAttachmentPoses`, converted to body-centre coordinates (y + 36).
   - Generate `item-axes.json` with `derive_item_axes.py`.
   - Output is a new `frames.json` (`meta` + `animations`) plus `animations/<sheet>.png`, with sorted iteration and sha256s recorded. Running it twice must give byte-identical output.
   - After the output is committed, delete `encoded-rgba-v1/` (117 MB), the six page directories (about 100 MB) and the converter. Archive the source pages outside the repo.
3. **Collision with legacy names.** The new sheet names collide with the legacy 256 px `char.link.*` sheets (`animations/idle.png`, `jab.png` and so on, registered by `linkSpritesheets`/`linkMovesetSpritesheets`). Those entries and their `ASSET_KEYS` must go in the same change. Then regenerate the block with `sync-manifest-sheets.py link`.

**What in the runtime depends on pixel scale:**
- Unchanged: world-px geometry (it was root-relative), `bodyCentreFromRootY` −36, physics.
- Changed by the conversion: frameWidth/Height, `scaleToWorld`, origin fractions, page pixels.
- Also tied to the art:
  - manifest spritesheet entries;
  - MatchScene's Link render branch (~line 8813) and `applyInitialFreshLinkPose`;
  - `spriteAnimationDriver.ts:996`;
  - Character Select / Lab portraits (`char.link_legacy.idle`, repointed to `char.link.idle`);
  - `finalBodyPose.ts` (static Link import);
  - `heldItemSocket.ts` (Link added to `CLIPS`/`AXES`);
  - `visualScale.ts` (link display size becomes irrelevant once root metrics are used, same as DK);
  - `port/fighters/poses.ts`.

## c. The 55 MB frames.json after (a)

- What remains is `meta`, `animations` (about 0.3 MB now, about 1 MB with the full kit) and later `runtimeFinalFxProfiles`. That is the same shape and size as DK and Pikachu.
- **Keep the static JSON import**, as DK and Pikachu do. The port reads it the same way, and the boot-time validation disappears with the validators.
- Lazy per-match loading of fighter textures and JSON would help all three fighters. It is a shared follow-up, not part of the Link work.

## d. Missing art inventory

Production route:
- **U**: a UFD GIF exists in `assets/gen/link-rework-ufd/`. Use `ufd-pose-canny.py`.
- **N**: native motion only. Render the guide with `tools/link-native-guide.py`.
- All `.nuanmb` motions exist under `assets/gen/link-native-reference`.
- Common flow: ComfyUI `gen-frames-cn.ts` with the downscaled Link idle as identity reference (one GPU job at a time), then cutout, `fighter-pack.py` at 0.4667, then `sync-manifest-sheets.py link`.
- Target density is DK's: about 7 drawings per clip.

| Tier | Clips (native resources) | Approx. count | Source |
|---|---|---|---|
| **1 Movement** (always on screen) | walk slow/fast, turn, walk brake L/R, dash, run, run brake L/R, turn dash, turn run (+brake), jumpsquat, crouch start/wait/end, landing light/heavy, landing fall special. **Also entry `j00entryr`**: every match currently starts with about 140 invisible frames, so I recommend moving it here. | ~19 | N |
| **2 Defence, ledge, hurt, capture** | guard on/hold/off/damage, just-shield-off, escape f/b, rebound; damage hi/lw/n (start with 1 of each tier, not 3×3), damage air, fly n/hi/lw/top/roll/meteor, damage fall; down wait/stand/forward/back/attack, face up and down; passive (tech) ×6; cliff catch/wait/climb/attack/escape/jump1-2; slip (trip) ×6; furafura (shield-break dizzy); capture pulled/wait/damage/cut/jump (Link grabbed by DK or Pikachu); damage elec | ~55 | U: Ledgegrab, Ledgehang, LedgeRoll, ledge attack, getup attacks, trip attack. N: everything else. |
| **3 Specials** | N start/loop/end ×2 (ground/air), S1/S2 ×2, Hi / HiStart / HiHold / AirHi, Lw / LwBlast ×2 | 18 | U: SpinAttackG/A. N: bow, boomerang, bomb. |
| **4 Grabs and throws** | catch, dash, turn, pull, wait, attack, cut; throws f/b/hi/lw | 11 | U: Grab, DashGrab, PivotGrab, Pummel, F/B/U/DThrow |
| **5 Items** | light get/eat/walk ×4, light throws ×10, heavy ×6, swings ×5, hammer ×3, bat, shoot legs ×4, shoot ×6, scope ×15, wait/squat item | ~56 | N. Skip `a00itemhand*` overlays; DK has none. |
| **6 Taunts and results** | appeal hi/lw/s, win 1-3 plus waits, lose | 10 | N |
| **7 Final Smash** | `d04final`, `d04finalair`, plus Ancient Arrow and blast FX (through the shared `runtimeFinalFxProfiles`) | 2 + FX | N |
| Articles | arrow, boomerang, bomb (+explosion) sprites | 4 | U stills (LinkArrow / Boomerang / BombThrown / BombExplode .png) |
| Optional (leave out unless asked) | wait2/3, footstool steps ×5, sleep ×3, ottotto, ceiling/wall stop and damage, pass, run/walk fall, camera hit | ~20 | N |

**GPU estimate:** about 175 clips × 7 drawings ≈ 1,200 frames at roughly 40–70 s each ≈ 15–25 GPU hours. With retries and review that is **2.5–4 weeks of serial wall time**.

## e. Work packages

Effort uses the 5 levels low to max. "Opus-high" means a high-effort agent, per your rule for Character.ts and diagnosis.

| WP | Content | Files owned (exclusive while active) | Depends on | Verification | Est. |
|---|---|---|---|---|---|
| **P0 Harness** (Sonnet, low) | Move the triage probe to `tools/link-playable-probe.mjs`. Add metrics per scenario: invisible frames, hurtbox count, contacts against a SmashWiki table, articles spawned. Run Link suites with `vitest.link.config.mjs` until step 4. Delete `link-movement-probe.mjs` once this covers it. | `tools/link-playable-probe.mjs` | none | Probe runs on the current build and reproduces the triage numbers | 0.5 d |
| **A1 Native hit tool + geometry** (Sonnet, high) | `native-hit-positions.py`; `linkAttackGeometry.json` for normals, recovery attacks, spins, grabs and release points | `tools/native-hit-positions.py`, `tools/dk-native-hit-positions.py` (deleted), `src/characters/linkAttackGeometry.json` | none (can start now) | DK output identical to the old script; Link normals within 1 px of `runtimeOutgoingPoses`; a unit test on the JSON schema | 1.5 d |
| **A2 Data-driven moves** (Opus-high) | Condense the packet JSONs into `linkAttackData.json` with SmashWiki overrides. Build hitWindows/collisionHits. Remove `sourcePoseRequired`, the FreshLink collision/hurtbox overrides and `linkNormalBodyClock`. Add SmashWiki intangibility windows. Fix numeric `group` values. | `linkFresh*.ts`, `linkNormalRules.ts`, `linkNativeAttackPacket.ts`, packet JSONs, `FreshLink.ts` (collision/hurtbox region), `Link.*.physics.test.ts`, `Link.test.ts` | A1 | `Link.normals/jabLaunch/tiltLaunch/...` physics suites pass without art; new test that Link always has ≥1 hurtbox; probe shows every normal hitting while invisible frames are counted | 2–3 d |
| **A3 Pack tool + converter** (Sonnet, medium) | `fighter-pack.py` and `link-convert-installed.py`. Output to a staging dir (it is installed by A4). | `tools/fighter-pack.py`, `tools/dk-rework-pack.py` (deleted), `tools/link-convert-installed.py` | none | Re-run gives identical bytes; root registration and bbox margins checked per drawing; DK clip re-pack identical; side-by-side contact sheet before vs after at match scale | 1.5 d |
| **A4 Presentation switch** (Opus-high) | Move DK's body candidate, native-timed clip clock, tail and render metrics into a shared `packedBodyPresentation.ts` used by DK and Link. DK's `s.donkeykongBody` generic fields become fighter-agnostic. Link alias table holds **only** genuine same-motion aliases (e.g. `jump_short→jump`). DK's pending-sheet fallback is not applied to Link. A missing sheet means an invisible sprite (decision 3) and never falls through to the generic idle/attack sheets. Install the A3 output. Delete the body and presentation modules listed in (a), `applyInitialFreshLinkPose`, the fresh texture loaders, legacy `char.link.*` manifest entries and the `link_legacy` portraits. Add Link to `heldItemSocket`. | `Character.ts` (body-state section), `FreshLink.ts`, `donkeykongBodyPresentation.ts` → shared module, `simulationSpriteAnimation.ts`, `spriteAnimationDriver.ts`, `heldItemSocket.ts`, `MatchScene.ts` (render ~8800, 2160, 5406), `PreloadScene.ts`, `manifest.ts`, CharacterSelect/Editor portrait lines, `finalBodyPose.ts`, `assets/characters/link/**` | A2, A3, **gate merge (step 5a)**, ideally **step 4** | DK animation suites unchanged and DK golden replays IDENTICAL; frames.json schema test (`nativeSampleIndices` length equals frameCount, `scaleToWorld` 0.4666667, root inside the cell); probe: installed states visible, missing states invisible but hurtbox present; `npm run build` | 4–6 d |
| **B1 Specials** (Opus-high) | Article origins from data. Remove the bow-own and baked-article gates. Fix the bow release loop, boomerang spawn, bomb pull/throw/detonate, and spin hits. Extract MatchScene's Link article block (~1,000 lines in 1300–3600) into Phaser-free `src/match/linkArticles.ts` (this helps port step 5). Draw articles following the add-spawned-object rules. | special/article modules in (a), `items/Link*Item.ts`, new `src/match/linkArticles.ts`, `MatchScene.ts` Link-article region, `FreshLink.ts` (special section) | A1. Can prepare pure modules alongside A4; integrates after A4 | `Link.specials/bow/groundSpin/specialReference` physics suites; probe: arrow, boomerang and bomb exist, travel, hit with SmashWiki damage, blast radius drawn | 4–5 d |
| **B2 Normals audit** (Sonnet, medium) | Make forward-smash strike 2 enter. Check jab tap cadence. Check every value against SmashWiki (SmashWiki wins). Bair hit 2 and late uair. Confirm or delete the sword beam. | `linkNormalRules.ts`, `linkSmashFollowupCharge.ts`, `linkAttackData.json`, FreshLink input section | A2 | Per-move table test; probe for smash2 at +8/+14/+20 | 1–2 d |
| **B3 Character.ts Link collapse + defence/ledge** (Opus-high) | Remove the revision branches. Delete the receiving duplicates listed in (a) after checking each against the shared path. Diagnose rolls (shield+side), spot dodge (shield+down) and ledge grab against a DK baseline with identical simulated input. | `Character.ts` (exclusive), deleted modules, `characterSerializer.ts` / `attacks.ts` Link metadata fields | A4, step 4 | Shield/dodge/ledge physics tests for Link and DK; probe defence and ledge scenarios | 3–5 d |
| **B4 Items** (Sonnet, medium) | Held items through the shared socket and shot path. Diagnose why Home-Run Bat swings miss. Delete the Link item equipment and muzzle path. | FreshLink item section, `itemActions.ts` Link profile, `assets/characters/link/item-*.json` | A4, art tier 5 for visuals | probe: Beam Sword / Bat / Ray Gun / Bob-omb hit and are drawn in hand | 1.5–2 d |
| **B5 Final Smash** (Sonnet, high) | Ancient Arrow origin from data instead of the `Character.ts:3299` socket gate; hit and launch values; FX profile; body clip | `src/finalSmash/linkAncientBow.ts`, `linkAncientFinal.ts`, Link parts of `FinalSmashChoreography.ts`, Final section of `linkArticles.ts` | B1, art tier 7 | Probe in a fresh match without `resetForRound`: opponent takes damage and launches; FX drawn | 2–3 d |
| **B6 Lab round-trip** (Sonnet, low) | Lab lists Link; save, load and use in a match; the 3 `CharacterEditorScene` type errors | `CharacterEditorScene.ts`, `authorableCharacterRegistry.ts`, `characterSerializer.ts` | A2, step 4. **Skip if the Lab is dropped (decision 1).** | serializer tests + probe | 1 d |
| **B7 Green bar** (Sonnet, medium, last) | Remaining tsc errors, MockScene `body.plugin`, `characterSpec` expectations, replay version, proof-tool deletions | tests + residual files | all | `npm run typecheck && npx vitest run && npm run build` + preview probe | 1.5 d |
| **C Art** (serial GPU; Sonnet medium + Opus review) | **C0 pilot first**: 2 clips (walk, jumpsquat) in ComfyUI next to the downscaled existing drawings, checked at match scale, user accepts. Then tiers 1→7. Each tier ends with `fighter-pack` + manifest sync and a probe run showing that state's invisible frames go to 0. | `assets/characters/link/**` (after A4), `assets/gen/link-*`, the fighter-pack spec files | A3 (for scale); install after A4 | Per clip: identity/alpha/root/floor check; probe visibility | 3–4 wk wall |

**Ordering and parallel streams**
- **Now, while the merge lands:**
  - Stream 1: A1 then A2 (Link data files only; outside merge scope).
  - Stream 2: A3, then the C0 pilot on the GPU.
  - Stream 3: P0.
- **After the gate merge and step 4:**
  - A4 (it owns Character.ts, MatchScene render and the manifest while it runs).
  - In parallel: B1 pure modules, B2.
- **After A4:** B3 (Character.ts), then B1 integration (MatchScene article region), B4, B5. These run alongside art tiers.
- **Port step 5** (MatchSim extraction and the Link goldens) should start only after B1 has moved Link out of MatchScene and A2/A4 have changed Link's simulation. Otherwise the Link goldens must be re-recorded.
- **Code total:** about 24–33 agent-days, about 3–4 weeks wall with 2–3 parallel streams. **Overall about 5–6 weeks**, with art as the long pole.

## Decisions needed from you

1. **Character Lab:** your goal includes the Lab round-trip, but port step 8/9 (your decision of 2026-10-13) deletes the Lab. Keep B6, or drop it along with `linkIntrinsicAuthoring` and the related Lab code?
2. **Art style match:** the existing Link drawings are cel renders of the native model, not ComfyUI output. The C0 pilot must pass before the batch. If ComfyUI Link does not match, the choices are: (a) accept the mix; (b) re-render the remaining poses with the existing native-model cel renderer (no GPU, exact match, but not the DK/Pikachu pipeline); (c) regenerate the existing 41 resources with ComfyUI (against decision 2).
3. **Drawing density and memory:** keeping all 1,842 drawings costs about 480 MB of decoded textures for 41 clips; DK's whole kit is about 750 MB. Keep all of them, or thin to about every 2nd–3rd native frame (DK density)?
4. **Invisible states:** until tier 1 is done, Link is invisible at match entry (about 140 frames every match) and while walking or crouching. Move entry into tier 1, as I recommend?
5. **What "every state" covers:** OK to delete Link-only receiving mechanics (sleep, crumple, prone food, the grabbed-pose override, passive-shield SDI) and use the shared behaviour? And keep the passive Hylian Shield only as a simple per-state capsule?
6. **Sword beam on forward smash:** I'll follow SmashWiki. If the page doesn't list it, the beam is deleted.

### Critical Files for Implementation
- /mnt/c/Workspace/platform-fighter/src/characters/FreshLink.ts
- /mnt/c/Workspace/platform-fighter/src/characters/donkeykongBodyPresentation.ts (becomes the shared packed-body presentation)
- /mnt/c/Workspace/platform-fighter/src/characters/Character.ts
- /mnt/c/Workspace/platform-fighter/tools/dk-rework-pack.py and /mnt/c/Workspace/platform-fighter/tools/dk-native-hit-positions.py (to be generalized)
- /mnt/c/Workspace/platform-fighter/src/scenes/MatchScene.ts (Link render branch ~8800 and article block ~1300–3600)
- /mnt/c/Workspace/platform-fighter/assets/characters/link/frames.json

## User decisions on this plan (2026-10-14, binding; override the plan where they differ)

1. **Character Lab:** skipped for Link (the Lab goes away in port step 9). Drop B6; Lab-only Link code (`linkIntrinsicAuthoring` etc.) is deleted with the Lab work.
2. **Art method:** reuse the other AI's renderer: native mesh posed by Ultimate motions, rasterized flat with the hand-painted `atlas-v4/cel-v3` texture (`tools/link_author_raster_v2.*`, `link_native_uv_raster.py`). **Not ComfyUI.** Output directly at DK scale (0.4666667 world per px). Keep only projection + flattening; drop per-drawing geometry, fitting and receipts. Package C becomes "C-render": a CPU pipeline, no GPU queue.
3. **Density (revised the same day):** DK density, about 7 drawings per clip at key poses, for new AND existing Link animations. Reason: the roster will grow to 12+ characters, and 8 different fighters can share a match, so each fighter gets a GPU budget of ~50–70 MB. Also: tight packing (measured ×0.39), GPU-compressed textures (KTX2/Basis UASTC, ×0.25) landing with the three.js port, and loading only the fighters in the match. Keeping one drawing per frame would mean ~12,000 drawings ≈ 4.5 GB decoded.
4. **Missing pose:** Link stays invisible (unchanged).
5. Coordinator calls on the remaining points: entry `j00entryr` moves into tier 1; Link-only receiving mechanics with no attacker left after step 4 are deleted in favour of the shared path (B3 verifies each); passive shield = one capsule per state; the sword beam follows SmashWiki. CORRECTION (B2): SmashWiki Link (SSBU) and Forward_smash/Hit_1 list a Sword Beam fired by the first swing at 0% (5 + 8·charge/60 %, BKB 45, KBS 15); the code already matches, so it is KEPT. It still needs an article sprite (add to the unresolved art list).

## Renderer pilot outcome (2026-10-14, C-pilot/)

- `tools/link-render-clip.py <motion> --out <dir> --frames ...` renders DK-scale cel cutouts with a native-origin root. Style matches the installed art (walk: silhouette overlap 0.9994, mean colour diff 0.27/255). 7-drawing clip ≈ 5 s with 7 workers; the whole missing inventory at DK density ≈ 15–20 min.
- **KEEP (needed for pixels; overrides the deletion lists above):** `tools/link-authored-guide.py`, `link_native_pose.py`, `link_native_uv_raster.py`, `dk-native-guide.py`, `link_author_raster_v2.{py,cpp}` (+ a build step for its `.so`), `link_part_owned_equipment_v2.py`/`v3.py`; data under `docs/review/2026-10-12/link-character/rework/art/` (atlas-v4 textures, semantic-class PNGs, `equipment-palette-v1/`, `native-pilot/neutral-native0.json`) and `assets/gen/link-native-reference/decoded-c00/`. Move `production-cel-style-v2.py` and `author-cap-volume-conditioned-v2.py` into `tools/`.
- `ssbh_data_py` was loaded from volatile `/tmp/pikachu-source-libs`: must live in the ComfyUI venv.
- Re-render the installed idle (it predates the Slate/feather gear recolour). Gear rule (held over stowed) needs a per-clip check for items, bow specials and entry.
