# Item coordinate regression

The scene previously kept spawned and grounded items in stage-design coordinates,
but held and thrown items inherited fighter positions in physical viewport
coordinates. Rendering then transformed both. At a 1440 × 1000 viewport, the flat
stage has scale 0.75 and vertical offset 95: the baseline item rested logically at
(960, 930), while its visible base was (720, 792.5). A fighter beside that visible
item could not pick it up.

`MatchScene` now transforms authored spawn positions once. Item entities, fall
positions, held positions, throw trajectories, swing effects, and explosion
effects use physical coordinates. Falling and thrown items find surfaces from the
current solid Matter bodies, including platform motion and disabled collision
masks. Thrown-item landing uses the segment's platform crossing position and the
same bottom anchor used by its art. Authored spawn-event records retain their
existing design-coordinate format.

## Browser evidence

Run with the local game server available:

```sh
PF_REWORK_URL=http://127.0.0.1:4174/ \
  npx --yes --package=node@20 node tools/item-coordinate-probe.mjs
```

The probe starts the real MatchScene, feeds ordinary player inputs through its
input resolver, and advances the fixed physics loop. Its one controlled spawn
request makes the scenario repeatable. All assertions passed against the fresh
development build, with no browser errors:

- Spawn entity and visual: (720, 641).
- Grounded entity and visual: (720, 792.5), exactly on the physical platform top.
- Pickup succeeds; held entity and visual remain equal.
- Bat swing effect matches its actual Matter hitbox center and dimensions.
- Thrown entity, trajectory, and visual remain equal; the bat lands at y=792.5.
- After moving the platform upward 50 physical pixels, a falling item without a
  cached surface lands at the new live top, y=742.5.
- Disabling that platform's collision mask allows a new item to fall through;
  entity and visual remain equal.

Raw observations are in `item-coordinate-probe-before.json` and
`item-coordinate-probe.json` alongside this file. This is coordinate and surface
coverage; it does not claim a complete review of item damage, defense, or replay
behavior. The focused item tests passed 164 cases initially; the remaining
integration case exceeded the default timeout during a cold import. An isolated
diagnostic run with a 20-second limit passed both integration cases in 3.32 seconds
without changing the test or its default timeout.
