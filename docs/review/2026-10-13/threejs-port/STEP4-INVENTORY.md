# Step 4 inventory: delete every fighter except Donkey Kong, Pikachu, Link

Read-only survey, 2026-10-13, working tree dirty (another AI editing Link). Counts come from
grep/wc on that tree; "refs" counts are line matches, not unique symbols. Re-run the greps in
"Verification greps" before starting, the tree will have moved.

## 1. Roster and Link

`CHARACTER_IDS` (src/types/index.ts:20-35) = wolf, cat, owl, bear, blaze, puff, aegis, volt, nova,
bruno, link, kirby, donkeykong, pikachu (14).

- Remove (11): wolf, cat, owl, bear, blaze, puff, aegis, volt, nova, bruno, kirby.
- Keep (3): donkeykong, pikachu, link.
- Today `ACTIVE_FIGHTER_IDS = ['donkeykong','pikachu']` (src/characters/activeFighters.ts:10, untracked
  file). `link` is **not** in the mask, so the vite test exclude (vite.config.ts:11-14) also excludes
  `Link{,.*}.test.ts` (about 20 Link test files). Step 4 must add `link` to the kept set or the Link
  suites stay silently excluded.

Link is one id with two runtimes, they coexist:

- `src/characters/Link.ts` (4 lines) re-exports `Link` from `FreshLink.ts` (1032 lines) plus
  `linkFreshKit`. Fresh is the default (`ultimate-rebuild-v1`).
- `src/characters/LegacyLink.ts` (779 lines) is built only when `characterId === 'link' &&
  options.linkRuntimeRevision === 'legacy'` (characterFactory.ts:206).
- `'legacy'` is still produced for: Lab-saved Link specs with no revision (characterStorage.ts:226),
  Lab custom characters (characterSnapshot.ts:18,33; MatchStart.ts:444), old replays
  (replayMigrations.ts:545 stamps `'legacy'` on pre-revision link slots; ReplayFile.ts:955-958),
  and the type `LinkRuntimeRevision` (types/index.ts:85, validated in characterSerializer.ts:2685).
- Legacy art `assets/characters/link_legacy/` (4.2 MB, untracked) is loaded in manifest.ts:43,1225-1228,
  1854 and spriteAnimationDriver.ts:77,1186 (`registerLegacyLinkSpriteAnimations`). The select
  screen and Lab preview use `char.link_legacy.idle` as the Link portrait
  (CharacterSelectScene.ts:1530, CharacterEditorScene.ts:958). MatchScene uses a
  `legacy-link-arrow` projectile renderer (MatchScene.ts:7776, ordinaryProjectileCheckpoint.ts:13).

Recommendation (not a decision): keep LegacyLink + `link_legacy` out of step 4. Removing them is a
separate "retire legacy Link" change that needs (a) the select/Lab portraits repointed at the fresh
`char.link.*` idle, (b) old replays with `linkRuntimeRevision:'legacy'` either dropped or re-stamped,
(c) the `'legacy'` arm of `LinkRuntimeRevision` and the serializer/storage fallbacks removed. It
is about 780 source lines plus 4.2 MB of art and touches replay compatibility, which the port
cares about (golden replays in step 5). Ask the user (open question 1).

## 2. Per-fighter manifest

Source line counts: Wolf 1518, Cat 1387, Owl 1415, Bear 1435, Blaze 827, Puff 742, Aegis 833,
Volt 717, Nova 811, Bruno 712, Kirby 571 = **10,968 lines** in `src/characters/<Name>.ts`.

| Group | Files | Lines |
|---|---|---|
| `src/characters/{Wolf,Cat,Owl,Bear,Blaze,Puff,Aegis,Volt,Nova,Bruno,Kirby}.ts` | 11 | 10,968 |
| `src/characters/{Wolf,Cat,Owl,Bear}.ts.before-hitbox-scale` (backups, not imported) | 4 | 3,722 |
| Own tests `{Aegis,Blaze,Bruno,Kirby,Nova,Puff,Volt}.test.ts` (Wolf/Cat/Owl/Bear have none) | 7 | 1,688 |
| `data/characters/{aegis,bear,blaze,bruno,cat,nova,owl,puff,volt,wolf}.json` (all 10 legacy files; no kirby) | 10 | 585 |
| Tracked art: `git ls-files assets/{characters,generated/sprites,palettes}` for the 11 ids | 152 | n/a |
| Tracked legacy art `assets/sprites/characters/{wolf,cat}/` | 20 | n/a |
| Dirs `assets/characters/<id>/` (aegis 6.8 MB, kirby 5.0 MB, nova 328 KB, others < 200 KB) | 11 dirs | ~12.5 MB |
| `assets/generated/sprites/{wolf,cat,owl,bear}/` palette PNGs (448/192/32/32 KB) | 4 dirs | ~0.7 MB |
| `assets/palettes/{wolf,cat,owl,bear}.json` (build-time palette defs) | 4 | n/a |

Tracked-file split under assets (git ls-files): aegis 29, kirby 29, wolf 12, cat 12, owl 6, bear 6,
blaze 5, bruno 5, nova 5, puff 5, volt 5, plus 4 palette json files and the four generated dirs.
Note `.palette-cache.json` stays tracked (see section 3).

### Registrations to edit (each lists all 11 ids; the file has to keep link/donkeykong/pikachu)

| File | What | Evidence |
|---|---|---|
| src/types/index.ts | `CHARACTER_IDS` array (keystone) | :20-35 |
| src/characters/fighterRegistry.ts | `FIGHTER_REGISTRY: Record<CharacterId,...>`, 11 imports | :56-67, :152 |
| src/characters/roster.ts | `CHARACTER_ROSTER` (367 id refs), 11 imports | :86-225, :1151 |
| src/characters/index.ts | barrel re-exports (207 refs, blocks at :441-684) | :441,461,484,508,534,554,574,598,618,638,683 |
| src/characters/visualScale.ts | 4 Record maps (44 keys) | :58,94,157,196 |
| src/characters/handAnchors.ts | `FIGHTER_HAND_ANCHORS` | :46 |
| src/characters/palettes.ts | `Record<CharacterId, palettes>` + 11 `*_PALETTES` | :512-514 |
| src/characters/fighterMovementProfiles.ts | profile Record | :479 |
| src/characters/movesetAnimationDriver.ts | `MOVESET_TABLE` (163 refs), imports :102-201 | :312 |
| src/characters/movesetAnimationCues.ts | cue Record + literal id arrays | :403-416, :467, :484 |
| src/characters/groundedNormalDriver.ts | Record + imports :117-128 | :275 |
| src/characters/defensiveAnimationState.ts | literal id array | :579 |
| src/characters/spriteAnimationDriver.ts | `case` per id (:174-314), `MOVE_SHEET_KEYS` | :693 |
| src/characters/animationState.ts | id literals (7) | grep |
| src/characters/authorableCharacterRegistry.ts | `COMPILED_KITS` (`import * as XKit`), `ExtendedMoves`, special-case `id==='cat'||'owl'||'bear'` | :7-20, :24, :52 |
| src/characters/characterFactory.ts | doc + dispatch (4 refs; mostly through FIGHTER_REGISTRY) | :154-157 |
| src/characters/contractFighter.ts, attackRegistration.ts, aerialAttackInput.ts, aerialSchema.ts, moveSchema.ts, specialFramework.ts, Character.ts | doc comments only (`WOLF_JAB` examples) | Character.ts:885,999,2207,3284,7227,10347 |
| src/characters/nativeShieldTraction.ts | `kirby:'kirby', puff:'jigglypuff', aegis:'marth'`, plus wolf-ssbu/pyra/mythra values | :9-14 |
| src/characters/activeFighters.ts | mask (see section 5) | whole file |
| src/entities/Fighter.ts | imports Bear/Cat/Owl/Wolf only to `void` them | :117-120, :357-360 |
| src/assets/manifest.ts | `ASSET_KEYS` (charWolf*, charKirby*, ...), per-fighter `*Spritesheets` arrays (cat :916, wolf :951, owl :989, bear :1024, blaze :1065, puff :1107, aegis :1145, kirby :1267), `PALETTE_VARIANT_CHARACTERS` (:1485-1527), palette keys :728-735 | file is 1928 lines |
| src/scenes/CharacterEditorScene.ts | `IDLE_TEXTURES` (11 keys), Lab lists | :66-78 |
| src/scenes/ModeSelectScene.ts:395, StageSelectScene.ts:457 | hard-coded `characterId:'cat'` default P2 | grep |
| src/scenes/lobby.ts, handCursorState.ts, characterSelect.ts | already derive from mask; comments mention Wolf/Cat | lobby.ts:93 |
| src/scenes/MatchScene.ts | `recipe.kind==='nova'/'owl'` (:1872,:1884), `move.id.startsWith('owl'/'nova')` (:7773-7776), `maskPlayerSlots` (:4427) | grep |
| src/characters/ordinaryProjectileCheckpoint.ts | renderer kinds `'owl'`, `'nova'` (:13-14, :78-80) | needs checkpoint/replay review |
| src/replay/stateChecksum.ts | doc mentions only | :159,208 |
| src/previews/Pikachu*Preview.ts (10 files) | use `getAuthorableCharacterSpec('wolf')` / `new Character({id:'wolf'})` as the actor/opponent | PikachuJabPreview.ts:31,149; PikachuMatchPreview.ts:166 |
| src/characters/Pikachu.ts | `import { WOLF_GRAB } from './Wolf'` and uses its fields | :33,73-75 |
| vite.config.ts | `MASKED_FIGHTER_TEST_EXCLUDES` | :11-27, :54 |
| scripts/validate-character-data.ts, package.json `validate:characters` | reads `data/characters/*.json` | package.json:16 |

`vite.config.ts` could not be left as is: after the fighter files are gone the first spread in
`MASKED_FIGHTER_TEST_EXCLUDES` iterates an empty set (fine), but the explicit menu-suite excludes and
`referenceAutolink.test.ts` should be reviewed (section 4).

No per-fighter data for removed ids was found in: `src/items/` (FIGHTER_ITEM_PROFILES
itemActions.ts:57, `usesByFighter` ItemDefinition.ts:149, heldItemSocket.ts:40-44 key only DK, Pikachu,
Link), `src/ai/` non-test code, `src/audio/combatAudio.ts`, `src/stages/`, `src/match/` non-test code,
`src/input/` non-test code. (A loose word grep showed hits, they were English words like "cat"/"nova"
in prose, or `volt` in Pikachu's Volt Tackle: `VOLT_TACKLE_SOURCE`, src/finalSmash/pikachuVoltTackle.ts:20,
which is Pikachu content and **must stay**.)

### Tools and docs

- `tools/*.mjs|cjs|py|ts` mentioning a removed id as a quoted id or `characters/<id>/`: **78** files
  (of 582 in tools/). Nearly all (about 70) are Pikachu/DK probes that start a match with
  `{ index: 2, characterId: 'wolf' }` as the opponent (e.g. dk-kit-acceptance.mjs:71,
  pikachu-lab-acceptance.mjs:108). They are fixed by a one-token sed (`'wolf'` -> `'pikachu'` or
  `'donkeykong'`), or are already masked at runtime by `maskPlayerSlots` (MatchScene.ts:4427).
- Probes that only exist for removed fighters (delete): `_drive-kirby.cjs`, `blast-probe.mjs`,
  `ko-probe.mjs`, `registry-lab-acceptance.mjs`, `temper-sweep.mjs`, `verify-ko.mjs`; art-pipeline
  helpers keyed on cat/wolf sprites: `build-newchar-sprites.cjs`, `measure-sprite.cjs`,
  `gen-sprite.ts`, `comfy-style.ts`, `downscale.ts` (check each for DK/Pikachu use before deleting;
  `measure-sprite.cjs` and `hud-acceptance.mjs` also reference blaze).
  `tools/user-replay.json` embeds wolf/cat players (stale replay fixture).
- Docs: `docs/` has 7 tracked files, everything under `docs/review/<date>/` is untracked evidence
  (18 dated dirs, 2026-09-09 .. 2026-10-13). They mention these fighters but are pure history.
  **Recommend keeping all**. Update only the live ones: CLAUDE.md "What this is"/"Characters",
  `docs/CHARACTER-CHECKLIST.md` (historical), `assets/characters/README.md` (wolf/cat sections),
  `docs/review/2026-10-11/ultimate-items/roster-mask.md` (mark mask retired).
  I did not run a full-text grep of docs (the drive is slow, a `du` hit the 120 s timeout).

## 3. Shared modules: dead vs still used

Dead once the 11 fighters go (only they, or tests of them, import them):

| Module | Why | Evidence |
|---|---|---|
| src/characters/extendedMoves.ts (250 lines) | importers: Cat/Owl/Bear + authorableCharacterRegistry only | grep |
| src/creatures/wolfPup.ts (70) + `WOLF_PUP` export | only creatures/index.ts + creatureRegistry tests; keep the registry/schema (characterSerializer.ts and specialSchema.ts use `creatureId`) | grep |
| Build-time palette pipeline: `scripts/palette-swap.ts`, `scripts/palette-swap/*` (cache, index, paletteDefinition, paletteSwap, README, 2 tests), `assets/palettes/*.json`, `assets/generated/sprites/**`, `PALETTE_VARIANT_CHARACTERS`/`paletteVariantTextureKey` in manifest.ts:728,1485-1556, `prebuild`/`build:palettes`/`palette-swap` scripts (package.json:8,14,15) | only wolf, cat, owl, bear have variant PNGs; DK/Pikachu/Link use the **runtime** palette shader (`paletteSwapShader.ts`, `runtimePaletteRenderer.ts`, used by MatchScene.ts:5071 and CharacterSelectScene.ts:1432), which stays | `npm run build` would run `prebuild` over nothing |
| `scripts/validate-character-data.ts` + `npm run validate:characters` + `data/characters/` | validates the 10 legacy JSONs; no DK/Pikachu/Link file there | package.json:16 |
| `src/characters/*.ts.before-hitbox-scale` (4) | stale backups | |
| MatchScene owl/nova projectile recipes and `ordinaryProjectileCheckpoint` `'owl'`/`'nova'` kinds | Owl/Nova-only content | MatchScene.ts:1872,1884,7773-7776 |
| `getNativeShieldPushTraction` entries for kirby/puff/aegis | Kirby/Puff/Aegis rows only | nativeShieldTraction.ts:9-14 |

Likely dead, verify (could be Lab/schema infrastructure that DK/Pikachu/Link kits exercise):
`specialFramework.ts`, `extendedSlotResolver.ts`, `moveResolver.ts` (importers: only `characters/index.ts`
and tests, so they are already near-dead today regardless of this step). `dodgeState.ts` and
`shieldState.ts` are used by Character.ts, keep.

Still used by DK/Pikachu/Link, **do not delete**: `specialSchema`, `sideSpecialSchema`,
`upSpecialSchema`, `downSpecialSchema`, `grabSchema`, `throwSchema`, `chargeSchema`, `aerialSchema`,
`contractFighter`, `movesetContract`, `moveSchema` (all imported by DonkeyKong.ts, Pikachu*.ts,
FreshLink/link*.ts), `PaletteSwapRenderer`/`paletteSwapShader`/`runtimePaletteRenderer`,
`hurtState` (imports the `FighterStateSnapshot` type from `src/entities/Fighter.ts`, also
src/replay/stateChecksum.ts uses it), `entities/Fighter.ts` itself (drop only the 4 `void` imports).

Hidden coupling (must fix before deleting Wolf): `src/characters/Pikachu.ts:33,73-75` takes
`holdFramesMax`, `throwRecoveryFrames` and `dashGrab.momentumRetain` from `WOLF_GRAB`. Inline those
three numbers (or move them to a Pikachu constant) in the same batch. Also tests that build a
`Wolf` for a kept fighter: `DonkeyKong.recovery.physics.test.ts:4`, `Pikachu.footstool.physics.test.ts:4`,
`Character.launchInfluence.physics.test.ts:8`.

## 4. Tests that hardcode the roster or use a removed fighter as a fixture

Test files with at least one removed-id/import reference outside the fighters' own tests: **about 115**
(strict pattern `'wolf'|WOLF_*|from './Wolf'` etc.). 7 own tests (1,688 lines) are plain deletes.
Biggest edits (refs / file lines):

| Test | refs / lines | Action |
|---|---|---|
| characterSpec.test.ts | 527 / 1825 | rewrite to the 3-fighter roster (imports :38-77) |
| Character.test.ts | 346 / 8064 | switch fixture ids to donkeykong/pikachu |
| Roster.test.ts | 211 / 1632 | rewrite; also has 2 failing Pikachu cases in the baseline |
| HitboxDamageHandler.test.ts | 140 / 1365 | fixture id swap |
| downSpecialSchema/upSpecialSchema/specialSchema tests | 133, 127, 74 | fixtures from Wolf/Cat/Owl/Bear moves; rebase on DK/Pikachu moves |
| characterSelect.test.ts | 114 / 2129 | rewrite (hard-codes 14 cells; currently excluded) |
| entities/Fighter.test.ts | 101 / 1245 | swap Wolf/Cat/Owl/Bear for DK/Pikachu |
| paletteSwapShader.test.ts | 93 / 970 | uses wolf palettes as data |
| characterSerializer.test.ts | 65 / 880 | imports Wolf/Cat/Aegis/Blaze moves :28-31 |
| animationState / spriteAnimationDriver / PaletteSwapRenderer / movesetContract / characterFactory / palettes / runtimePaletteRenderer / handCursorState tests | 58, 58, 57, 54, 52, 52, 49, 40 | roster loops, update expectations |
| fighterRegistry.test.ts, perFighterSmoke.test.ts, smashChargeRoster.test.ts, fighterAnimationState/defensiveAnimationState/groundedNormalDriver/movesetAnimationDriver/Cues/handAnchors/aerialSchema/combatSfx tests | 25..7 each | shrink to 3 ids |
| replay suites (ReplayFile, ReplayStorage, ReplayLibrary, RewindController, FrameAdvanceStepper, PlaybackSimulationStateManager, Desync*, IndexedDB/LocalStorage storage, replayMigrations, stateChecksum, VcrOverlay, ...) | 1-33 each | mostly one `characterId:'wolf'` in a fixture; sed to `'donkeykong'`. Check stateChecksum.test.ts (33 refs) and replayMigrations.test.ts |
| Pikachu physics tests (pikachu*.physics.test.ts, Pikachu.specials/footstool/ledge-jump) | 1-4 | the `'wolf'` opponent fixture |
| scenes: menuJourneys, LobbyScene, CharacterSelectScene, CharacterSelectMouseOwnership, CharacterLabSession, characterTuneSelection, modeSelect, customStageMatchLauncher, ResultsScene/resultsStats | 1-9 | currently excluded by vite.config.ts:16-24, update then drop from the exclude list |
| ai: AIInputProvider.test, LiveCpuController.physics.test, Easy/Medium/HardTierAI.test, HardTier trees | 2+ | fixture ids |

Replay/stateChecksum code carries the id as a plain string, so fixtures that just name `'wolf'`
as an opaque id would still pass; the ones that build a real `Wolf`/read `CHARACTER_ROSTER.wolf`
will fail on import/typecheck once files are removed, which gives a natural worklist
(`tsc` points at them, vitest will not because of the excludes).

Baseline (roster-mask.md): 484 files / 12,396 tests, 13 failures pre-existing before this step
(Camera snap, Link air drift, Pikachu Roster x2, characterJabSerializer Link x2, 2 knockback
serializers, PlayerControlsPanel x3, RebindingScreen, Character.test.ts held-item smash).
"Typecheck, tests, build green" in the PLAN is not achievable without first fixing or
accepting those; ask the user (open question 3).

## 5. Ordering hazards and persistence

Typecheck:

- `CharacterId` is a union derived from `CHARACTER_IDS`. Narrowing it breaks every
  `Record<CharacterId, ...>` map (visualScale x4, handAnchors, palettes, fighterMovementProfiles,
  fighterRegistry, groundedNormalDriver, movesetAnimationCues, movesetAnimationDriver, roster,
  authorableCharacterRegistry `COMPILED_KITS`) at once, excess properties are errors in
  `satisfies`/typed literals. Those must change in the **same** commit as the union.
  Not guarded by tsc (runtime-only, CLAUDE.md): ordered arrays and the asset manifest
  (`defensiveAnimationState.ts:579`, `movesetAnimationCues.ts:467,484`, `spriteAnimationDriver.ts` case
  list, `ASSET_KEYS`/`*Spritesheets`, `CharacterEditorScene` `IDLE_TEXTURES` partial Record, roster
  order list). Run a post-step probe of select, Lab and a match.
- `Partial<Record<CharacterId,...>>` maps (heldItemSocket, itemActions, upperBodyLayer,
  MOVE_SHEET_KEYS, IDLE_TEXTURES) only fail on excess keys if object-literal checked, heldItemSocket,
  itemActions and upperBodyLayer already list only DK/Pikachu/Link.
- Delete order inside a fighter: first the registrations (they import the file), then the file,
  then its tests; `fighterRegistry.ts`, `roster.ts`, `movesetAnimationDriver.ts`,
  `groundedNormalDriver.ts`, `index.ts`, `authorableCharacterRegistry.ts` import all 11 modules by name.
- Pikachu.ts imports `./Wolf` (section 3), delete Wolf last or inline first.
- Wolf/Cat/Owl/Bear are imported by `entities/Fighter.ts` (void imports), the four are also the
  fixtures of most tests, so delete them last.

Persisted data that names removed ids:

| Store | Behaviour after deletion | Action |
|---|---|---|
| Last/saved match config (Phaser registry `BOOT_REGISTRY_KEYS`, rematch, replay start) | `MatchScene.ts:4427` already runs `maskPlayerSlots` which rewrites non-active ids to an active fighter by slot index (activeFighters.ts:26-34) | keep the function but redefine "active" as "in CHARACTER_IDS" (`toKnownFighterId`), delete the temporary-mask wording |
| Lab saves `platformfighter:characters:v1:<slot>` | `characterStorage.ts:204-231` calls `parseCharacterDataFile`; an unknown id throws in characterSerializer.ts:313 and the record is dropped (returns `null`), so the slot silently disappears | accept (user data loss of removed fighters only) or tell the user; no crash |
| Replays (`ReplayFile.ts:886-924`, IndexedDB/localStorage libraries, downloaded files, `tools/user-replay.json`) | `characterId` only checked as non-empty string, so a wolf replay loads, then fails at playback (unknown id; not caught by mask unless the replay path calls `resolveActiveMatchConfig`) | add an explicit refuse-with-message check in ReplayFile parse, or migrate to a fallback; decide with the user (golden replays in step 5 should be DK/Pikachu/Link only) |
| `platformfighter.bindings.v1.*`, named profiles | no fighter ids | none |
| `platformfighter.customStages.v1.*` | stage data only | none |
| Character-select persisted picks (if any in localStorage/registry) | not found in survey | recheck `characterSelect.ts` default picks |

`SIMULATION_BUILD_ID` hashes `src/`, `data/characters/`, `assets/characters/`: **every** batch changes
it, which invalidates replay metadata `engineVersion` (expected; mention in commit messages).

## 6. Size

| | Files | Lines |
|---|---|---|
| Fighter sources + 4 backups | 15 | 14,690 |
| Own tests | 7 | 1,688 |
| extendedMoves + wolfPup | 2 | 320 |
| Palette pipeline scripts + validate script | 10 | ~3,715 (incl. scripts/validate-character-data.ts, palette-swap tests) |
| Legacy `data/characters/*.json` | 10 | 585 |
| Subtotal deleted source/data | ~44 | ~21,000 |
| Tracked art (assets/characters, generated, palettes, sprites/characters) | ~172 tracked + untracked leftovers | ~13 MB on disk |
| Edited (registrations ~25 files, ~115 tests, ~70 tools) | ~210 | est. -4k to -6k net, the registries shrink from 11 entries to 3 (roster.ts, movesetAnimationDriver.ts, index.ts barrel alone are ~1,500 lines of removed entries) |

Expect roughly **-25k to -30k lines** and **-13 MB** of assets overall. About 8-10 % of the roughly 69k Phaser-importing lines are
unaffected (the removed code is Phaser-free data plus subclasses), but `Character.ts` (14k) and `MatchScene.ts` (9.5k) shrink only slightly:
only a few `startsWith('owl'|'nova')` branches and comments go.

## 7. Recommended order (each batch ends with `npm run typecheck`, then targeted vitest)

0. Prep (no deletion): decide open questions; add `link` to the kept set and drop the Link entry
   from the vite excludes; run a full baseline of typecheck/vitest to know the 13 pre-existing failures.
1. Decouple: inline `WOLF_GRAB` fields in `Pikachu.ts`; drop the 4 `void` imports in `entities/Fighter.ts`;
   switch Pikachu/DK physics tests and the `src/previews/Pikachu*Preview.ts` fixtures from `wolf` to `pikachu`/`donkeykong`;
   sed `tools/*` `'wolf'`/`'cat'` opponents. Green before any deletion.
2. Fixtures: replace wolf/cat/owl/bear in the ~115 tests and ModeSelect/StageSelect defaults, using only kept ids.
   Everything still compiles with the old union.
3. Delete the 7 low-coupling fighters (Blaze, Puff, Aegis, Volt, Nova, Bruno, Kirby): remove their entries
   from `CHARACTER_IDS` **and** all Record maps, arrays, switch cases, manifest keys/sheets,
   barrel and registry imports in one commit; delete their `.ts`, `.test.ts`, `data/characters/*.json`, `assets/characters/<id>/`.
   Then typecheck and fix leftovers.
4. Delete Wolf, Cat, Owl, Bear the same way plus `*.before-hitbox-scale`, `extendedMoves.ts`, `wolfPup`,
   Owl/Nova projectile recipes in MatchScene, `ordinaryProjectileCheckpoint` kinds (check replay snapshots),
   `assets/sprites/characters/{wolf,cat}`.
5. Retire the build-time palette pipeline: `scripts/palette-swap*`, `assets/palettes`, `assets/generated/sprites`
   (keep or delete `.palette-cache.json`), `PALETTE_VARIANT_CHARACTERS`, package.json `prebuild`/`build:palettes`/`palette-swap`/`validate:characters`.
   Confirm `npm run build` and a preview match before moving on.
6. Drop the mask scaffolding: `ACTIVE_FIGHTER_IDS` -> known ids, remove `MASKED_FIGHTER_TEST_EXCLUDES`
   (vite.config.ts:11-27) and re-enable the 7 excluded menu suites after updating them
   (characterSelect, handCursorState, menuJourneys, characterTuneSelection, CharacterLabSession, CharacterSelectMouseOwnership, LobbyScene).
7. Replay/persistence fallback (section 5), update CLAUDE.md, `assets/characters/README.md`, mark roster-mask.md retired.
8. Full ritual: `npm run typecheck && npx vitest run && npm run build`, then a preview probe (select grid has 3 cells,
   Lab lists 3, DK/Pikachu/Link match, replay record + load).

## 8. Open questions for the user

1. Retire `LegacyLink` + `assets/characters/link_legacy` (about 780 lines + 4.2 MB) in this step, or later? Retiring means
   old Link replays / Lab Link saves with `linkRuntimeRevision:'legacy'` stop loading and the select/Lab Link portraits move to fresh art.
2. Old replays and Lab saves of removed fighters: silently dropped (Lab), refuse with a message (replay), or remap to DK?
3. Should the step wait for / include fixing the 13 pre-existing failing tests, or accept them as the baseline?
4. Keep the build-time palette variant pipeline (and its 4 fighters' PNGs) for the future, or delete it with them?
5. Delete the art folders from git history only on disk (untracked `assets/characters/aegis`, `kirby` etc.), or also remove tracked files in one commit?
6. Replace the `wolf` opponent in the ~70 Pikachu/DK probes with `pikachu`/`donkeykong`, or leave the tools as historical and only delete the fighter-only ones?

## 9. User decisions (2026-10-13)

1. **Legacy Link: remove in step 4.**
   - `LegacyLink.ts`, `assets/characters/link_legacy/` and the `'legacy'` arm of
     `LinkRuntimeRevision` all go, together with the storage and serializer
     fallbacks and the `legacy-link-arrow` renderer.
   - The select and Lab Link portraits move to the fresh `char.link.*` idle art.
2. **Old replays and Lab saves of removed fighters (and of legacy Link): remove.**
   - They are dropped on load, with no remap.
   - Replays that name a removed fighter, or `linkRuntimeRevision: 'legacy'`, are
     rejected at load instead of failing at playback.
3. **Pre-existing failing tests: "depends what it is"** -> triaged in section 10.
   Each is fixed, or deleted with the code it tests.
4. **Build-time palette pipeline: delete with Wolf, Cat, Owl and Bear**, on the
   condition that the kept fighters stay recolourable.
   - Done in the port: the HSV region recolour (see `costumes/README.md`).
   - Before that, the game only had the whole-sprite `setTint` fallback for them.
5. **Untracked art of removed fighters (`aegis`, `kirby`, …): delete.** It will
   be regenerated if those fighters ever come back.
6. **Probes using `wolf` as the opponent: switch** them to a kept fighter
   (`pikachu` against DK, `donkeykong` against Pikachu and Link). Probes that
   exist only for a removed fighter are deleted.

## 10. Failing-test triage (full suite, 2026-10-13 17:47, tree in flux)

`npx vitest run`: 12,248 tests, 162 failed across 42 files (JSON in the
session scratchpad). The tree was mid-edit by the other agent, so re-run at the
gate before acting. Groups and actions:

| # | Cause | Files | Action |
|---|---|---|---|
| A | Link mid-rebuild (other agent). One invalid move, `link.smash2` (`chargeStartFrame requires charge`), stops ~45 suites from loading, DK and Pikachu ones included. Fresh-Link expectations also fail: characterSpec (24 moves vs 10), groundedNormalDriver, movesetAnimationDriver, special and ordinary landing, `tools/link-runtime-geometry-proof` (written at that minute) | ~50 | Not ours. Re-run at the gate; if still red, report to the other agent / user |
| B | Items phases 9–10 in progress (other agent) | RemoteBombAdapter, containerRuntime, healingItems, itemCatalog (14 vs 12 items), heavyCarry | Same as A |
| C | Generic mechanics tests that use **legacy Link** as their fixture | Character.{airMovement, landing, launchRecovery, referenceLaunchEnergy, shieldRelease}, attackCollisionShapes, HitboxDamageHandler.collisionHits, simulationSpriteAnimation (Link cases) | **Fix** in step 4: retarget to DK / Pikachu when legacy Link goes (decisions 1 and 6) |
| D | Final Smash added an input bit (7 → 8 fields), `finalSmashRules` in the match config, and a binding row; the tests were not updated | tauntTransport, ReplayFile, ReplayInputCompleteness, replayTypes, ReplayCharacterSnapshot, replayMigrations, PlayerControlsPanel | **Fix**: update expectations after the gate (check first that the other agent has not already) |
| E | Hardcoded full roster | Roster, perFighterSmoke, fighterRegistry, manifest (wolf, owl, bear sheets) | **Fix** in step 4: rewrite for DK / Pikachu / Link |
| F | Code the port deletes | PreloadScene, RebindingScreen (the new row overflows: 990 > 956 px; the port's Controls screen replaces it), moveFramePreview and characterEditorFields (Character Lab, dropped by the user) | **Delete** with the code in step 9 |
| G | Stale test | CameraController `snap()` (clamp added later) | **Fix** in the runbook's CameraController step |

## Verification greps

```
grep -rlE "['\"](wolf|cat|owl|bear|blaze|puff|aegis|volt|nova|bruno|kirby)['\"]|\b(WOLF|CAT|OWL|BEAR|BLAZE|PUFF|AEGIS|VOLT|NOVA|BRUNO|KIRBY)_[A-Z]|from '(\.\./characters|\.)/(Wolf|Cat|Owl|Bear|Blaze|Puff|Aegis|Volt|Nova|Bruno|Kirby)'" src
grep -rnE "['\"]char\.(wolf|cat|owl|bear|blaze|puff|aegis|volt|nova|bruno|kirby)\." src
```
Run these after each batch; the final result should only list prose.
