# Phase 6: held items on package-drawn fighters

Part of the [Phase 6 plan](PLAN.md) (risk "Held drawings vs held items"). Date: 2026-10-19.

## Result

- A package may hold one drawing for up to 8 ticks. Its `item` socket is held with it.
- Before this change, a held item was drawn at the gameplay grip, which moves every tick. During a held drawing the item could leave the hand.
- Now a package-drawn fighter's held item is drawn at the package socket of the drawing shown. Position, angle and in-plane length come from the package. Facing is mirrored.
- Display only. Item hit areas, muzzles and shots still use the gameplay grip.
- Where the shown action has no item socket (hurt, run, aerials…), the gameplay grip stays. That is the hand-anchor fallback the legacy path also uses there.

## Drift measured

Headless seeded matches: 4 hard CPUs, items `high`, held weapons only (bat, sword, Star Rod, Ray Gun, Super Scope, Fire Flower), 6 seeds × 10,800 frames.
Each frame, every held sprite item was placed by the game view (gameplay grip) and at the grip the holder's `PackageSpriteAppearance` shows (package grip), as MatchView draws it.
Tool: `npx tsx tools/held-item-drift.ts`. Data: [drift.json](held-items/drift.json).

| Fighter | Held frames | With a package socket | Drifting frames | Mean / max grip drift (px) | Mean / max angle (°) | Max tip drift (px) | Items seen drifting |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DK | 12,677 | 2,026 | 16 | 0.02 / 1.9 | 0 / 0 | 1.9 | Super Scope |
| Link | 7,327 | 6,978 | 162 | 0.18 / 40.9 | 0.08 / 18.5 | 42.3 | sword, bat, Star Rod |
| Pikachu | 16,143 | 6,402 | 238 | 0.07 / 6.7 | 0.14 / 34.7 | 18.2 | all six |

"Drifting" means more than 0.5 px or 1°. Drift is rare (2–4 % of socket frames) but large when it happens.
Link's worst case is his Final while holding the Beam Sword: drawing `d04final/7` held over ticks 14–21 while the gameplay grip followed drawings 8–10.

Every tick of every action with an item socket, shipped (held) package against the unheld export (equal to the gameplay grip, as the exporter verifies):

| Fighter | Socket ticks | Differing | Actions | Max drift (px) | Max angle (°) | Worst |
| --- | --- | --- | --- | --- | --- | --- |
| DK | 1,832 | 14 | 11 | 59.9 | 12.8 | `item_throw_drop`@23 |
| Link | 9,884 | 176 | 27 | 40.9 | 63.5 | `d04finalair`@102 |
| Pikachu | 2,350 | 33 | 19 | 6.7 | 34.7 | `dash_attack`@11 |

DK's bat and sword actions hold no drawing. A DK-only run (8 seeds, bat and sword only, [drift-dk-bat-sword.json](held-items/drift-dk-bat-sword.json)) saw 108,778 held frames and 0 drifting frames. DK's drift is in throws, eating and the Super Scope.

## Fix

- `heldItemPlacement` (`src/characterPresentation/legacy/heldItemPoseData.ts`) is the one rule that places a held item sprite: bottom on the grip, turned and foreshortened. `heldItemMuzzle` uses the same maths.
- `buildSimView` places every item with it from the gameplay grip, and tags held items with `held: { playerIndex, socketAxis, turns }`.
- `packageItemSocket` (`port/src/fighters/backends/packageItemSocket.ts`) reads `item` (or `item-z` for gun barrels) at a display's action and tick, or the shooting overlay's socket plus its offset.
- An appearance backend may report `heldItemGrip(axis)`: the grip of the drawing it shows now. `PackageSpriteAppearance` answers from its own display (one art selection per fighter); the legacy backend does not, so it keeps the gameplay grip. `AppearanceCollection.heldItemGrip(actorId, axis)` asks the fighter's drawn routes.
- `MatchView` re-places a held item with `placeHeldItem` (`port/src/match/heldItems.ts`, i.e. `heldItemPlacement` at that grip) when the holder's appearance reports one.

## Browser check (Edge, real GPU)

`node tools/package-held-items-probe.mjs --drift held-items/drift.json --out held-items`. Same seeded match, same frame, `?packages=none` and `?packages=all`. Report: [report.json](held-items/report.json).
In the marked crops, red is the gameplay grip and green the package grip.

| Fighter | Item | Frame | Package drawing | Drift | Legacy | Packages |
| --- | --- | --- | --- | --- | --- | --- |
| Link | Beam Sword | seed 20261020, 8546 | `d04final/7` @21 (held) | 27.6 px, 18.5° | [crop](held-items/link-beamSword-legacy-marked.png) | [crop](held-items/link-beamSword-packages-marked.png) |
| Pikachu | Beam Sword | seed 20261024, 4113 | `dash_attack/2` @11 (held) | 6.7 px, 34.7° | [crop](held-items/pikachu-beamSword-legacy-marked.png) | [crop](held-items/pikachu-beamSword-packages-marked.png) |
| DK | Super Scope | seed 20261020, 10772 | `item_scope_air_rapid/0` @4 | 1.9 px | [crop](held-items/donkeykong-superScope-legacy-marked.png) | [crop](held-items/donkeykong-superScope-packages-marked.png) |

- Both variants reached the same game state (`sameState`: the gameplay grip equals the headless run).
- Legacy draws the item on red, in its own unheld drawing's hand. Packages draw it on green, in the held drawing's raised hand. Without the fix it would sit on red, away from that hand.
- DK has no bat or sword case (see above); the Super Scope is his worst.
- Full frames are kept beside the crops (`*-frame.png`).

## Tests

- `src/characters/heldItemSocket.test.ts`: placement equals half the muzzle, mirror, foreshortening floor, upright items.
- `port/src/fighters/backends/packageItemSocket.check.ts`: held drawing keeps its socket, facing, `item-z` and root space, overlay offset, no socket; the backend's grip is the socket of its shown drawing, none while loading.
- `port/src/match/heldItems.check.ts`: placement at a drawn grip, items that do not turn, no grip, free items.
- `src/characters/testing/animationSnapshot.ts`: the standing snapshot fixture, now shared by the selector test and the backend check.

## Open

- Whole-screen colours: five of the six Edge frames show the arena yellow on black. Link's frames are inside his Final. DK's frames (both variants) and Pikachu's packages frame have no Final running, while Pikachu's legacy frame of the same game state is normal. Item drawing only moves item sprites, so it is not the cause. Resolved: a backward presenter clock after the probe's long blocking draw (probe path, fixed in the presenter), see [crash-and-dark-arena.md](crash-and-dark-arena.md).
- The package socket ignores the display's rotation and squash, as the gameplay grip does.
