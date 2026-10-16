# Consistent bomb explosions and longer item availability

All bomb detonations now use the existing layered explosion renderer: core flash, fireball sprite, shockwave, embers and smoke. This covers ordinary held bombs, thrown contact/floor/timeout/offstage removal, Link's held or thrown remote bomb, and timed traps such as Nova's bomb. The effect scales to each blast's existing dimensions. Each detonation emits it once, including during hitlag, and all sources advance the visual clock at the same point in the simulation step.

The previous held-bomb path emitted the effect repeatedly while a hit froze its active attack age. The old production trace records **19 renderer calls for one hit**. Other routes omitted some or all of that renderer. Stable sensor/object identities now prevent repeated effects, and scene recreation clears the visual caches. A fused trap without self-bounce also reports its detonation correctly.

## Availability

At 60 simulation steps per second, the shipped values are:

| Object / timer | Before | After |
| --- | ---: | ---: |
| Ordinary bomb, grounded pickup window | 360 frames / 6 seconds | 720 / 12 seconds |
| Hammer and ray gun, grounded pickup window | 480 / 8 seconds | 960 / 16 seconds |
| Bat, sword and spear, grounded pickup window | 600 / 10 seconds | 1200 / 20 seconds |
| Thrown-item expiry | 90 / 1.5 seconds | 180 / 3 seconds |
| Link remote-bomb object lifetime | 1800 / 30 seconds | 3600 / 60 seconds |

Ordinary ground timers restart when an intact item is dropped; held ordinary items do not expire from that timer. Link's remote-object clock still runs while carried. Broken debris remains at 30 frames. Damage, durability, the three-frame thrown-contact grace, projectile lifetimes, timed-bomb fuses and active blast durations retain their existing values. Thrown ordinary bombs retain their existing single-target impact damage path. Remote-object expiry remains removal, rather than a new detonation mechanic.

## Evidence

The [browser probe](../../../../tools/bomb-explosion-regression.mjs) uses actual MatchScene item pickup, resolved attack/grab/down-special input, collisions and trap clocks. A controlled scheduler supplies an ordinary bomb. The timeout case holds an already-thrown bomb in open air to isolate expiry; it does not claim a natural 180-frame flight. The renderer wrapper observes the existing effects without replacing them.

- [Old production measurements](before/results.json) and [baseline log](baseline.txt), artifact `index-Cfka7DlF.js`: all eight expected failures. Held contact produced 19 shared renderer calls; each other route produced none. Actual thrown target contact still dealt 18 damage at the three-frame grace boundary.
- [Initial fixed-build measurements](production-initial/results.json) and [log](production-initial-tests.txt), artifact `index-CZKxkpND.js`: **8/8 passed**, with exactly one shared renderer call, 18 ring/ember/smoke particles, two glow bursts, one fireball sprite and one blast flash per cause. Effects expire, and both item target damage and remote self-damage remain active.
- [Final production measurements](production/results.json) and [log](production-tests.txt), artifact `index-DU0SLTOZ.js`: **8/8 passed**, with zero page errors. All effect counts, damage and first-effect steps match the initial fixed build. The browser closed after the run.
- [Focused item/Link tests](focused-tests.txt): **76 tests in seven files passed**, including availability at the former expiry, exact doubled expiry, pickup/drop renewal and the real-Matter carried remote-bomb boundary.
- [Timed Character tests](timed-bomb-tests.txt): **4 selected tests passed**, including a fused bomb without self-bounce. The captured runner also reported a development WebSocket port warning; the selected tests completed successfully.

Baseline versus initial fixed-build first-effect steps, relative to each controlled fixture:

| Cause | Before | After |
| --- | ---: | ---: |
| Held item | 45 | 45 |
| Thrown floor contact | 54 | 54 |
| Thrown fighter contact | 39 | 39 |
| Thrown expiry | 126 | 216 |
| Thrown offstage removal | 38 | 38 |
| Held remote detonation | 83 | 83 |
| Thrown remote detonation | 89 | 89 |
| Timed detonation | 84 | 84 |

All measured damage is identical before and after: 18.9 on the fresh held-item hit, 18 on thrown contact, and 7 on remote self-hit. Only expiry moves by the requested extra 90 frames. This is a project behavior regression, not a claim of native Smash animation or item-physics parity.

The final combined artifact passed the same eight-case browser check. Repeat with Node 20 and Playwright Chromium:

```sh
PF_BOMB_EXPECT_ARTIFACT=index-ARTIFACT.js node tools/bomb-explosion-regression.mjs
```

`PF_BOMB_OUTPUT` selects the evidence directory; `PF_BOMB_URL` overrides the local preview URL.
