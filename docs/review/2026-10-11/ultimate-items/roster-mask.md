# Roster mask (temporary): only Donkey Kong and Pikachu

Nothing deleted. `CHARACTER_IDS` and all registries are intact.

## Where
- `src/characters/activeFighters.ts`: `ACTIVE_FIGHTER_IDS = ['donkeykong','pikachu']`, `FALLBACK_FIGHTER_ID`, `isActiveFighter`, `toActiveFighterId`, `maskPlayerSlots`.
- `src/scenes/characterSelect.ts`: `SELECTABLE_CHARACTER_SPECS` filtered (grid, cursor, default picks, hand cursor all derive from it); fallback id is DK.
- `src/scenes/handCursorState.ts`, `src/scenes/lobby.ts`: default/fallback ids from the active list.
- `src/scenes/MatchScene.ts` `resolveActiveMatchConfig`: `maskPlayerSlots` rewrites masked ids in any incoming config (saved/last match, rematch, replay); dev-default match is DK vs Pikachu.
- `src/scenes/ModeSelectScene.ts`, `StageSelectScene.ts`: default P1 is DK.
- `src/scenes/CharacterEditorScene.ts`: Lab lists/defaults only active fighters; test-fight opponent is DK/Pikachu.
- `vite.config.ts`: `test.exclude` (see below).
- `tools/roster-mask-probe.mjs`: preview probe (select screenshot `roster-mask-select.png`; a config naming wolf/link resolved to donkeykong/pikachu).

## Undo
Set `ACTIVE_FIGHTER_IDS` to `[...CHARACTER_IDS]` (restores grid, Lab, config masking), and delete the `MASKED_FIGHTER_TEST_EXCLUDES` block plus the `test` key in `vite.config.ts`. Dev-default players in MatchScene/ModeSelect/StageSelect were wolf/cat (wolf for the two menus).

## Test excludes (vite.config.ts)
- `src/characters/<Id>{,.*}.test.ts` for every masked id (Link*, Aegis, Blaze, Bruno, Kirby, Nova, Puff, Volt; Wolf/Cat/Owl/Bear have none), `referenceAutolink.test.ts` (builds Link).
- Menu suites that hardcode the full roster (fail under the mask): characterSelect, handCursorState, menuJourneys, characterTuneSelection, CharacterLabSession, CharacterSelectMouseOwnership, LobbyScene (all `src/scenes/*.test.ts`). Coverage of menu logic is reduced until they are updated.
- `.tmp/**` (scratch copies of src/ with ~tens of thousands of tests; the old default run took ~55 min) and `docs/**` (archived src backups that fail on import).

## Baseline after masking (`npx vitest run`, ~5.5 min)
484 files, 12396 tests: 13 failed (+6 docs backup files that failed to import, now excluded).
Remaining: Camera snap; Link air drift (Character.landing.physics, a Link case in a shared file); Pikachu Roster x2 (jab, up-tilt); characterJabSerializer Link x2; characterReferenceKnockbackSerializer; characterReferenceLaunchSerializer; PlayerControlsPanel x3; RebindingScreen; Character.test.ts held-item forward smash (items work in progress).
Gone because masked: referenceAutolink. Still failing, pre-existing, not touched: all above.
Typecheck and build are green (typecheck had transient errors in src/items from concurrent work).

## Update 2026-10-14 (port step 4)
The masked fighters other than Link are deleted (`CHARACTER_IDS` = link, donkeykong, pikachu). The mask now only hides Link until its art is installed. The 7 menu suites were updated to the 2-active-fighter grid and removed from the vite exclude list; the `src/characters/Link{,.*}.test.ts` and `referenceAutolink.test.ts` excludes stay while Link is masked.
