# Controller ownership, B capture, and rematch palettes

Historical record: the subsequent [playtest repair](../playtest-input-repair/README.md) replaces this device selector with reusable named binding profiles, as requested by the user. Its sparse-player and controller checks also address gaps exposed after this pass. Use that handoff for current behavior and verification; the measurements below describe the earlier artifacts.

The [production browser harness](../../../../tools/controller-session-regressions.mjs) injects two standard gamepads with stable physical indices into `navigator.getGamepads`. It uses keyboard, pointer, and gamepad input through the actual menus. It bypasses only the password gate. For the Results path it places the second fighter outside the blast zone and lets the normal stock/rules flow finish the match; it does not call restart, rematch, assignment, or capture callbacks directly.

The old artifact `index-DN4pX3Za.js` reproduces the reports:

- B during capture cancels and a held B leaves Controls. [Initial measurements](before/results.json) and [log](baseline.txt).
- Selecting Controller 2 for Player 1 and Controller 1 for Player 2 changes the chips but leaves both match participants on keyboard devices, including after restart and rematch. Same initial measurements and log.
- Blue and red Link sprites initially have four matching tint corners. New sprites after pause Restart and Results Rematch retain palette metadata but have white `0xffffff` corners. The [dedicated palette baseline](palette-before/results.json) and [corrected assertion log](palette-baseline.txt) verify the rendered failure. The first broader probe used an incorrect metadata path in its final palette assertion; this dedicated run corrects that path without changing the observed white sprites.

The final harness covers physical join order, real device reassignment from both the roster and a paused match, a captured B Special binding surviving Controls reentry and starting Link's bow, and rendered palette preservation across both scene recreations. It records sprite object identity, texture, pipeline, pipeline data, all four tint corners, and palette metadata. It selects noncanonical palettes 1 (blue `0x2b7ad9`) and 2 (red `0xc23a3a`); canonical green legitimately uses untinted source art.

The fixes make device selection update ownership and bindings together. Opening Controls projects each active fighter's profile into its numbered player column. Selecting an occupied device exchanges assignments; switching controllers preserves custom buttons. Returning updates roster state or the sleeping match, including restart/rematch launch data. Reset updates profiles and ownership together. CPU and unused columns are labelled separately.

B is available for capture; Esc, Start or Cancel abort it. Captured inputs must return to neutral before menu navigation resumes. Match creation clears the palette renderer's application cache before constructing replacement sprites.

TypeScript and the production [build](build.txt) pass on `index-Cfka7DlF.js`. All **273** runtime source-map entries match the current source ([artifact check](artifact-verification.json)). The [four production journeys](production/results.json) pass with zero browser errors. The final [conflict-free B capture check](production-capture/results.json) also verifies the saved localStorage snapshot: Special is B and Dodge is Y. This replaces the earlier B scenario's overlapping default Dodge binding. It confirms persistence, Controls reentry and actual bow charging by the intended fighter. Controls and rematch screenshots were visually inspected for readable labels and preserved colours.

The clean [full aggregate suite](full-tests.txt) passes **363 files / 11,204 tests**. Focused evidence includes [Controls and capture](controls-focused-tests.txt), [roster and runtime input](root-focused-tests.txt), and the additional menu/session regressions included in the aggregate run. `git diff --check` passes. The preview returns HTTP 200 and serves the verified artifact. These checks exercise the browser Gamepad API and scene lifecycle; physical-controller playtesting remains useful.

Run with Node 20 and Playwright Chromium:

```sh
PF_CONTROLLER_EXPECT_ARTIFACT=index-Cfka7DlF.js node tools/controller-session-regressions.mjs
```

`PF_CONTROLLER_OUTPUT` selects an evidence directory; `PF_CONTROLLER_CASE` optionally selects one named case. `PF_CONTROLLER_URL` overrides the local preview URL.

Preview: <http://127.0.0.1:4173/platform-fighter/>. The previous combat implementation and its remaining mechanics gaps are documented in the [combined mechanics record](../../2026-09-22/combat-parity/README.md).
