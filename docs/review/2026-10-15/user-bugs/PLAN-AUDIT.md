# Port plan acceptance audit after user play

The user tested the BYOl1XlT build and reported visual, controller and freeze
failures on 2026-10-15. The earlier blanket completion claim was incorrect.
Code landing and automated checks were conflated with the plan's full acceptance
criteria. This audit supersedes that claim, while preserving the actual earlier
test results as historical evidence.

Scope: [the nine-step Phaser → Three.js plan](../../2026-10-13/threejs-port/PLAN.md).
“Implemented” below describes the subsystem, not accepted user experience.
This table records the failures found on the pre-repair build. For subsequent
corrections and exact-candidate evidence, see [the repair record](README.md).

| Step | Implementation | Acceptance against the written plan |
| --- | --- | --- |
| 1. Stage renderer | All six stages exist, with real platform/hazard state. | **Partial.** Projection checks passed, but the live Inferno camera hides much of its preview composition. Actual killed-fighter flight also needs checking against the preview. User visual acceptance is open. |
| 2. Fighter sprite cards | Atlas rendering, anchors, palettes and animation selection exist. | **Partial.** Low-level sprite parity passed. User found intermittent missing Link/launch drawings, coarse intro/Final motion and bad transitions. The actual action/lifecycle routes require repair and real-match observation. |
| 3. HTML/CSS menus | Gate, title, rules, fighters, stages, pause and results exist. | **Partial.** Automated journeys passed, but returning gamepads lose slot ownership and analog/pointer interactions conflict. The requirement that every flow works with keyboard/gamepad is not met. |
| 4. Delete unused fighters | Canonical roster/factories/assets retain DK, Pikachu and Link; old fighter removal landed. | Automated type/test/build gates passed on the recorded candidate. No user-reported roster-removal defect. |
| 5. Headless match simulation | Production MatchSim owns physics/gameplay without Phaser and runs in Node. | Ordinary frozen replay gate passed 55,800 exact comparisons. Final-source gate added 36,600 exact comparisons. The frozen short Final case had no activation; the repaired activated-Final comparisons use the current browser reference. This scope distinction remains required. |
| 6. Three.js match view | MatchSim is connected to actual fighters, objects, effects, HUD, cameras and sound. | **Partial.** The user's play requirement has exposed intro teleporting/held poses, violent-launch disappearance, disliked Star Rod/Fire Flower effects and a coarse/laggy Link Final. Complete object existence/selection checks did not establish acceptable presentation. |
| 7. Probes and tools | `window.__sim`, maintained browser adapters and a historical archive/replacement index exist. | **Partial coverage.** Earlier probes passed their stated arranged scenarios but missed the reported ordinary-play and returning-controller paths. Specialized old visual qualification does not transfer automatically. Add representative regression cases for these failures. |
| 8. Controls screen | Saved per-player controls and match input bindings exist. | **Partial.** Controls persist and drive matches, but Y in character select does not provide a usable per-player editor. Returning device attribution is broken. Both are explicit controls acceptance gaps. |
| 9. Remove Phaser | Root dependency/host/render glue removed; direct vendored Matter and Three root entry/build exist. | Automated import, type/test/build/preview and replay checks passed. Intermittent permanent freezes mean overall playable-build acceptance remains open even though Phaser removal itself landed. |

The requested default Smash meter is an additional product correction. The
inherited fresh-match default disabled it; it is now being changed to enabled
while keeping explicit saved/replay rules intact.

Cleanup is also unfinished: the old 17.7 GB list has not been executed, and the
1.23 GiB duplicate-only plan awaits the user's choice. Work remains uncommitted.
Human visual/controller acceptance and exact native Ultimate renderer/camera
parity were never established by the automated tests.

## Active repair ownership

- `port_live`: retained player/device slots, stable cursor/palette interaction,
  usable Y controls flow and actual keyboard/simulated-gamepad regressions.
- `pikachu_final`: Link/all-roster selected drawing visibility, denser retained
  Link intro/Final art and visible smooth intro/launch/Final transitions.
- `matchsim`: permanent-freeze reproduction, RAF fault survival/recovery,
  disconnect handling, intro/KO simulation-to-presentation transitions.
- Coordinator: Inferno scenic framing, Star Rod/Fire Flower presentation,
  default Smash meter, integration and exact-candidate verification.

Repaired implementation and a green regression run will be recorded separately
from the user's visual/controller acceptance. This audit is not a claim that the
reported issues have already been fixed in the served build.
