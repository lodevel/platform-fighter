# Pikachu Quick Attack gravity regression

Targeted existing-art fix for the reported Up + Y, then left/right flight that never descends. Existing Pikachu uses the Ultimate-based kit; this record measures the local regression and does not claim new source-game numeric or physical-controller feel parity.

## Reproduction before the fix

The bug reproduces after a real opponent attack. A simulated second standard gamepad starts Pikachu's up-smash through the normal right-stick binding. Player 1 takes the hit, waits for hitlag and hitstun to end naturally, then presses Up + Y for one tick, steers left or right at tick 20, and releases the stick at tick 81. No special, velocity, launch state, or hit result is injected. Ground placement and 60% entry damage are explicit setup fixtures.

The launch probe records all 241 fixed steps, preceding attack/contact/hitstun, body and launch state, resolved input, and the actual submitted drawing. The [compact qualification](qualification.json) preserves measurements, build/device/tool identities, fixtures, trace hashes and accepted visual-review receipts. Both directions reproduce:

| Observation | Before |
| --- | --- |
| Real up-smash damage | 60% → 76.38% |
| Natural hitstun completion | Setup tick 64, airborne and descending |
| Requested Quick Attack recovery gravity | 0.475 from action tick 41 |
| Observed vertical speed at tick 41 | 0 |
| Quick Attack ends | Tick 83 |
| Post-action airborne samples | 157, all with vertical speed 0 |
| Post-action vertical displacement | 0 |
| At tick 240 | Still airborne, helpless, no active special or attack |
| Previous launch state | Still present; `gravityY=7.75`, `launchVelocity={x:0,y:0}` |

The body is neither static nor sleeping, and `ignoreGravity` is false. Reviewed tick-240 captures visibly show the suspended fighter in both directions. The launch suite runs four cases, but the immediate and descending predicates select the same setup tick for this hit; they are repeats of two directional trajectories, not distinct recovery timings.

The ordinary probe covers eight additional cases: simulated gamepad ground/air in both directions, early first-burst steering in both directions, and real DOM keyboard W + G in both directions. These do not reproduce the suspension. The six late-steering cases start falling at tick 41 and finish grounded at tick 68 or 78. Early right steering stays grounded; early left steering later runs off and respawns. This is why testing only neutral entry missed the bug.

## Cause and targeted change

The source-special velocity callback wrote a new body velocity while retaining the preceding reference-launch bookkeeping. The physics step therefore kept applying the old launch's gravity correction and skipped Quick Attack's requested gravity. After the previous launch reached its terminal accumulated gravity, that correction canceled ordinary gravity even after Quick Attack ended.

The callback now uses the existing `setIntrinsicSourceVelocity` helper, which clears previous launch ownership before installing source-special velocity. This applies when a special explicitly owns velocity; neutral Thunder Jolt does not call that setter and retains its existing carried motion. No gravity values, move durations, or source timing were changed.

The independent physics regression failed in both facings before the change: observed vertical speed 0 versus requested recovery gravity 0.475 (failure receipt `.tmp/pikachu-recovered-launch-before.log`, hash retained in the qualification). The corrected test compares 30 post-action Y steps with an independent ordinary-fall character so the real post-Matter speed-cap behavior remains covered. The focused run passes all 146 tests across Pikachu specials, three reference-launch/transport suites, golden replay, and manifest checks (pass receipt `.tmp/pikachu-recovered-launch-after.log`, hash retained in the qualification).

## Fixed-build acceptance

**PASS:** four launched-recovery runs and eight ordinary-entry controls, all through the same real Edge input routes. The exact bundle is `game-BNZfv5Ng.js`, SHA-256 `66e3ae1472f058ad804b560ddfc6cd39c6a65bd971b81b8106ebfc88e303fc16`; simulation identity is `platform-fighter-sha256-0067e47aa8dad11d9fe4e4501c5db226e6d40d5f9dc5ab70e8693fbb2a1bd191`.

| Launched recovery | Before | After |
| --- | --- | --- |
| Previous launch owner at Quick Attack tick 0 | Retained | Cleared |
| Vertical speed at tick 41 | 0 | 0.475 |
| Action ends | Tick 83 | Tick 83 |
| Post-action descent | None | Every airborne sample |
| Landing | None by tick 240 | Left tick 121; right tick 136 |
| At tick 240 | Suspended | Grounded |

The ordinary-entry before/after trajectories match exactly across all 1,928 recorded rows for position, source root, velocity, grounded/helpless state, special state, and attack state. Both completed after runs have zero page/runtime faults and finite motion throughout.

Visually reviewed clean final captures show the landed fighter: left platform landing and right floor landing at tick 240. Their hashes and review conclusions remain in the qualification. One earlier left-immediate screenshot has repeated bottom/right strips from the browser capture; the clean repeat and authoritative trajectory are used for visual acceptance. FPS labels in these manually stepped captures are not performance measurements; normal-RAF counter qualification is recorded with [Inferno/FPS acceptance](../inferno-shipped-head/README.md).

## Runtime and input provenance

- Real Windows Edge, Intel Iris Xe via ANGLE/D3D11, `KHR_parallel_shader_compile` available. This is browser evidence, not a headless simulation substitution.
- Before bundle: `game-CDiv0wP3.js` from the frozen `http://127.0.0.1:4173/platform-fighter/` build. Each setup also records `MatchSim.buildIdentity`.
- The gamepads are explicitly simulated `navigator.getGamepads()` devices. Default standard button 3 maps to special; axes 0/1 map movement; the opponent's right-stick up maps to up-smash. Local saved profiles are absent in the isolated context and the resolved binding tables are recorded.
- Keyboard cases use Playwright DOM keydown/up with the resolved default W/G/A/D bindings. W is also the default jump binding.
- `window.__sim.step()` is called without injected `CharacterInput`, so the unchanged browser adapter and resolver sample each input. Every measured step receives a normal RAF render.
- Both completed before runs have zero runtime/page faults and finite positions/velocities throughout. The initial harness assertion typo (`input.up` instead of `input.moveUp`) has a separate initial-report hash in the qualification; it did not represent a game failure.

## Re-run

```sh
flock .tmp/dk-heavy.lock node tools/pikachu-quick-attack-gravity-acceptance.mjs \
  --suite launch --url http://127.0.0.1:4173/platform-fighter/ \
  --out docs/review/2026-10-16/pikachu-quick-attack-gravity/after-launch --expect-fixed
```

Use `--suite ordinary` for the eight neutral-entry regressions. The optional `held` suite holds special for 181 ticks in four ground/air directional cases; it is implemented but was not needed to reproduce or qualify the fix above.

Reviewed raw captures, trace reports and copied logs have been removed after bounded cleanup. Measurements, input fixtures, exact authority-comparison hashes, original receipt hashes and this record remain, together with the live acceptance tool.

Cleanup completed after exact path/hash review: 103 generated files (71,233,466 bytes) removed from this evidence directory. The compact qualification and live rerunnable tool are retained.
