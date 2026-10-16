# Sparse player ownership and preview-to-match checks

This is the focused scene/input evidence for the [playtest repair](../playtest-input-repair/README.md). The reported lineup was P1 empty or CPU, P2 on arrow keys, and P3 using one controller. The user also reported a skin differing between its selection preview and the match.

## Runtime corrections

- Named binding profiles are selected separately from the device that joined a player. Match projection prefers the selected profile of the matching device family and pins generic gamepad bindings to that player's physical controller only in the match-local copy. New arrow-key joins select the arrow default even when legacy numbered bindings had previously been retargeted to a controller.
- Roster, Controls return, stage return, match wake and match launch preserve the profile ID and original player slot. Rendering metadata retains original P2/P3 identity when the active fighter array is compacted because P1 is empty.
- Mouse clicks on explicit card controls cannot reposition or repick through a controller-owned hand. The old artifact reproduced that cursor snap.
- Phaser's `stopListeners` and `disconnectAll` assume dense controller arrays. The bounded application shim supplies a dense view only during those synchronous cleanup methods, then restores the original array in `finally`; physical indices stay unchanged for polling and assignment. A single controller at physical index 1 previously crashed before the menus.
- Roster confirmation now skips absent controller entries explicitly. Its former `candidate?.index === padIndex && candidate.connected !== false` expression could compare two `undefined` values for a keyboard/CPU slot and then dereference a missing controller. The expanded browser journey exposed this second sparse-array crash after the cleanup shim was in place.

## Checks

The [19 focused menu journey tests](menu-journeys-tests.txt) include actual `CharacterSelectScene.handleConfirm` calls with an array hole at index 0, one controller at index 1, P2 arrows/P3 gamepad, and P1 separately empty or CPU. They check stage handoff, original slot/palette identity and projected controller bindings. Both new cases would throw in the old confirmation callback.

Additional focused coverage includes seven tests of the actual Phaser cleanup methods, seven named-profile projection tests, and three controller-owned mouse-hand tests. The cleanup tests cover indices 1 and 5, sparse array restoration, explicit null/undefined entries and exceptions. Profile tests cover stale legacy mappings, shared generic controller profiles, missing/wrong-family profile fallback and intentionally unbound profiles. The broader build and suite evidence is recorded in the parent review.

The production probe is [tools/sparse-player-ownership.mjs](../../../../tools/sparse-player-ownership.mjs). Its six cases are:

1. P1 empty, P2 arrows, P3 controller index 0.
2. P1 CPU, P2 arrows, P3 controller index 0.
3. P1 empty, P2 arrows, P3 controller index 1.
4. P1 CPU, P2 arrows, P3 controller index 1.
5. A mouse palette click while a controller-owned hand is focused.
6. A nondefault Wolf palette from preview to an exact matching idle texture in the match.

The four sparse-lineup journeys select two Link colours, visit Controls, return from stage selection, move both fighters through real keyboard/browser-Gamepad inputs, restart through the pause menu and rematch through Results. They assert resolved input isolation and actual fighter displacement, as well as matching palette tints on all four sprite corners, pipeline data and character/skin atlas family against each original player's preview. Screenshots retain the visible preview, match, restart and rematch. The Wolf case also requires the same exact idle texture.

The harness bypasses only the password gate. Movement is released after 24 pixels of actual travel, with an 18-active-physics-step maximum, using a DOM keyboard release or neutral browser gamepad axes. A physics observer records the held-input snapshot before releasing it; it does not change fighter state. The assertions still require real displacement greater than five pixels and correct input isolation, additionally bound travel below 80 pixels and verify both humans remain alive before pausing. Results setup moves opponents beyond the blast zone; normal stock/KO/Results handling then finishes the match. The probe does not override fighter input, inject lineup configuration or directly call restart/rematch methods. Browser controller input is synthetic, so this does not certify every hardware/controller mapping.

Final production result: **6/6 cases passed, zero page errors**, on `index-DU0SLTOZ.js`. The [final JSON](sparse-production/results.json) records the exact artifact and each snapshot. Representative paired screenshots are the [P1-CPU, pad-index-1 selection](sparse-production/P1-cpu-P2-keyboard-P3-pad1-selection.png), [match](sparse-production/P1-cpu-P2-keyboard-P3-pad1.png), [restart](sparse-production/P1-cpu-P2-keyboard-P3-pad1-restart.png) and [rematch](sparse-production/P1-cpu-P2-keyboard-P3-pad1-rematch.png), plus the [Wolf preview](sparse-production/nondefault-Wolf-preview-to-idle-match-selection.png) and [matching idle fighter](sparse-production/nondefault-Wolf-preview-to-idle-match.png). The visible pairs were inspected as well as their renderer metadata. Failure images remain in the archived runs, not the final output directory.

## Preserved failures and limits

- [Original baseline](sparse-before/results.json), `index-Cfka7DlF.js`: the mouse hand snap reproduced. Clean default P2/P3 input routing already worked; one CPU-case velocity assertion was an inadequate harness check and was replaced by actual displacement plus resolved-input isolation.
- [First expanded run](sparse-production-initial/results.json), `index-CZKxkpND.js`: a real Phaser cleanup crash with physical controller index 1; separate harness comparisons incorrectly treated normal idle/run texture changes as skin changes.
- [Before the roster guard](sparse-production-before-roster-guard/results.json), `index-Bd4RIwa5.js`: four of six cases passed, with both index-1 cases exposing the roster confirmation null dereference.
- [Before the landing-animation harness correction](sparse-production-before-animation-harness-fix/results.json), `index-CMdyErDR.js`: five of six passed. The remaining comparison omitted `char.link.crouch`, which the normal landing state deliberately uses. The corrected comparison strips only known motion-sheet names and preserves any palette suffix; runtime code did not change.
- [Passing intermediate run](sparse-production-before-mainmenu-init-fix/results.json), `index-CMdyErDR.js`: six of six passed with zero page errors. The artifact was subsequently replaced for an independently found Main Menu Controls context bug.
- [Before bounded movement](sparse-production-before-movement-harness-fix/results.json), `index-DU0SLTOZ.js`: five of six passed with zero page errors. While the full suite competed for resources, holding left for eight render frames advanced enough simulation steps for P2 to walk off the platform before the pause check; Escape then left Results for the main menu. The final probe replaces that wall-clock-sensitive hold with the bounded movement above. No game code changed for this harness correction.

The original reported preview/match skin mismatch has **not been reproduced**. Link's blue/red accents visibly match the selected card previews in the tested journeys, and Wolf's nondefault palette matches its preview. The renderer uses the same tint fallback for these tested previews and fighters; it is not a claim that every costume has a dedicated recoloured atlas. The exact fighter/colour/sequence from the user's mismatch remains unknown. This evidence must not be described as proving that separate report fixed.
