# Reusable input profiles and Controls capture

The Controls selector chooses a named binding profile. It does not assign a controller. The active player's physical input is shown separately; CPU and unused columns identify themselves as profile editors.

- **New** copies the current controls into an automatically named profile. It works with a controller alone.
- **Rename** opens a text prompt. Names are limited to 28 characters; the full name fits the selector. Conflicting drafts must be repaired before Rename, so naming a profile cannot discard that draft.
- **Confirm** saves and stays on the screen. It reports success, conflicting actions, or a storage failure. Valid captures also save automatically. Built-in defaults remain available; editing them creates a custom profile.
- Profiles can be reused by another player using that input family. Choosing a profile preserves physical controller ownership. A shared custom profile retains its identity when edited.

Existing custom bindings remain available as `Imported Pn Keyboard` or `Imported Pn Gamepad` profiles. Players without an explicit named selection start with defaults for their actual joined input. A stale controller binding in an older keyboard player's settings therefore cannot change that player's device.

Capture handles controller A before a simultaneous direction, so A + Left activates the current row. The activation inputs must be released before a fresh input binds. D-pad and stick capture consume menu navigation, including a stick held at 0.6 after capture. Pointer activation synchronizes controller focus to the selected row or footer control. B remains assignable; Esc, Start, or the explicit Cancel Capture control cancels.

Focused unit and scene evidence is in [controls-focused-tests.txt](controls-focused-tests.txt). Scene regressions use the real menu poller, screen, profile session, and bindings store. They cover P1 CPU, P2 arrow keys, and a single controller assigned to P3.

Both MainMenu entry paths explicitly start Controls with an empty player context. Phaser otherwise retains the previous visit's scene payload, which could incorrectly show a past match's assignments in the profile library. The shortcut and menu-card lifecycle regressions verify this reset and return to MainMenu without waking the old match.

The browser probe is [input-profiles-acceptance.mjs](../../../../tools/input-profiles-acceptance.mjs). It uses one synthetic controller and real menu input, clicks, captures, profile operations, restart, and rematch. Only the password gate is bypassed. The Results fixture moves the second fighter outside the blast zone and lets the normal stock/rules path finish the match. A temporary storage exception verifies failed-save feedback and retry.

Final production acceptance passed **15/15 checks** on `index-DU0SLTOZ.js`, with **zero page errors**. [results.json](production/results.json) records the actual one-controller P1 CPU / P2 arrows / P3 controller match, reuse of P3's saved profile on P1 without changing device ownership, D-pad and axis capture, visible save/conflict/failure feedback, and retention through resume, restart, and rematch. MainMenu library editing returns an empty player-assignment snapshot.

All three 1280×720 screenshots were visually inspected: [named profiles](production/named-profiles-controls.png), [midmatch save](production/midmatch-profile-save.png), and [MainMenu library](production/main-menu-profile-library.png). Full profile names fit their panels; active input, CPU/preset status, focused Confirm, and save results are visible.

Historical evidence remains separate: the initial debug run passed 11 checks on `index-CZKxkpND.js`; [pre-library-context-fix/results.json](pre-library-context-fix/results.json) records the later 14 passing checks and retained-context failure on `index-CMdyErDR.js`. The final production run supersedes both.
