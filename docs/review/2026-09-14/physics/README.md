# Browser movement and presentation review

This review uses actual Phaser sprites, the MatchScene input resolver, real Matter integration, and one manually advanced 60 Hz simulation step per input. Physics scenarios provide canonical action values through the resolver; menu journeys use actual browser keyboard events. Chromium runs with isolated storage and software WebGL. It does not substitute for human combat feel, sound, or physical-controller testing.

Run `tools/physics-sep14-acceptance.mjs` against the local production preview. `PF_REWORK_URL` and `PF_REWORK_OUTPUT` select a different server and evidence directory. `PF_OBSERVE_ONLY=1` records the same scenarios without requiring the new gameplay outcomes, for before/after observations.

## Before this pass

The September 10 production artifact `index-N1cjduoM.js` is identified in `before/physics-sep14.json`:

- Link's air jump rose 139 px, equal to his grounded full hop.
- Four steps of backwards airborne drift turned Link around. Attacking into that drift then selected forward air.
- Natural full-hop and tiny-drop landings had no ordinary landing commitment or landing pose.
- A reset from above a floating platform to the solid floor underneath incorrectly counted as a falling crossing. The next step snapped the fighter upward by about 166 px, followed by repeated hovering without grounded contact. The full failing trajectory is preserved in `before/reset-platform-history.json`.

## Platform-history fix

Character exposes a monotonically increasing position-reset generation. The MatchScene platform driver clears only that fighter's previous feet sample and landing grace after a teleport. Ordinary integration retains its collision history. Landing assists also commit the corrected feet position, so a subsequent step starts from the resolved surface.

The reusable browser regression resets underneath a floating platform and checks every following position stays at the intended floor. A separate natural drop onto the float checks that the correction preserves normal platform landings.

## Presentation observations

The existing simulation animation driver already consumes the public landing recovery counter. Ordinary landing now visibly crouches Link for that commitment and changes to jumpsquat when the buffered jump becomes actionable. The change needs no independent animation timer or new artwork.

The controls screen visibly separates keyboard P1, keyboard P2, and the two gamepad profiles. The main menu and Character Lab remain readable at a 1280×720 browser viewport. All five new movement fields are visible on the second movement page; the longest landing label fits before its numeric value. The Lab footer now advertises `PGUP/PGDN PAGE`, making the second page discoverable. Its measured horizontal bounds are 1088.5–1701.5 inside the 947.5–1842.5 panel. Screenshots and numeric label bounds accompany the JSON evidence.

Default keyboard Up and Jump share W for P1 and Up Arrow for P2. The existing tap-jump arbitration intentionally allows an upward attack to take precedence, so its takeoff timing differs from the dedicated neutral jump action used in the physics measurements. Testing that input tradeoff with a human player, including a separately rebound jump button, remains useful.

## Development verification

The complete strict harness passed against development source in `development/physics-sep14.json`, with zero browser errors. It verifies the 145 px air jump, backwards drift selecting back air, five/two-step ordinary landing, earliest buffered jump/jab/shield, stable normal float landings, reset under a float, and the single remaining air jump after walking off while declining a ledge catch. Keyboard journeys open Controls, return to Main Menu, open Character Lab, and navigate to the new movement fields.

## Final production verification

The same strict harness passed against `index-DaTd3UWA.js` on 14 September 2026, with `observeOnly: false` and zero browser errors. [Production observations](production/physics-sep14.json) contain all frame traces, the loaded artifact, and UI bounds.

- Air jump: 145 px, immediate impulse, and exactly one airborne jump available after leaving a ledge without grabbing it.
- Backwards airborne drift preserves facing and selects back air when attacking into that drift.
- Hard landing: recovery counters 5/4/3/2/1, then the buffered jump starts jumpsquat on the first actionable step. Jab and shield also start on their first actionable step.
- Soft landing: counters 2/1/0. The landing pose appears only while recovery remains.
- Reset underneath the float stays on the intended ground throughout all 20 following steps. A separate natural falling approach remains grounded on the float for the final ten observations.
- Actual keyboard menu navigation and the new movement-page label checks pass. [Landing pose](production/ordinary-landing.png), [Controls](production/controls.png), and [movement fields](production/landing-movement-fields.png) were also visually inspected.

An initial attempt to start production verification failed before Node launched because WSL had insufficient memory during concurrent verification. WSL subsequently restarted during its automatic upgrade. The completed production run above was performed sequentially after the other checks released resources; the interruption produced no gameplay result.

Remaining aesthetic limits are the small number of existing fighter poses, muted secondary help text, and the absence of a short mechanics guide explaining full/short hop, fast fall, and directional attack selection. The current pass checks presentation against simulation state; it does not claim a balance playtest or exact Ultimate parity.
