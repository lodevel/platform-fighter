# Air movement and Link double jump

This pass keeps the 60 Hz deterministic Matter simulation and the established conversion of five physical viewport pixels per reference unit.

## Reference and implementation choices

[Ultimate Frame Data's measured stats](https://ultimateframedata.com/stats) list Link's full hop at 27.8 units, short hop at 13.38, air jump at 29, and normal gravity at 0.096. The previous pass calibrated ground jumps to 139 px and 66.9 px. Air jump still reused the full-hop impulse and boosted rise gravity, giving 139 px with a shorter rise.

Link now authors `airJumpImpulse: 12.04` and `airJumpRiseAccel: 0.2022222222222222`. Matter contributes 0.2777777777777778 px/step² at the existing world settings, so the air jump uses 0.48 total rise acceleration. Its 25 upward steps sum to exactly 145 px:

`25 * 12.04 - 0.48 * 25 * 26 / 2 = 145`

These are calibrated engine values, not copied game impulses. The height and normal-gravity target come from the reference; the discrete integration formula follows this engine's update order. Ground full-hop and short-hop values stay as calibrated previously. The new fields are optional, preserving other fighters' authored jump trajectories when absent. An explicitly authored air jump cannot be shortened by releasing jump.

The [official Prima Ultimate guide's offense section](https://primagames.com/eguides/prima-games-8-eguide/ultimate-glossary-of-terms-and-mechanics/offense) describes reverse-rush movement for presenting a fighter's back to opponents. We use the corresponding separation between travel direction and facing: free airborne drift retains orientation, while explicit actions such as side special may turn the fighter. Previously, drifting backward before pressing attack silently changed a planned back air into forward air. This is a shared gameplay rule; character-specific aerial turnaround actions remain separate features.

The [Prima ledge-hanging guide](https://primagames.com/eguides/prima-games-8-eguide/ultimate-glossary-of-terms-and-mechanics/ledge-hanging) distinguishes ledge jumps, dropping followed by a double jump, and a down-then-back ledge-snap gesture. The implementation restores the fighter's air jumps at a ledge while reserving the unavailable ground jump. Human jump input and the CPU's explicit ledge-jump command now produce the same jump and leave the same resources. As an input-order choice, a legal air jump takes priority over a new automatic catch. Holding down declines a catch; the guide's down-then-back sequence supports this separation, without defining our chosen 0.5 stick threshold.

## Results

| Scenario | Before | After |
| --- | --- | --- |
| Link air-jump height | 139 px; reused full-hop rise | 145 px; distinct normal-gravity rise |
| Backward drift, then attack | Facing changed during free drift; forward air | Facing retained; back air |
| Walk off a platform | Ground-only jump remained available in the air | One air jump remains for a two-jump fighter |
| Contact hitlag during calibrated air jump | Release skipped custom gravity; measured 149.853333 px | Freeze pauses the arc; measured 145 px |
| Ledge drop or explicit ledge jump | Ground-only jump also restored; two air jumps available | One air jump available; human and CPU release agree |
| Jump beside a catchable ledge | Automatic catch could swallow the jump | A legal air jump starts immediately |
| Hold down beside a ledge | Automatic catch still occurred | Passes the ledge until down is released |

Jump input is immediate in the air and replaces vertical velocity, including during descent or fast fall. Landing restores the jump budget. Damage interrupts the jump arc without restoring a spent jump or applying its rise acceleration to the new launch. Ground departure reserves the ground-only slot before input lockouts, including when a hit launches a standing fighter off the floor. Deliberate raw airborne fixture/spawn budgets retain their existing behavior. Attacker hitlag release also preserves descent acceleration, terminal-speed clamping, temporary platform support, externally supplied excess velocity, and the accumulated fall history used to decide ordinary hard landings.

## Validation

`Character.airMovement.physics.test.ts` has 25 tests using Phaser's real Matter implementation, gravity, collision events, and input steps. It measures held/tapped/descending/fast-fall air jumps, the subsequent ground jump, attacker hitlag, post-hit launch isolation, delayed back-air selection for both orientations, explicit side-special turnaround, legacy roster fallback, and walking off a real platform. Ledge cases cover human/CPU jump parity, drop resources, down-held catch suppression, legal versus exhausted jump intent, and the existing regrab cooldown. Paused-versus-unpaused descent comparisons verify identical resumed positions and velocities below, near, and above terminal speed, plus temporary platform support.

Focused validation: **587 tests passed** across `Character.airMovement.physics.test.ts`, `Character.landing.physics.test.ts`, `Character.ordinaryLanding.physics.test.ts`, `Character.physics.test.ts`, `Link.combat.integration.physics.test.ts`, and `Character.test.ts`. This is automated simulation validation; it does not claim a human controller playtest or complete Ultimate movement parity.
