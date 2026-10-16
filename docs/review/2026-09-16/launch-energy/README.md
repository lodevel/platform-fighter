# Launch momentum and gravity through recovery

Continuation after the [reference-knockback milestone](../reference-knockback/README.md).
Link and DK now keep reference launch velocity separate from natural gravity
and player drift through the end of hitstun. Ordinary movement damping no longer
consumes the remaining launch. This applies when a reference strike reaches a
fighter with an authored launch profile; other paths keep their existing model.

## Reference parameters and integration

| Native game units | Link | Donkey Kong |
|---|---:|---:|
| Gravity | 0.096 | 0.085 |
| Fall speed | 1.6 | 1.63 |
| Vertical tumble gravity | 0.076944 | 0.084672 |
| Vertical tumble fall speed | 1.8 | 1.8 |

The calculator's [Link parameters](https://github.com/rubendal/SSBU-Calculator/blob/gh-pages/Data/link/data.json)
and [DK parameters](https://github.com/rubendal/SSBU-Calculator/blob/gh-pages/Data/donkey/data.json)
supply these values. Conversion remains five pixels per game unit. Profiles
survive save/load, factory construction and Lab edits, including six-decimal
gravity precision and undo/redo. Older saves inherit their fighter's profile;
the remaining roster has no authored profile yet.

The [launch implementation](https://github.com/rubendal/SSBU-Calculator/blob/master/js/knockback.js)
provides the gravity boost, vertical classification and free-flight integration:

- A tumbling launch outside the upward 70–110 degree range gains an upward
  boost of `5 * (gravity - 0.075)` game units before DI. That is 0.525 pixels
  for Link and 0.25 for DK. The boosted vector participates in launch decay.
- Vertical classification uses the pre-DI direction. Vertical tumble uses its
  own gravity and fall cap through the last locked step.
- Release moves by the initial launch with zero accumulated natural gravity.
  Later active steps advance gravity and decay; hitlag pauses both components.
- Natural gravity reaches its own cap even while upward launch opposes it.
  After vertical hitstun, excess gravity approaches the profile's ordinary cap by the
  ordinary gravity increment. Link's 9-pixel component becomes 8.52, 8.04, then
  8; DK's becomes 8.575, then 8.15.
- After hitstun, launch continues its 0.255-pixel decay while horizontal input
  controls separate drift. Wind and carried velocity remain distinct from
  natural gravity.

`Character.preparePhysicsStep` replaces the upcoming world-gravity contribution
before Matter integrates. The existing post-step hook reconciles contacts and
hitlag. Both hooks are called by the fixed 60 Hz match loop and physics fixtures.

## Project rules and remaining limits

Ordinary aerial attacks retain launch energy. A jump, air dodge, recovery
special, dive/dash, ledge catch, rebound or trap bounce that takes ownership of
velocity clears the old bookkeeping; capture, reset and a new hit also clear it.
Fastfall requires descending total velocity and replaces the gravity component,
preserving launch and external wind. These action rules are explicit project
contracts; vanilla action-transition behavior has not been established from
primary engine code.

Matter remains authoritative at walls, floors and ceilings. Solid contacts
rebase gravity canceled by impacts or wall friction so later acceleration cannot
retain a permanent deficit. The reference calculator instead reflects launch at ceilings
and keeps gravity, so the project's ceiling behavior is not reference collision
parity. Grounded tumble continues to resolve into tech or knockdown.

Ordinary hitstun duration is unchanged. Virtual-frame tumble speed-up is the
next implementation step: it must coordinate displacement, gravity, decay and
contact timing. Merely shortening hitstun would produce the wrong trajectory.
The [calculator's timing formulas](https://github.com/rubendal/SSBU-Calculator/blob/gh-pages/js/formulas.js)
map ordinary first-actionable frames 32/54/62/65/66/80 to 32/41/44/45/45/50.
Those are research checkpoints, not current runtime results. Validate grouping
and release-frame indexing before porting them, then remeasure DI, hitstun and
KO boundaries together. LSI, fixed/set-weight launch types, hitlag/stale/rage
parity, detailed roster values and directional-dodge timing remain open.

## Verification

- [Aggregate tests](full-tests.txt): **334 files / 10,663 tests passed**.
- [Final focused tests](final-focused-tests.txt): **9 files / 131 tests passed**
  after the wall-friction correction, including the added wall-exit regression.
  The aggregate began before that last correction; these focused tests cover
  the final affected runtime and authoring paths. No further runtime edits
  followed them. The concurrent test runners emitted a harmless WebSocket-port
  warning; all focused tests completed with exit 0.
  Together these runs verify **10,664 distinct tests** across 334 files.
- [Production build](build.txt): **passed**, including `tsc --noEmit`.
  Artifact: `index-B96MegK4.js`.
- [Production launch and Lab evidence](production/link-launch.json): **passed**
  across five scenarios and **356 matching frames** against the
  [real-Matter trace](launch-after.json). Maximum position error was below
  `2e-13` pixels, with zero page or resource-load errors.
- At **1280×720** and **390×844**, the Lab exposes all four Link/DK profile
  values with fitting labels and six-digit precision. Actual keyboard editing
  changes vertical gravity from `0.076944` to `0.077944`; undo restores the
  exact original value. Existing reference strike controls remain available.
- Physics regressions use independent numerical trajectories for both fighters,
  first-step ordering, gravity caps, retained drift, ceiling and wall contacts,
  outgoing hitlag, wind, aerial attacks, jump/dodge/special replacement, fastfall
  and replacement by a legacy hit. Existing legacy recovery tests still pass.
- Whitespace check: **passed** (`git -c core.autocrlf=false diff --check`).

Human controller, audio and balance acceptance remains outstanding. Browser
physics is manually stepped at the fixed simulation rate.
