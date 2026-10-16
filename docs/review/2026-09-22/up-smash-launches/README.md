# Link up-smash fixed linking launches

Continuation after [down-smash reference launches](../../2026-09-21/down-smash-launches/README.md).
Up smash now uses fixed ground/air linking launches for its first two sweeps
and ordinary percent-based knockback for its finisher. The previous calibrated
linking vectors and minimum-hitstun floors are replaced by sourced records.

## Source and selected records

The pinned vanilla [AttackHi4 script](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/AttackHi4.txt)
provides the hit records and added reaction frames. The existing arc rectangle
represents the inner sword throughout each sweep:

| Strike / recipient | Damage at 0 / 30 / 60 charge frames | Fixed parameter | Base KB | Growth | Angle | Added reaction |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| First / airborne | 4 / 4.8 / 5.6 | 38 | 0 | 100 | 115 | 3 |
| First / grounded | 4 / 4.8 / 5.6 | 28 | 0 | 100 | 107 | 3 |
| Second / airborne | 3 / 3.6 / 4.2 | 38 | 0 | 100 | 115 | 3 |
| Second / grounded | 3 / 3.6 / 4.2 | 28 | 0 | 100 | 107 | 3 |
| Finisher / either | 11 / 13.2 / 15.4 | 0 | 60 | 101 | 90 | 0 |

Both linkers force weight 100. All strikes use positional orientation: the
107°/115° linker angles pull toward Link from the target's side, while the
90° finisher launches upward. First/second source IDs 1 and 2 persist unchanged
through their whole six-frame windows, including when the outer sword changes.

The body linker (105°/fixed 55), outer sword (including its late 135°/fixed
45 or 40 replacements), 80° outer finisher and weaker arm/body finisher are
omitted spatial variants. The script does not establish added-reaction
retention through the outer replacement; this conversion needs no assumption
about that replacement because it represents the unchanged inner sword.

Gameplay windows remain **[9,15)**, **[24,30)** and **[40,45)**, with charge hold
frame **4** and total **77** steps. Source files, timing references, exact
hashes and known limits are recorded in [the provenance manifest](sources/provenance.json).

## Fixed knockback and reaction timing

The pinned community calculator's [WeightBasedKB formula](https://github.com/rubendal/SSBU-Calculator/blob/233590e94bc4bd8813f2d1a2af45c8c46648f351/js/formulas.js#L211-L213)
uses `((1 + fixed / 2) * 200 / (weight + 100) * 1.4 + 18) * growth / 100 + base`,
followed by explicit launch modifiers. The fixed parameter is not itself the
final knockback magnitude.

- `reference.fixed > 0` selects this formula. Damage, percent and charge do
  not enter its magnitude. Zero or omission retains ordinary knockback.
- `reference.setWeight: true` selects weight 100 and suppresses the initial
  gravity boost. Natural gravity and fall caps still use the recipient's
  profile, so equal launch strength does not imply identical whole trajectories.
- `reference.additionalHitstunFrames` adds whole reaction frames after
  `floor(max(5, KB * 0.4)) - 1`. Added frames do not change tumble eligibility.
- Fixed launches skip reaction-clock speed-up even when they tumble. They
  retain normal DI/LSI eligibility; the shipped linkers are below its threshold.
- MatchScene excludes rage and stale knockback scaling from fixed launches.
  Staling still reduces dealt damage. Explicit defensive and authored launch
  multipliers remain available; this is not a blanket modifier exemption.

The selected ground linker yields **KB 39, speed 5.85 px/step and 17 reaction
frames**; the air linker yields **KB 46, speed 6.9 px/step and 20 reaction
frames**. The finisher uses its recipient's actual reference weight and charged
damage. Existing 0–60 damage-only charging scales all three damage values.

## Authoring and remaining approximations

Save/load validates optional fixed units, the set-weight boolean and added
reaction frames wherever a reference record is accepted. Omitted fields stay
omitted; explicit zero and false survive round trips. The Lab exposes numeric
fixed/reaction values and preserves independent ground/air edits. Its current
numeric-only controls preserve `setWeight` without exposing a boolean toggle;
that flag can be authored through JSON.

The source linker SDI multiplier of 0.5, precise bone geometry, hitlag/setoff
details and original status code remain outside this pass. Existing local
SDI, hitlag, stale-damage/rage rules for ordinary attacks, collision integration
and five-pixels-per-unit conversion remain documented project policies.
Automated agreement with the chosen reference model is not complete native
engine or human controller/balance acceptance.

## Verification

The original integration fixture [initially failed two up-smash cases](runtime-tests-initial.txt)
because it called Matter directly instead of the current
`stepCharacterPhysics` coordinator. Updating that fixture's integration path
made all [**17 checks pass**](connected-regression-tests.txt), with the same move/defense assertions. Source launch
values and runtime behavior were not weakened to satisfy the fixture.

The [independent real-Matter fixture](physics.json) exports **26 scenarios /
1,332 displayed steps**. Twenty cases isolate first/second/finishing launches,
tap/partial/full charge, both recipient weights, low and high starting percent,
grounded selection, fresh late contacts, mirroring, finishing DI and a generic
high fixed-knockback launch. That generic case verifies tumble and nonparallel
DI/LSI input without speed-up or the suppressed gravity boost.

Six cases retain both fighters through all three hits, including grounded
and airborne starts, a full-charge hit against Donkey Kong, and repeated fresh
jump/dodge/attack attempts. They check source launch values for each hit, a
single attack identity, three distinct contact groups, repeated-overlap
deduplication and no actionable gap. The target is staged before the first
contact, with no repositioning between strikes. After the finishing contact,
the attacker moves aside and the pad is removed to measure the final flight
through three actionable integrations. These bounded setups do not establish
universal connection across every position, spatial variant or SDI input.

- [Authoring checks](authoring-tests.txt): **177 tests passed**.
- [Physics checks](physics-tests.txt): **26 tests passed**.
- [Full suite](full-tests.txt): **348 files / 10,921 tests passed**. The final
  focused 26-test rerun strengthens the generic high-fixed case from parallel
  to nonparallel stick input, proving DI rotation as well as LSI. Browser
  review also found two long Lab labels overlapping their values by 34 logical
  pixels. Shortening their displayed name to `Added Hitstun` passes the final
  [18-test Lab/serializer check](final-lab-tests.txt). These follow-up changes
  affect test coverage and labels; no launch mechanics changed after the
  aggregate, and no second all-files run is claimed.
- [TypeScript and production build](build.txt): **passed**, artifact
  `index-aLAtqK0o.js`. The [source-map check](build-source-check.json) matches
  all eight changed runtime sources exactly.
- [Production comparison](production/up-smash-launches.json): **all 1,332
  frames match exactly** before input, after input and after constraints,
  including six connected sequences. There are **zero page/load errors**.
  These checks preserve **5,481 ordinary input/rule/world steps**, **1,332
  ordinary-gravity witness steps** and **665 attacker cadence checks**.
- Two separate resolver checks add **361 steps**, for **5,842** checked outer
  steps overall. Maximum world-time error is below 7.6e-13 ms; witness position
  and velocity errors are below 3.4e-11 px and 2.0e-12 px/step respectively.
- Main and linker Lab controls pass at [1280x720](production/lab-1280.png)
  and [390x844](production/lab-390.png), with the added reaction controls visible
  at [desktop](production/lab-linker-1280.png) and
  [narrow](production/lab-linker-390.png) sizes. Narrow rendering retains the
  existing compressed canvas; this is layout/access coverage, not a claim of
  mobile usability.
- Whitespace and local evidence links pass.

The exact trajectory probe injects dedicated heavy/up input at the Character
boundary. The separate resolver checks use **attack + a fresh upward stick
flick**, with no Character-input override. One holds 30 charge frames and
connects all three hits against an initially grounded target for **4.8, 3.6
and 13.2 damage**, without restaging between strikes or granting an actionable
gap. The other uses an attacker at 150% with three stale occurrences: damage
falls to **4.08**, while fixed **KB 46 / 20 reaction frames** remain unchanged.
Both verify one stale registration per attack instance. Resolver responses
are controlled; physical keyboard/gamepad events are outside these checks.

## Next step

Audit forward air and back air before replacing their calibrated linking
launches. Their motion-linking/special-angle requirements need source evidence
and independent connected-hit verification. Detailed spatial hitboxes,
precise directional dodge and wider roster values remain open. Replay playback
and 3D stay deferred; human controller, audio and balance acceptance remains
outstanding.
