# Link specials: source launches and projectile phases

This slice replaces supported special-move launch values with reference records and carries source hitlag/SDI multipliers through collision delivery. It also adds the boomerang's late outbound phase, preserves a projectile's stale snapshot across both passes, gives reflected shots a fresh owner identity, and uses one stale registration for an aerial Spin sequence.

## Sources and selected records

[Provenance](sources/provenance.json) lists the pinned paths, source records, timing interpretation, and remaining approximations. [SHA-256 manifest](sources/sha256.json) covers the saved source files. Script records come from [SSBU-Dumped-Scripts at 59004685238a3f6f93bae905d3a4e079701c40b4](https://github.com/WuBoytH/SSBU-Dumped-Scripts/tree/59004685238a3f6f93bae905d3a4e079701c40b4); formulas and charge functions come from [SSBU-Calculator at 233590e94bc4bd8813f2d1a2af45c8c46648f351](https://github.com/rubendal/SSBU-Calculator/tree/233590e94bc4bd8813f2d1a2af45c8c46648f351). [Ultimate Frame Data: Link](https://ultimateframedata.com/link) provides the gameplay timing cross-check.

| Hit | Damage | BKB / KBG / angle | Other source properties |
| --- | --- | --- | --- |
| Single bow arrow | 4–12 by charge fraction | 10 / 71 / 361 | Hitlag 0.8; damage-only charge |
| Boomerang clean | 8 | 80 / 40 / 70 | Velocity-facing direction |
| Boomerang late, article frame 10 onward | 6 | 60 / 40 / 65 | Same outbound hit allowance |
| Boomerang return | 3 | 50 / 40 / 70 | New return-pass hit allowance |
| Ground Spin inner clean | 14 | 60 / 88 / 45 | Hitlag 1.4; position-facing direction |
| Ground Spin inner mid | 12 | 52 / 88 / 43 | Hitlag 1 |
| Ground Spin inner late | 9 | 48 / 84 / 43 | Hitlag 1 |
| Ground Spin inner latest | 7 | 20 / 82 / 361 | Hitlag 1 |
| Air Spin source frame 22 | 2 | 0 / 100 / 83 | FKB 71, setWeight, SDI 0.3 |
| Air Spin source frame 31 | 2 | 0 / 100 / 69 | FKB 62, setWeight, SDI 0.3 |
| Air Spin finisher | 4 | 30 / 200 / 361 | Hitlag 2, SDI 1 |
| Remote bomb explosion | 7 | 60 / 115 / 52 | Position-facing direction, hitlag 0.8 |

Ground Spin charge scales every phase's damage by `1 + 0.6 × held/60`, leaving reference BKB/KBG unchanged. Bow uses the calculator's 4–12 damage fraction with the existing 36-frame gameplay charge interval; the script's initial 5-damage declaration is not treated as the final charged shot damage.

The first eight aerial Spin sensors last two attack frames; the final sensor lasts three. The two angle-367 linkers and four rear linkers with `set_vec_target_pos` retain their explicit legacy vectors. Their scripts specify inputs to native status functions, but do not establish those functions' launch algorithms.

## Validation

[Focused test log](focused-tests.txt): **78 tests in six files passed**, including **23 new cases** in `Link.specialReference.physics.test.ts`.

The new real-Matter cases verify all four grounded Spin phases at 0/30/60 charge, source launch direction, the supported aerial rungs, their lifetimes and shared identity, and bomb launches on both sides. Bow charge/reference preservation and boomerang phase/reflection identity have pure regression cases. These tests deliver authored payloads without MatchScene's stale/rage layer; expected reference numbers are calculated independently in the fixture.

`tools/link-specials-parity.mjs` provides **23 production scenarios** using actual MatchScene projectile sweeps, attack sensors, and resolved special inputs. It checks charged bow, boomerang phases and reflection, grounded Spin charge/phases, supported airborne hits, and bomb hits. It independently calculates damage, weighted staling, rage, reference knockback, and post-stale hitlag; records neutral hitlag through release; and checks fixed-step input/rules clocks.

The [final browser run](browser.txt) passed on **`index-DN4pX3Za.js`**: **23 scenarios, 24 actual hits, 338 freeze/release trace frames, 4,022 outer steps**, with matching input/rules clocks and no page/network errors. The [final report](production/specials-parity.json) records each selected contact and its checked result. The earlier pass on `index-B8WC6T1M.js` remains preserved as [initial log](browser-initial.txt) and [initial report](production-initial/specials-parity.json).

## Fidelity limits

- Bow speed/trajectory/size remain calibrated. Ground-sticking, pickup, and double-arrow item behavior are not implemented here.
- Boomerang travel, return steering, catch, and reflection timing retain the existing project behavior. Native angled/smash throws and shield-damage offsets remain unimplemented.
- Ground Spin uses the existing symmetric rectangle and selected inner-sword damage. Animated tip geometry, weaker tip records, and source clank/setoff changes remain unrepresented.
- Aerial Spin's moving rectangle, rise/drift, helpless transitions, and unsupported linking vectors are approximations. This slice does not establish that all nine hits connect or that the recovery arc matches Ultimate.
- Bomb explosion geometry remains a 92-pixel rectangle. Thrown-item collision damage, wind area, native item physics, and ownership restrictions remain unimplemented or unverified. Owner self-damage enters Character directly and retains raw damage without MatchScene's stale/rage/credit layer; the browser probe observes that separate path explicitly.
- Browser targets are staged to isolate selected contacts. The probe establishes production delivery and the checked numerical rules, not whole-flight trajectories, KO percentages, full controller interaction, or native bone/hurtbox geometry.
