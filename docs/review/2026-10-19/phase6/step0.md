# Phase 6 step 0: the selector names the package action and tick

Plan: [PLAN.md](PLAN.md), step 0. Date: 2026-10-18.

## Result

The legacy art selector now also returns `display`: the package action, its tick and the
placement extras. In real headless matches, evaluating that display against the exported
packages gives the drawing the legacy path draws, for every fighter at every simulation tick.

- **245,469 fighter-frames checked, 0 mismatches.** On 1,531 more frames the legacy path drew nothing.
- Every drawn frame had a display. No frame needed an action that is not exported.
- Nothing visible changes: the legacy selection is untouched, `display` is extra data.

## What `display` is

`ActionDisplay` in [contracts.ts](../../../../src/characterPresentation/contracts.ts) is plain
data, so the portable presentation core stays free of game imports.

| Field | Meaning |
| --- | --- |
| `action`, `tick` | The package action (the exported clip id) at a tick of its own clock |
| `facing` | Mirror for facing left |
| `rotation`, `pivot` | Radians as drawn; about `pivot` (body-centre space, facing right) or about the root |
| `scale` | Squash about the root (generic jumpsquat, landing and dodge fallbacks) |
| `overlay` | Upper-body layer: its action and tick, its offset from the base, and each layer's waist line in design px below its own root |

The root is the body centre minus the action's `bodyCentreFromRootY`, as in the legacy draw.

## Code

| File | Change |
| --- | --- |
| [actionDisplay.ts](../../../../src/characters/actionDisplay.ts) | New. `describeActionDisplay`, `clipDrawingAt` (one sampler per ordinary clip, shared with the exporter), `clipOfSheet` (texture → clip, also used by held-item sockets), `sheetDisplay` (menus, knockout flight) |
| [artFrameSelector.ts](../../../../src/characters/artFrameSelector.ts) | Adds `display` to the selected pose |
| [simulationSpriteAnimation.ts](../../../../src/characters/simulationSpriteAnimation.ts) | `ActionPose.display` for poses whose drawing is not the drawn sheet on the pose's clock |
| [legacyClips.ts](../../../../scripts/character-package/legacyClips.ts) | Pikachu clips use the shared sampler; new action `air_dodge_directional` |
| [exportLegacy.ts](../../../../scripts/character-package/exportLegacy.ts) | Returns the placement → drawing map (`placementKey`) |
| [displayEquivalence.test.ts](../../../../scripts/character-package/displayEquivalence.test.ts) | The equivalence test |

The exporter's own check stays at zero differences for all three fighters.

## Cases that were not clean

| Case | Before | Now |
| --- | --- | --- |
| Pikachu specials | `frame` held the drawing index | `display` carries the special's clock tick (`local`) |
| Pikachu smash charge | `frame` held the drawing index | `display` tick = min(60, charge frames) |
| Pikachu directional air dodge | `air_dodge` drawings on another sample table | Own exported action `air_dodge_directional` |
| Final owner (DK, Link, Pikachu) | Drawn sheet can differ from the Final clip | Action = Final clip, tick = Final age, rotation from the Final |
| Final victim | Drawn sheet differs from the profile | Action = victim profile, tick = authored age |
| Pikachu forward tilt | Texture `tilt` holds clip `ftilt` | `clipOfSheet` maps it (one function, also used for sockets) |
| Generic fallbacks | A drawing index, not a tick | The pose's clock if the clip shows that drawing then, else the first tick that does |

Pikachu's specials and charge keep `frame` as the drawing index, because receiving and capture
read that pose. Changing it would change gameplay.

## Routes reached (fighter-frames)

| Fighter | Route | Frames |
| --- | --- | ---: |
| DK | clip clock (native samples) | 77,602 |
| DK | clip clock (resolved drawing) | 459 |
| DK | Final owner / victim | 2,876 / 1,263 |
| Link | clip clock (native samples) | 77,033 |
| Link | clip clock (resolved drawing) | 1,882 |
| Link | Final victim | 1,754 |
| Pikachu | clip clock (reviewed windows) | 49,149 |
| Pikachu | clip clock (resolved drawing) | 3,954 |
| Pikachu | special / charge / directional air dodge | 4,407 / 332 / 354 |
| Pikachu | Final owner / victim | 3,968 / 765 |
| Pikachu | fallback: attack timeline | 18,724 |
| Pikachu | fallback: hold last | 547 |
| all | knockout flight (`tumble`) | 400 |

Link's own Final has no Final pose, so it takes the native-timed clip route, counted under "resolved drawing".

## Generic fallbacks

Only Pikachu reaches them. DK's `missingSheet: 'generic'` never fired, and Link has none.

| Fallback | Frames | Tick |
| --- | ---: | --- |
| Attack timeline (smash, dair, dash attack, uair, fair, bair, usmash, ftilt, dsmash, jab, nair, landings, clank, charges) | 18,724 | Always the pose clock: the move's windows equal the clip's |
| Hold last: `landing` → `crouch`, squash 0.92 | 547 | First tick showing the last crouch drawing |
| Phase, duration, fixed 6/12 fps, hold first | 0 | Not reached |

DK's untimed `attack`, `up_special` and `review_legacy_grab` are not exported. The selector
returns no `display` for them, and no match showed them.

## Display extras reached

| Extra | Frames |
| --- | ---: |
| Rotation (Pikachu Final, Skull Bash / Quick Attack) | 1,612 |
| Pivot (Skull Bash / Quick Attack) | 42 |
| Squash | 547 |
| Overlay (DK / Pikachu / Link) | 186 / 176 / 114 |

## What the test drives

| Scenario | Runs | Steps |
| --- | ---: | ---: |
| Four hard CPUs, items high, Final meter and Smash Ball, every stage | 6 | 5,400 |
| Three hard CPUs, only Ray Gun, Super Scope and Fire Flower | 3 | 5,400 |
| One scripted fighter (directional dodges, charges, every special, grab, crouch, taunt) against a hard CPU | 3 | 6,000 |
| Every Final against every victim, ground and air | 18 | ≤ 900 |
| Menu and knockout-flight sheets (`idle`, `tumble`, ages 0–399, both facings) | 3 | 1,600 each |

Per frame the test checks the drawing id (`<sheet>/<frame>`, ignoring the `@n` placement
suffix), the placement it was exported with (origin, scale), facing, root, rotation and pivot,
and for overlays the second drawing, its offset and both waist lines.

Actions shown in these matches: DK 107 of 208, Link 94 of 229, Pikachu 105 of 199. The
exporter's tick-by-tick check covers the rest.

## Not covered

- Pikachu's ceiling tech never happened in a match. Its table gave the same drawing as the exported clip at the ages checked by hand (0–26).
- Pause, rewind and checkpoint restore were not driven. The selector's clock rules did not change.
- `poses.ts` still decides rotation, pivot and the overlay layout for the legacy draw. `display` makes the same decision a second time until the legacy path is removed.
- `assets/characters/pikachu/pose-batches/smash-charges.json` repeats the charge windows of `frames.json`. The exported action reads `frames.json`.
