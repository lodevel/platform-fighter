# Rework implementation — 9 September 2026

Branch: `rework/gameplay`. Changes remain in the working tree, alongside the
pre-existing rework. No commit, push, engine migration, or 3D asset installation.

The [roadmap implementation log](PROJECT-ROADMAP.md#2026-09-09-team-implementation-after-the-full-review)
describes the completed batch and next priorities. The
[original full review](REWORK-REVIEW-2026-09-09.md) records the before-state.

## Review and regression coverage

Independent reviews covered Character action commitment and round cleanup,
MatchScene rule/participant integration, Lab/Pause/Results lifecycle, replay
schema/build identity, and moving platform/rider/ledge integration. Findings
were sent back to each owner and corrected. In particular, the added moving
ledge regressions were checked failing before their fix.

The production build includes TypeScript checking. The full aggregate run passed
**303 files / 9,995 tests** with four workers and a 20-second per-test limit;
see [the test log](review/2026-09-09/implemented/full-tests.txt). The subsequent
menu event fix passed **323 focused tests across 10 files**, a separate
TypeScript check, and the [final production build](review/2026-09-09/implemented/build.txt).

Final browser acceptance: **17 scenarios passed, zero page errors** on that
build. Coverage includes keyboard rules → fighters → arena → match, selected
stocks, real KO/respawn flow, Time expiry/scoring/sudden death, sparse identities,
controller reconnect metadata, real hitlag/launch/jump behavior, platform
riders/art/ledges, rising pass-through landing, replay inputs/build ID, Lab
restart/return/undo, stable pause/resume/Controls, and narrow pointer navigation.
Screenshots were inspected at 1280×720, 844×390 and 390×844. Portrait text remains
too small for a comfortable authoring experience; navigation success is not a
mobile usability sign-off.

The expanded browser checks caught two further integration defects after the
full suite: the live scene never called the stage render refresh, and Phaser
could emit the same queued keydown more than once. The renderer is now called;
menu events have shared ownership across scenes, with predicates that yield to
pause and authoring dialogs. An independent reviewer checked specific/generic
keyboard event ordering, overwrite confirmation, distinct presses/repeats, and
listener cleanup.

Browser checks use Chromium with software WebGL, an isolated storage context,
and the local production preview. They combine actual keyboard/pointer scene
journeys with controlled input/physics probes through the real MatchScene and
Matter world. They bypass the local access gate using the development inspector.
They are not a physical controller or competitive human playtest.

Reproduce with Node 20:

```sh
npm run build
npx vitest run --maxWorkers=4 --minWorkers=1 --testTimeout=20000
npx vite preview --host 127.0.0.1 --port 4173 --base /platform-fighter/
node tools/rework-acceptance.mjs
```

The bounded worker count and longer per-test timeout avoid the existing Medium
AI stress test's five-second timeout under contention on the Windows/WSL mount.
No assertions or production behavior are relaxed by these test runner options.

The earlier batch's machine-readable browser results and screenshots are in
[`review/2026-09-09/implemented`](review/2026-09-09/implemented/acceptance.json).

## Full roster authoring and playable saved tunes

The next team batch adds Link, Kirby and Donkey Kong's complete current kits to
the authorable registry alongside the ten existing JSON baselines. Fresh Lab
sessions use Link; roster and saved-tune lists paginate without discarding drafts.
The existing JSON baselines are retained without claiming compiled-kit parity.

Normal character selection now supports a saved tune per player, through
T/Shift+T, controller Y, or a clickable tune row. The selected spec is validated,
copied and deeply frozen. Stage Back, launch, restart and rematch carry that
snapshot even after the underlying save is edited or deleted. Four copies of
the same base fighter can retain independent movement and move damage.

Replay v5 preserves authored specs, player/device/profile identity and item
rules. Canonical match initialization retains those same fields. Independent
reviews caught shallow device references, dropped match-start metadata, and
stale controller ownership after CPU removal; all three were corrected.

The final aggregate run passed **307 files / 10,054 tests**, using eight workers
and a 20-second per-test timeout; see [the full test log](review/2026-09-09/authoring/full-tests.txt).
The snapshot-specific run passed **45 tests**, and the saved-tune/menu correction
passed **78 focused tests**, including three CPU ownership regressions.

The [final production build](review/2026-09-09/authoring/build.txt), including
TypeScript checking, passed. Browser acceptance passed **20 scenarios with
zero page errors**: the previous gameplay/menu coverage plus Link's full-kit
save/Test path, normal saved-tune selection through stage Back/storage deletion/
restart/replay capture, and four identical base fighters with independent kits.
The browser scenarios edit movement and jab damage and inspect actual live
fighters, not just stored JSON. They do not prove complete Link move behavior.

Screenshot inspection then found device labels overlapping the palette strip.
Device labels now sit in the card header, with separate space for palettes and
two-line long tune names. This final layout-only change was built after the
aggregate and 20-scenario runs. Its separate
[browser layout check](review/2026-09-09/authoring/card-layout-measurements-after.json)
passed: tune/name/palette/header bounds do not overlap, a maximum-length tune
fits its click target, and clicking the CPU tune leaves the human tune unchanged.
No page errors occurred. Before/after screenshots are retained alongside the
measurements. Desktop portrait labels elsewhere and small-screen authoring still
need further readability work.

The browser harness now writes this batch's evidence to
[`review/2026-09-09/authoring`](review/2026-09-09/authoring/acceptance.json),
preserving the earlier batch's artifacts under `implemented`.

## Gameplay, physics, CPU and presentation follow-up

The user explicitly placed replay playback at ultralow priority. This batch
continues the gameplay rework on `rework/gameplay`, with no playback runner or
new 3D dependency. Three implementation/review agents worked alongside the root;
cross-review findings were returned to the relevant owner and corrected.

Combat now preserves spent jumps through recovery, clears tumble only after an
action actually starts, and captures tech input at the hitlag boundary. Ground
support uses live upward Matter contact normals. Placed bombs continue ticking
during owner lockouts and survive ordinary damage/capture; resets still remove
them. Remote detonation arms on the move's first active frame and lasts exactly
two physical simulation steps.

Directional influence now uses the sourced Ultimate angular limit and eligibility
rules, normalizes keyboard diagonals, and preserves vector magnitude. The
[physics follow-up](review/2026-09-09/combat-physics-followup.md) records references,
measured trajectories and the limits of the current design units. This does not
claim that global knockback, weight, LSI or combo windows match Ultimate exactly.

Link now charges and releases a bow on the ground or in the air, auto-fires at
full charge, and discards charge on cancel. A single boomerang travels outward
and returns, with separate damage/hit registration per pass. Up special selects
a grounded spin or a rising nine-hit recovery that ends helpless. Down special
releases one remote bomb, then detonates it on a second activation; a nearby
explosion can damage and launch Link. These authored special families and charge
settings survive save/load. Timing references and the frame convention are in
`Link.ts`; throwing units and collision sizes remain authored game values.

Easy, Medium and Hard CPU selections now drive actual live providers. They
receive current world/resources, steer toward opponents and recovery surfaces,
and reset on stock/round transitions. Sparse lobby slots and mirror matches use
runtime participant identity. The previous shortcut bot no longer bypasses the
selected difficulty. This is working local navigation, not competitive AI parity.

Fighter poses now follow simulation action frames instead of autonomous animation
FPS. Charge, whiff/hold/pummel/throw, move phase, landing, hitlag and pause state
drive the displayed frames. Teardown tolerates sprites already destroyed by
Phaser. The HUD groups identity, damage and stocks/Time score into player cards;
rules and timer remain central. Character selection uses larger tiles in two
rows with wrapped names and separate selection chips. No new generated art was
needed for these changes.

Projectile sweeps prevent fast shots skipping collision geometry. Art, muzzle
flashes and trap blasts use the same physical positions as their combat objects,
including stages with a non-unit scale and vertical offset. Hit resolution uses
the shared damage/feedback path with unique owner identity and live hurtboxes.
Contacts resolve in travel order across fighters and reflectors, so changing
player slots cannot cause a farther target to intercept a shot first. Spawned,
held and thrown items now share physical coordinates and live platform bounds.

The Lab now builds all thirteen baselines from the same compiled declarations
used by live fighters. A constructor-observed comparison checks every registered
move, grab, dispatch selection and tuning after save/load. This replaces the ten
older JSON baselines in the editor while preserving their files as fixtures.
Wolf and Cat's legacy neutral-air records retain their existing runtime behavior;
opening and saving a draft does not silently add different landing lag. The
parity check also exposed dropped sweet-spot metadata in the shared serializer.

The final aggregate run on the combined source passed **313 files / 10,188
tests**, with eight workers and a 20-second per-test limit. The
[complete test log](review/2026-09-09/gameplay/full-tests.txt) and
[production build log](review/2026-09-09/gameplay/build.txt) are retained. Build
includes TypeScript checking; the game bundle is 880.33 kB / 218.41 kB gzip.
`git diff --check` also passes. Six old ground-contact fixtures were corrected
to end contact with the same platform object that started it, matching Matter.

All eight browser harnesses were then run against the final production preview,
with **zero page errors**:

- [20 menu/session/combat/authoring scenarios](review/2026-09-09/gameplay/acceptance.json).
- [Real keyboard bow tap/partial/full-charge hits](review/2026-09-09/gameplay/link-bow.json):
  projectile damage 4/8/12 and speed 10/16/22 reach the live target.
- [Scaled projectiles, reflection, sparse mirror CPU and four-player hit order](review/2026-09-09/gameplay/cpu-projectile-probe.json).
- [Spawn/pickup/hold/swing/throw/landing and live item support](review/2026-09-09/gameplay/item-coordinate-probe.json).
- [Seven move timelines, pause and hitlag poses](review/2026-09-09/animation/runtime-observations.json).
- [Four-player HUD, camera clearance, elimination and Time scoring](review/2026-09-09/hud/runtime-observations.json).
- [Roster label/chip/banner/card layout](review/2026-09-09/gameplay/roster-layout.json),
  with inspected [desktop screenshot](review/2026-09-09/gameplay/roster-readable.png).
- [Cat Save / Test Fight / Return to Lab with complete live-kit equality](review/2026-09-09/authoring/registry-lab-observations.json).

These are local Chromium/software-WebGL checks using isolated storage. They
combine keyboard/pointer journeys with controlled real simulation probes; they
do not replace physical-controller, listening, cross-browser or human playtests.
The CPU browser assertion checks selected difficulty and live behavior rather
than an unstable class name, which is shortened by production minification.

Reproduce the build and full suite with Node 20, followed by the production
preview at `http://127.0.0.1:4173/platform-fighter/`. The existing
`tools/rework-acceptance.mjs` defaults to that URL; set `PF_REWORK_OUTPUT` to this
batch's `docs/review/2026-09-09/gameplay` folder. The bow, projectile, item and
roster scripts accept `PF_REWORK_URL`; the other scripts accept
`PF_ANIMATION_URL`, `PF_HUD_URL` and `PF_REGISTRY_URL` respectively.

## Remaining acceptance work

- Link's normals, early/late strikes, charged grounded Spin Attack, held/pickable
  bombs, aerial landing and grounded jump calibration are implemented in the
  [Link follow-up milestone](review/2026-09-09/link-gameplay/README.md).
  Detailed collision/linking parity and full roster balance remain work.
- Exact Ultimate physics/defense parity, listening tests, physical gamepads,
  competitive human playtests and cross-browser determinism remain unverified
  or incomplete. A large automated test count is not competitive playtest proof.
- Narrow-screen navigation checks do not establish comfortable portrait play.
  The desktop layout still scales to small text in portrait.
- Three-dimensional presentation and new model generation remain deferred.
- Replay capture/versioning is retained. Playback and enforced compatibility
  checks are deferred at the user's explicit ultralow priority; they do not gate
  any work above. Old recording formats cannot recover inputs never recorded.

## Follow-up: P1 CPU must not give P1 controls to P2

The user's reported case reproduced in the production browser: joining P2 after
making P1 a CPU selected the first unused keyboard layout, which was P1's. The
match preserved that erroneous lobby assignment. P1/P2 now join with their own
numbered layouts through card, portrait and Space input. Older lobby state is
repaired without taking another human's occupied layout; controller ownership
and saved custom key mappings are preserved.

Verification passed **155 focused tests**, TypeScript/production build, and four
production-browser scenarios with zero page errors. Each scenario verifies that
P1 keys leave P2 neutral while P2 keys actually move its fighter, before and
after stage handoff/restart. The tests additionally cover custom profile-2
rebinding, sparse/reordered runtime slots, and extra-slot rejoining.
[Reproduction and evidence](review/2026-09-09/controls/README.md).

## Follow-up: Link gameplay and coherent jump calibration

Implemented the next authorized gameplay pass on `rework/gameplay`, with separate
agents for landing/movement, specials/items and presentation, plus cross-review.
Link now has genuine separate strikes, early/late strengths, an optional charged
forward-smash follow-up and a charged grounded Spin Attack. Remote bombs can be
held, thrown, picked up and transferred while their original owner retains the
detonator. Shared landing and hit-stop defects were corrected.

Link's previous full hop reached approximately 298 pixels while the short hop
reached only 51. The calibrated arcs reach 139 and 66.9 pixels; grounded full/short
and fast-fall durations are within one step of the reference targets. Other
fighters retain their movement defaults. New fields survive saved tunes and are
editable in the character lab.

Final aggregate passed **318 files / 10,342 tests**, plus TypeScript and production
build. Actual production-browser evidence, measured timings and explicit remaining
parity limits are recorded in the [milestone handoff](review/2026-09-09/link-gameplay/README.md).
