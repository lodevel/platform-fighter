# Playtest input and item repair

Latest continuation: [connected-controller refactor](../controller-boundary/README.md), consolidating scene controller reads and handling missed disconnect events. Its record contains the current artifact and focused verification; the results below describe this milestone's baseline.

This follow-up supersedes the device-selector behavior introduced in the [earlier controller pass](../controller-session-regressions/README.md). The user wants reusable named input profiles, not a selector that transfers controller ownership.

Reported setup: P2 on arrow keys, P3 on the only connected controller, first with P1 empty and then with P1 as a CPU. The user reported P3 driving P2, P2 unable to move, a match skin differing from its preview, capture input also navigating, Confirm appearing to do nothing, and mouse clicks moving a controller's character-selection cursor. Bomb detonations should share an animation, and items should last at least twice as long.

## Changes

- Named profiles are stored independently of player slots and physical controller indices. Keyboard WASD, Keyboard Arrows and Standard Gamepad remain immutable defaults; editing a default saves a named copy. New and Rename manage reusable profiles, and Confirm shows saved/conflict/storage-error feedback. Existing custom bindings are preserved as selectable imported profiles.
- Profiles store generic controller mappings. A match pins them to the controller that actually joined that player. Selecting or editing a profile cannot transfer that controller to another fighter. Profile IDs survive roster return, paused Controls, match launch and replay configuration serialization.
- Controls opened from the main menu edits the profile library without changing a previous match's lineup. CPU and PRESET columns identify themselves as profile editors; active columns display their physical input separately from the selected profile name. Both the main-menu card and shortcut explicitly clear the old scene context, so leaving the library cannot wake an old match.
- Controls uses separate drafts instead of overwriting legacy player profiles on entry. Arrow-key defaults are selected from the physical keyboard assignment, even if older saved settings had turned that numbered profile into a gamepad mapping.
- Confirm/capture activation takes precedence over navigation in the same controller sample. Pointer capture focuses the selected row and column. A held input must return to neutral before it can navigate again.
- Character-selection clicks cannot reposition or pick through a hand owned by a controller. Explicit card controls remain usable with the mouse.
- Phaser's cleanup assumed controller indices were consecutive and crashed during scene transitions when the only connected controller had index 1. A narrow compatibility wrapper skips empty entries during cleanup while retaining the original physical indices for normal polling and player ownership.
- Roster confirmation also skips those empty controller entries. Previously, a keyboard/CPU slot's absent controller index matched an empty entry and the subsequent connection check crashed.
- Bomb detonation routes share the layered explosion renderer and use stable detonation identities to avoid repeated bursts during hitlag. Explosion damage, fuse, hitbox and attack timing are unchanged.
- Ground item lifetimes are doubled; thrown-item expiry is doubled from 90 to 180 simulation steps; Link's remote bomb object lifetime is doubled from 1,800 to 3,600 steps.

Existing custom controls appear as **Imported Pn Keyboard/Gamepad** profiles. They are available to select, but are not automatically assigned to newly joined players: old slot-based saves may contain the device reassignment that caused this report. To reuse a layout, choose its name above the bindings. Editing a built-in default creates a **My Keyboard/Gamepad** copy; use **Rename** to give it a personal name. **Confirm** reports whether that profile was saved or why it could not be saved.

## Verification

The final [complete suite](full-tests-verified.txt) passed **369 files / 11,254 tests**, including the roster-confirmation and main-menu scene-context corrections. Focused evidence includes [19 menu journey tests](../profile-ownership/menu-journeys-tests.txt) and the [Controls/lifecycle checks](../input-profiles/controls-focused-tests.txt).

The first aggregate had two failures: a structural assertion still expected hard-coded palette slot numbers, and an AI test exceeded five seconds while build/browser work competed for resources. The assertion now checks original player indices; the AI test passed unchanged in a serial rerun. The clean aggregate above uses a 15-second runner deadline and retains all assertions. [Focused follow-up evidence](aggregate-followup-tests.txt) records **106 passing tests**. The earlier [368-file passing run](full-tests-final.txt) predates the last four lifecycle cases; the final aggregate includes them all.

Final TypeScript and [production build](build-production.txt) pass on **`index-DU0SLTOZ.js`**. All **275 runtime source-map entries** match the workspace ([verification](artifact-verification.json)); whitespace checks pass, and the preview responds with HTTP 200 while serving that artifact.

All three production browser probes pass on that same artifact, with **zero page errors**:

- [Named profiles and Controls](../input-profiles/README.md): **15 checks**, including the reported P1-CPU/P2-arrows/P3-controller setup, capture/release, Confirm, conflict and storage-error feedback, profile reuse, main-menu library editing, restart and rematch. Final screenshots were inspected at 1280×720.
- [Sparse ownership and preview comparison](../profile-ownership/README.md): **6 journeys**, covering P1 empty/CPU with the single controller at physical index 0/1, mouse hand isolation, original slot/profile identity, and tested Link/Wolf colours through match/restart/rematch. The final harness measures bounded actual displacement; its earlier render-frame hold could run a fighter offstage under test-machine load, and that failed run is preserved separately.
- [Bomb effects and availability](../bomb-item-lifetime/README.md): **8 detonation causes**, each with one complete layered effect. Target damage, remote self-damage and existing trigger timing remain verified; thrown expiry alone moves by the requested extra 90 simulation steps. Focused tests verify every doubled item lifetime.

## Remaining skin report

Fresh/default browser checks did not reproduce the original P3-driving-P2 symptom. The final checks route P2 arrows and P3's controller correctly with P1 empty or CPU and controller indices 0 and 1; the expanded index-1 checks exposed the two concrete crashes fixed above. Automated tests also exercise stale saved bindings, named-profile reuse and actual fighter displacement.

The user clarified that the match colour differed from the character-selection preview. Tested Link and nondefault Wolf previews currently agree with their match sprites, including actual texture family, pipeline and all corner tints, with screenshots for visual comparison. The user's specific mismatch has **not been reproduced or claimed fixed**. The pending question is which fighters and colours were selected and what appeared in the match. Clean synthetic-controller checks are not physical-controller or broader visual acceptance.

Preview: <http://127.0.0.1:4173/platform-fighter/>.
