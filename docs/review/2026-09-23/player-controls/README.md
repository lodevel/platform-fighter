# Per-player Controls during character selection

Status: implemented and verified on **`index-DH_JqEPY.js`**. The complete suite passes **375 files / 11,304 tests**; TypeScript/build and all **13 production browser checks** pass, with zero page errors. The local preview is running at <http://127.0.0.1:4173/platform-fighter/>.

## Approved product direction

The user approved editing controls locally within character selection while the roster and other players remain available. A player owns their Controls panel through the input device they used to join. This replaces the character-selection detour to a global four-column editor with up to four independent player editors. It does not add a device reassignment selector or a numbered gamepad selector.

The existing standalone profile library reached from MainMenu or Pause remains available and is unchanged by this milestone. The previous [connected-controller refactor](../controller-boundary/README.md), verified on `index-CiXJE12M.js`, is the historical starting point.

## Player flow and input ownership

- Joining with a controller claims a player slot. That controller opens its player's editor with **X** or its own card's **Controls** action. Mouse interaction opens and operates keyboard-player editors; it does not edit a controller-owned player's bindings.
- Each editor shows its player identity, selected named profile, bindings, **Reset bindings**, **Save as copy**, **Done · Save**, and **Cancel · Discard**. Profiles are reusable mappings within their input family. Choosing one never transfers the controller or keyboard ownership used to join.
- Other controllers can keep selecting fighters or operate their own editors. Keyboard capture consumes keyboard input while it is active; other controllers continue working. Match start waits until every open editor has closed.
- Opening and capture inputs must be released before another input can bind or navigate. Capture consumes both D-pad and analog movement. Residual stick travel above the menu threshold remains blocked until neutral, preventing a completed binding from moving the menu.
- **B is assignable during capture. Start cancels controller capture; Escape cancels keyboard capture.** Cancelling capture first returns to the same editor. A held cancellation or binding input cannot immediately close the editor or activate another row.
- **Done** validates and saves, then closes only that player's editor. **Cancel** discards that session's unsaved draft. Conflicts and storage failures leave the editor and draft open with feedback.
- Current disconnect policy: losing an editor's controller discards that player's unsaved draft and closes its editor while character selection continues. This is a temporary explicit policy; unsaved edits are not restored automatically on reconnect.

## Drafts and reusable profiles

`PlayerControlsSession` owns an isolated binding draft at the original player slot. Physical controller indices are checked at capture and save, so another controller or an any-controller binding cannot enter that draft. Saved gamepad profiles contain mappings with a neutral controller index; opening a profile binds its draft to the current owner's physical controller.

Editing a profile used by another player creates a persistent copy when saved, leaving the shared original and sibling drafts intact. Changing an immutable built-in also creates a custom profile. An ordinary edit to an unshared custom profile retains its identity. **Save as copy** explicitly creates another profile, including when the mapping is unchanged; it remains in the editor afterward. The existing library can rename saved profiles.

Selecting an unchanged existing profile succeeds without a storage write, including when browser storage is unavailable. A failed write preserves the draft and prior selected profile. Reset restores the selected profile's base defaults in the draft; saving or cancelling determines whether those changes persist. Untouched actions retain their multi-bindings.

## Verification

The clean [complete suite](full-tests.txt) passes **375 files / 11,304 tests**, including all **36 new tests** across the session, input controller, panel and scene integration. It checks foreign-input rejection, isolated drafts, offline profile selection, shared copies, storage failure, conflicts between keyboard players, two-keyboard capture exclusion, capture/release barriers, disconnect cleanup and saved match ownership. Existing menu journeys, sparse Phaser cleanup and mouse/controller isolation also pass. Command: `node node_modules/vitest/vitest.mjs run --minWorkers=1 --maxWorkers=4`.

TypeScript and the [production build](build.txt) pass. All **280 runtime source-map entries** match the workspace ([artifact verification](artifact-verification.json)); whitespace checks pass. The final artifact is **`index-DH_JqEPY.js`**.

The [production browser probe](production/results.json) passes **13/13 checks** with **zero page errors** on the same artifact. It uses real DOM keyboard/mouse events and synthetic standard controllers at sparse browser indices **1 and 5**, with P1 a CPU and P2 on the arrow keyboard. Only the password gate is bypassed. Coverage includes:

- A controller joining and choosing while P2 captures a key, and three independent editors open together.
- Mouse and foreign-controller exclusion from controller-owned bindings; A opens the owner's card action.
- Binding Left or B without moving the cursor, changing menu focus or removing the player; Start cancels capture without starting a match.
- Saving a shared profile as a separate copy, preserving the other player's draft and stored original; Cancel discards unsaved keyboard edits.
- Profiles and physical device ownership reaching the match, with P2, P3 and P4 each moving only through their own input device.

The browser ran after the test/build processes exited. Inspected screenshots: [three editors](production/three-independent-editors.png), [keyboard and controller editors](production/concurrent-keyboard-and-controller-editors.png), and [match handoff](production/sparse-four-player-match.png). The earlier global-menu browser probes remain historical because character selection no longer takes that route; unchanged MainMenu/Pause paths retain their unit regression coverage.

The reported preview-to-match skin discrepancy remains **unreproduced and unchanged** by this milestone. Previous tested colours and controller journeys are documented in the linked historical handoffs; they do not establish reproduction or resolution of that report. Synthetic-controller checks also do not replace physical-controller playtesting.
