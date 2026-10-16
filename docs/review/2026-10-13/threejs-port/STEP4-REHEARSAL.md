# Step 4 rehearsal: remove fighters (scratch copy)

Date 2026-10-13. Scratch copy `/tmp/claude-1000/-mnt-c-Workspace-platform-fighter/2df34bcb-0dda-42e2-8a0a-eae923f800f7/scratchpad/step4-trial`.
Patch: `.../step4-trial/step4.patch` (src only, 40,643 lines: 29,539 removed, 1,183 added); tools patch `.../step4-tools.patch` (1,893 lines).
Pristine src/tools snapshot for diffing: `.../scratchpad/orig/`.

## INCIDENT (read first)

While cleaning the scratch copy I ran `rm -rf assets/sprites/characters`. In the scratch copy `assets/sprites` is a symlink to
the repo, so this **deleted the real `/mnt/c/Workspace/platform-fighter/assets/sprites/characters/`** (20 tracked wolf/cat files + README).
Step 4 deletes that directory anyway, but it must be restored for now. Fix: `git checkout -- assets/sprites/characters`.
My attempt to copy it back from `.tmp/dk-live-gallery/platform-fighter-before-phase6-20261012T155612Z/sprites/characters` (21 files)
was denied by the permission classifier ("Modify Shared Resources"); I did not work around it. Nothing else under the repo was modified
except this report. Lesson for the real gate: never `rm` through a symlinked dir.

**Resolution (user, 2026-10-13):** "old characters can stay deleted". The directory is not restored; step 4 removes it anyway.

## Baseline (scratch copy, before changes)

- tsc: 59 errors (all Link/in-flux files, MatchScene typing, FinalSmash, etc.).
- vitest: 12,123 tests, 202 failed, 52 suites fail to load (41 of them: `compiled character 'link': moves.fair.autoCancelWindows[0].endFrame must be a finite number, got null`,
  the other AI's Link work; 8 ENOENT/import on `docs/review/...` JSON because the scratch copy has no `docs/`; 1 empty tools .mjs).

## Per-batch actions and tsc deltas

| Batch | Action | tsc errors |
|---|---|---|
| 0 | baseline | 59 |
| 1 decouple | inline WOLF_GRAB (`holdFramesMax 90`, `throwRecoveryFrames 24`, `dashGrab.momentumRetain 0.5`) in Pikachu.ts; drop 4 void imports in entities/Fighter.ts; 9 Pikachu previews + 4 physics tests moved off wolf (DK/Pikachu); tools: 7 fighter-only probes deleted (`_drive-kirby.cjs`, blast-probe, ko-probe, registry-lab-acceptance, temper-sweep, verify-ko, cpu-projectile-probe [owl projectile]), `tools/user-replay.json` deleted (stale wolf/cat replay; `replay-probe.mjs` default path now dangles), ~95 probes sed'ed to DK/Pikachu opponents | 59 (delta 0) |
| 2 fixtures | blind id sed in 98 small test files | 72 (+13, all tests asserting per-fighter lists) |
| 3+4 (merged) | narrowed `CHARACTER_IDS` to link/donkeykong/pikachu, deleted 11 fighters + LegacyLink + extendedMoves + wolfPup + `.before-hitbox-scale`, removed their entries in fighterRegistry, roster, index barrel, visualScale, handAnchors, palettes, fighterMovementProfiles, movesetAnimationDriver/Cues, groundedNormalDriver, defensiveAnimationState, spriteAnimationDriver (switch cases), authorableCharacterRegistry, characterFactory, manifest (ASSET_KEYS, sheet arrays), CharacterEditorScene, Mode/StageSelect default P2 -> pikachu; `ACTIVE_FIGHTER_IDS` += link; `LinkRuntimeRevision` = `'ultimate-rebuild-v1'` only | 1,199 -> after source fixes: 0 new non-test errors (rest are test files) |
| 5 palette pipeline | deleted scripts/palette-swap*, scripts/validate-character-data.ts, assets/palettes, assets/generated, data/characters; removed prebuild/build:palettes/palette-swap/validate:characters from package.json; removed PALETTE_VARIANT_* / paletteVariant* / findPaletteVariantEntry from manifest.ts. Runtime palettes (DK/Pikachu/Link) kept | included above |
| 6 mask | `ACTIVE_FIGHTER_IDS` set to link/donkeykong/pikachu only; `MASKED_FIGHTER_TEST_EXCLUDES` NOT removed (not part of this trial) | n/a |
| 7 persistence | serializer rejects Link spec with revision `legacy`/absent ("Link specs saved before the ultimate rebuild ... no longer supported"); ReplayFile rejects unknown `characterId` and `linkRuntimeRevision:'legacy'` with named errors; removed `'legacy'` fallbacks in characterStorage, characterSnapshot, MatchStart; replayMigrations v7->v8 still stamps `'legacy'` on link slots so the parser rejects it with the clear message | n/a |
| tests | ~110 test files fixed (see below) | 59 -> final 59 |

Final tsc: **59 errors, identical set to baseline** (compared ignoring line numbers; 0 new, 0 fixed). Remaining are the other AI's Link/FinalSmash/MatchScene typing errors.

## Couplings the inventory missed

1. `scripts/buildIdentity.ts` does `visit('data/characters')`; once the directory is deleted `readdirSync` throws ENOENT and **vite.config.ts fails to load (build and vitest both)**. Remove that line in the same batch. `scripts/buildIdentity.test.ts` writes a `data/characters/wolf.json` fixture (1 test now fails; retarget it to `assets/characters/...`).
2. The `legacy-link-arrow` projectile renderer is **not legacy-only**: MatchScene picks it for any move id starting with `link`, so fresh Link's bow arrow (`link.neutral_special`) uses it. I renamed the kind to `link-arrow` (MatchScene + `ordinaryProjectileCheckpoint.ts`) instead of deleting it. Dropping owl/nova kinds is safe. Checkpoints carrying the old kind string fail to parse.
3. Seven test files import `data/characters/wolf.json` as the Lab/replay fixture (characterEditorFields, characterEditState, menuJourneys, characterTuneSelection, CharacterLabSession, ReplayCharacterSnapshot, characterFactory) plus `tauntTransport.test.ts` reads it by path. I replaced them with `serializeCharacterDataSpec(getAuthorableCharacterSpec('donkeykong'))`.
4. `characterSerializer.test.ts` loads every `data/characters/<id>.json`; the "data files kept honest" block was deleted.
5. Test-only tables silently become empty after removing rows (`it.each([ ])`, `ALL_CHARACTERS`, `ALL_SMASHES`, `CHARACTER_AERIALS`): they pass vacuously. I refilled 6 of them by hand; grep for `\[\n\s*\]` after any scripted edit.
6. Exported `LINK_PLACEHOLDER`/`PIKACHU_*` gaps: Pikachu has no `PIKACHU_PLACEHOLDER`/`PIKACHU_MOVES` export from roster.ts (use `PIKACHU_SPEC.placeholder`, `Pikachu.ts`).
7. `nativeShieldTraction.ts` table: kept `wolf-ssbu`, `pyra`, `mythra` because `shieldPushback.test.ts` asserts them for DK/Link (donor identities); only kirby/jigglypuff/marth removed.
8. Select/Lab portrait: `CharacterSelectScene`/`CharacterEditorScene` already drive Link through `linkUiReferencePose()` (`char.link.<sheet>`); the `char.link_legacy.idle` branch just deletes. Fallback key is `ASSET_KEYS.charLinkIdle` (`char.link.idle`, loaded). `isFreshLinkUiSpec` is now equivalent to `id==='link'`; can be simplified.
9. `registerAllCharacterSpriteAnimations` special-cased `registerLegacyLinkSpriteAnimations`; also removed.
10. `tools/replay-probe.mjs` defaults to the deleted `tools/user-replay.json`.
11. Blind id mapping in tests (`'wolf'`->`'donkeykong'` etc.) produced semantically bogus code (duplicate `if (characterId === 'pikachu')` branches, `{id:'pikachu', exports: Kirby}`, ids lists with repeated entries). It compiles; it needs a human pass. Tests with per-fighter expectations (busy-frame tables, `'wolf.jab'` ids, palette/placeholder equality) were mostly deleted rather than retargeted.
12. Sandbox note: scratch copy lacks `docs/`, so ~8 suites that read `docs/review/**` JSON fail to load in both baseline and after.

## Final comparison

- tsc: 59 -> 59, same errors.
- `vite build`: succeeds (4m13s; only the chunk-size warning).
- vitest: before 12,123 tests / 202 failed / 52 suites unloadable; after 10,974 tests (ran) / 708 failed / 58 suites unloadable.
  - 1,536 baseline tests no longer exist (tests of removed fighters, deleted palette-pipeline tests (66), and wolf/cat/owl/bear-keyed blocks cut from roster tests: groundedNormalDriver 301, perFighterSmoke 170, characterSpec 112, Roster 108, aerialSchema 91, smashChargeRoster 91, characterSerializer 90 (unloadable now), up/down/specialSchema 144, animationState 53, palettes 43, ...).
  - 0 baseline failures became passes.
  - 519 newly failing; breakdown:
    - **272 are `Link.*` suites that now run because `link` joined ACTIVE_FIGHTER_IDS** (Link.fairBairLaunch 34, jabLaunch 33, upSmashLaunch 26, specialReference 23, normals 22, forwardSmash 21, ...). This is the Link work in flux, not step 4. They need the other AI/owner.
    - 6 more suites newly unloadable, all through the same Link `autoCancelWindows endFrame null` error: characterSerializer, characterEditState, tauntTransport, ReplayCharacterSnapshot, Link.bow, Link.groundSpin. Their results (and everything else behind that error: ~47 suites) are **unobservable until Link parses**. A scratch hack (`endFrame:99999` for the open-ended window in `linkFreshNormals.ts`) did not unblock them, so there is at least a second Link problem.
    - ~150 `Character.test.ts`, plus aerialSchema 13, combatSfx 12, RebindingMixedInputIntegration 11, defensiveAnimationState 10, smashChargeRoster 9, Fighter.test 8, Roster 6, Character.landing/physics etc.: caused by my blind fixture swap (wolf->DK/Pikachu changes mass/jump/animation timings and `'wolf.x'` ids). Not attributable to the product; need hand retargeting (group C of the inventory is larger than listed: Character.test.ts, combatSfx, Fighter.test, defensiveAnimationState, Rebinding integration).
    - 1 `scripts/buildIdentity.test.ts` (coupling 1), 1 characterStorage, 1 shieldPushback, 2 Pikachu.footstool (DK stand-in recipient).
- Files: 24 src files + `src/characters/*.before-hitbox-scale` deleted (11 fighters 10,968 lines, 7 own tests 1,688, LegacyLink 779, extendedMoves 250, wolfPup 70, 4 backups 3,722); scripts/palette-swap* + validate script (~3.7k lines); data/characters 10 JSON; assets/characters/{11 ids + link_legacy} ~17 MB in the copy; assets/palettes + assets/generated 0.8 MB; tools: 7 probes + user-replay.json. Net src patch: -29,539 / +1,183.

## Not resolved

- Whether the roster-order/behaviour of tests blocked by the Link parse error is correct (unobservable).
- `scripts/buildIdentity.test.ts`, the test-fixture retargeting quality, restore of `assets/sprites/characters` in the repo (see incident).
- Browser/preview probe not run (no runtime verification; the scratch copy has no `npm run preview` stage).
- Docs/README/CLAUDE.md updates, `MASKED_FIGHTER_TEST_EXCLUDES` removal and the 7 menu suites were not attempted.

## Recommended final order for the real gate

0. Wait for (or require) a Link that parses: the `autoCancelWindows endFrame null` error hides ~47 suites, including the registry tests step 4 depends on. Record baseline AFTER that.
1. Remove `visit('data/characters')` from `scripts/buildIdentity.ts` (and retarget its test) before deleting `data/`.
2. Decouple: Pikachu WOLF_GRAB inline; Fighter.ts void imports; previews/tests/tools off wolf. Keep tsc green.
3. Test fixtures by hand: replace the 7 `wolf.json` imports; rewrite roster/palette/schema tests for 3 fighters; retarget Character.test.ts, combatSfx, Fighter.test, defensiveAnimationState, Rebinding integration to DK/Pikachu with correct expectations. Prefer per-test review over id sed.
4. One atomic commit for: CHARACTER_IDS narrowing, all Record maps/arrays/switch cases, manifest keys/sheets, deletion of fighter files, LegacyLink, palette pipeline, `data/characters`, validate script. (The union narrowing cannot be split usefully; 7-then-4 gives no checkpoint worth the double edit.)
5. Rename `legacy-link-arrow` -> `link-arrow` (do not delete the renderer).
6. Persistence rejection (serializer, ReplayFile character-id check and legacy-Link message), remove `'legacy'` from `LinkRuntimeRevision`.
7. Delete untracked art and tools; update/retire `tools/replay-probe.mjs` fixture; then drop `MASKED_FIGHTER_TEST_EXCLUDES` and the 7 menu suites' exclusions.
8. Full ritual: typecheck, vitest (compare with the post-Link baseline), `npm run build`, then a preview probe (select grid shows 3 cells, Lab lists 3, DK/Pikachu/Link match incl. bow arrow visible, replay save + load, old wolf/legacy-Link replay rejected with message).
9. Never use `rm -rf` on paths inside a symlinked directory in any scratch copy.
