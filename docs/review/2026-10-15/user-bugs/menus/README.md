# Character selection, controllers and controls repairs

The reported failures were reproduced in the served `game-BYOl1XlT.js` build.
The repaired menu source passes the strengthened journey on the exact final
shared production candidate. The earlier isolated receipt is retained below as
historical evidence.

## Final production verification

[The latest report](final2/report.json) and four new screenshots repeat every
strengthened check on `game-B95Fcp5p.js`, identity
`platform-fighter-sha256-74c2fec99c76cdc7942171c69ff8c02f7c207d50263dffea93787a7d94040101`.
All checks pass: original three devices/profiles, palettes 5/6/2 through results,
real Q plus simulated LT Attack edges on only their owning players, two matches,
Y editors, pointer/analog/d-pad targeting, fresh meter On and intentional Off.
Largest analog frame displacement is 24.048 px; result frame is 243, stocks
[1,0,0]. Page errors and shell faults are empty. The earlier candidate's receipt
below is preserved and was not overwritten.

[Final report](final/report.json) and four screenshots qualify
`game-rdv3pg8d.js` on 4173, identity
`platform-fighter-sha256-b242558db2524371b13e21af73a9b1032a7f783d9ced183983d1bcb25b5a72f9`.
Keyboard/pad0/pad2 retain P1/P2/P3 through controller-driven stage-back,
ordinary results return and another match. P4 remains Off. Palettes 5/6/2 remain
unchanged after returning A. Pointer, analog and d-pad exact-colour selection
pass. Y saves separate pad/keyboard profiles, and real keyboard Q plus simulated
pad LT resolve new Attack edges on only their original match participants.
Default meter On and explicit Off retention pass. Largest observed stick step is
23.98 px, below the configured 36 px maximum for that stick vector/frame cap.
The actual result is frame 243, P1 winner, stocks [1,0,0]. There are zero page
errors and shell faults. The 480 px screenshot retains 26 px palette buttons.

These are simulated-gamepad and arranged boundary-KO checks in the real host;
physical controller feel remains user review.

## Reproduced failures

[The original browser report](before/report.json) records a keyboard player in
P1, pad0 in P2 and pad2 in P3, then finishes a real one-stock match through the
ordinary boundary-KO and results path. Returning to fighters restores only the
keyboard hand. Pad0's next A press joins P4; pad2 cannot reclaim its original
card. The selected P2/P3 fighters remain stranded on their old cards.

The same run records a 574.4 px cursor jump from a held analog stick, a colour5
pointer click remaining on colour0 because its button was replaced during the
gesture, Y opening no controls editor, and the fresh meter default being Off.
It has no page errors. `before/passed` means the reproduction ran successfully,
not that the old implementation met the repaired assertions.

## Changes

- Keep physical device-to-card ownership in the menu flow, separately from saved
  binding profiles. The match's current assignments and profile edits win when
  it reconnects a controller or returns to fighters. Identical-model pads retain
  distinct browser indices. Existing hand positions and chosen palettes survive.
- Label stick navigation separately from button navigation. Fighter select uses
  analog input for free movement and d-pad input for snapping, so a stick no
  longer performs both movements in one frame.
- Keep each palette button alive while hands move. Buttons are 26 px, wrap into
  two rows on smaller screens, and select the exact colour under the hand or
  pointer. Refresh the DOM hover before an activation so a stale palette target
  cannot cycle a colour after a screen/layout change.
- Y opens the owning human player's controls editor from anywhere in fighter
  select. A visible Controls button also opens it; Y over a CPU card changes its
  difficulty. Saved profiles remain reusable, and edits to shared profiles copy
  them rather than changing another player's layout.
- Constrain the controls modal's scrolling region so Save/Cancel remain
  reachable, scroll the focused row into view, and hide selection hands over the
  editor. Pointer binding capture is immediately ready on the title editor too.
- The rules screen consumes the shared new-match meter default, which the
  coordinator changed to On. An explicitly selected Off survives back/forward.

## Evidence and scope

[The isolated patched-browser receipt](after/report.json), built as
`game-Bn5tGPYe.js` / identity
`platform-fighter-sha256-63a0d0adb8491275a6278eea7342c739f231c465ffbe3bb481fe4395a0c91edf`,
passes the keyboard/pad0/pad2 journey through stage-back, a real results payload
and another match. Every device retains its card and saved profile; P4 remains
Off. Pointer colour5 and analog-pad colour6 work. The largest observed analog
frame movement is 12.02 px. Y saves separate custom pad and keyboard profiles.
The 480 px screenshot shows usable 26 px palettes. There are no page errors or
shell faults. The `after/failure.png` image retains the intermediate discovery
that the old controls modal clipped Save; that overflow was repaired before the
passing report.

Reviewing this receipt also caught a stale hover cycling colour6 to colour7
after results. A final one-line DOM-hover refresh fixes that path. The maintained
journey adds unchanged-palette assertions, d-pad palette targeting, more
controller-driven transitions and actual Q/LT Attack resolution in the live
match. Those stronger assertions pass in the final production receipt above;
they were not part of the earlier isolated receipt.

[Focused tests](focused-tests.txt): 52 cases pass across the new ownership/input
checks and the existing profile store, controls session and controls input
suites. [Strict typecheck and layer checks](typecheck.txt) pass. The coordinator
owns the combined full-suite/build gate. Physical controller feel and the user's
visual acceptance remain user review, as recorded in the
[plan audit](../PLAN-AUDIT.md).

Reproduce the maintained final journey under the shared heavy-job lock:

```sh
PF_MENU_EVIDENCE_SUBDIR=final flock .tmp/dk-heavy.lock node tools/menu-user-bugs.mjs
```

Set `PF_GAME_URL` to qualify a different exact static candidate. No project
commits, cleanup deletion or shared production rebuild were performed by this
menu repair task.
