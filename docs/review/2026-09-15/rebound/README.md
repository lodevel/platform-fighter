# Link down-air rebound

Latest continuation: [September 16 — launch calibration and recovery from hitstun](../../2026-09-16/README.md). The five-scenario measurement slice below is now implemented there; this page retains the rebound milestone evidence.

Continuation after [special and air-dodge landing](../README.md) on `rework/gameplay`. The fixed 60 Hz simulation, existing early/late down-air strikes and landing rules remain the basis of this pass.

## Implementation

- A confirmed down-air hit or shield block now sends airborne Link upward. Damage contact retains mutual hitlag; the rebound velocity is released after that pause. Shield contact commits its upward impulse after collision resolution, preserving solved horizontal pushback and respecting a solid ceiling. A simultaneous damaging contact transfers that queued bounce into hitlag.
- Fast-falling suppresses the rebound. A successful bounce clears jump-cut/rising state without spending or replenishing jumps. The original 79-frame move timeline continues.
- A bounce removes the entire hitbox for 30 advancing attack frames, including against new opponents. It then returns with an 11-damage strike that can hit a previously contacted target. Hitlag pauses this delay; a late return cannot extend past the original active window. Before a bounce, the early/late sensors share their once-per-target hit history.
- Only the current body-attached attack can rebound. Detached projectiles, ignored contacts, counters, old sensor identities and interrupted attacks cannot supply a rebound. Multiple targets contacted on one attack frame produce one upward impulse.
- Damage, capture, reset and ledge transitions cannot release an old queued rebound. Ordinary aerials retain once-per-swing contact behavior unless they explicitly author rebound data.
- Save/load preserves optional rebound speed, return delay, fast-fall suppression and return-hit damage/knockback/geometry. The Lab exposes the numeric values, with positive speed/delay validation. Link authors 6.65 px/step, 30 frames and 11 return damage.

## Reference and calibration

[Ultimate Frame Data](https://ultimateframedata.com/link) lists down air's early 14–19 / late 20–64 windows, 18/15 damage, and a possible second hit after 30 frames. The detailed [down-air research entry](https://www.ssbwiki.com/Link_%28SSBU%29/Down_aerial) describes fast-fall suppression and the hitbox disappearing until that return. This engine uses zero-based, end-exclusive windows `[13,19)` and `[19,64)` and counts the return delay on the attack timeline, excluding hitlag.

The pinned vanilla [bound script](https://raw.githubusercontent.com/WuBoytH/SSBU-Dumped-Scripts/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/AttackAirLw2Bound.txt) adds 1.33 upward game units. The [return attack script](https://raw.githubusercontent.com/WuBoytH/SSBU-Dumped-Scripts/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/AttackAirLw2Attack.txt) authors 11 damage and radius 4.3. At this project's existing 5 px/unit scale, these supply a 6.65 px/step upward rebound and 43 px-wide return sensor.

**Trajectory and launch remain engine calibrations.** The runtime assigns the upward speed; the source instruction adds velocity within an original status implementation that has not been ported. The rectangular sensor, launch vector, gravity, animation/cancel details and invincibility/parry behavior are not established as exact Ultimate parity. This pass preserves existing move commitment and shield handling. Existing sprite strips communicate the bounce through movement and simulation-driven poses, and the absent sensor also suppresses its trail/debug geometry.

## Verification

- [Failing baseline](failing-before.txt): real damaging and shield contacts both retained downward velocity before the runtime fix.
- [Shield-speed browser regression](shield-speed-browser-before.txt): production collision resolution changed the authored 6.65 px/step rebound into 9.18 px/step. The final runtime commits this impulse after the solver. The browser now asserts exact shield-bounce speed.
- [Final focused run](focused-tests.txt): **3 files / 82 tests passed** after the reference audit and shield-speed correction.
- `Link.rebound.physics.test.ts`: 14 real Matter cases covering hit/shield/whiff, the global 30-frame gap and returning 11-damage hit, frozen hitlag, fast-fall suppression, simultaneous targets and jump resources, interruptions, floor contact during hitlag, exact shield rebound speed, solid ceilings and mixed shield/damage contact.
- `HitboxDamageHandler.test.ts`: 59 existing confirmation tests retain ordinary once-per-group behavior. Returning hits use a new group within the same attack identity, so the move stales once.
- `characterReboundSerializer.test.ts`: 9 cases for optional fields, invalid values, return-hit data, editable limits and saved tuning.

- [Production build](build.txt): passed. Artifact: `index-BjJbi5h_.js`.
- [Production browser report](production/link-rebound.json): hit, shield, whiff and fast-fall scenarios pass against that artifact. The damaging scenario deals 18 then 11 damage; shield rebound preserves its authored 6.65 px/step speed. Zero page errors and zero failed resource requests.
- Lab navigation and field bounds pass at [1280×720](production/rebound-lab-1280.png) and [390×844](production/rebound-lab-390.png). Both screenshots were visually inspected. Narrow rendering remains very small; this is field-access/layout smoke coverage, not mobile readability or human usability acceptance.

- [TypeScript](typecheck.txt): passed with no diagnostics after the final test additions.

- [Final aggregate](full-tests.txt): **325 files / 10,498 tests passed**, including all final rebound, authoring and collision-boundary cases. No runtime changes followed this run.
- Whitespace: `git -c core.autocrlf=false diff --check` and a trailing-whitespace check of the new tests, browser harness and handoff documents passed.

## Next work

1. Calibrate collision and launch together: hitbox/hurtbox placement, launch trajectories, DI, hitstun and KO thresholds under one units model. Start with fixed-step Link strike traces on the flat arena across opponent weights and starting damage. Review `combat.ts`'s percent temper, launch decay and hitstun conversion together before changing individual multipliers.
2. Refine rebound trajectories and the directional-dodge landing/timing/travel rules using source evidence or reproducible measurements; calibrate the remaining roster.
3. Human controller, sound and balance acceptance. Replay playback remains ultralow priority and 3D remains deferred.

For the first calibration slice, use fresh moves, zero attacker damage and neutral DI:

| Attack | Opponent | Starting damage | Contact setup |
|---|---|---|---|
| Link forward tilt | Link | 0% | Airborne, open space |
| Link forward tilt | Link | 100% | Airborne, open space |
| Link forward tilt | Link | 100% | Grounded, near a wall |
| Link forward tilt | Donkey Kong | 100% | Airborne, open space |
| Link up air | Link | 100% | Beneath a low ceiling |

Trace from actual contact through five steps after hitstun: launch velocity/angle, hitlag, first actionable frame, apex, displacement and collision normals. Compare the real Matter fixture in `src/characters/Link.combat.integration.physics.test.ts` with MatchScene browser traces. The percent temper `0.09`, inverse mass `12/mass`, decay `0.34`, and hitstun conversion `round(speed × 2)` remain local approximations; the movement scale alone does not establish their knockback conversion. Include the transition back to normal air movement when hitstun ends.
