# Link down-air reference launches

Latest continuation: [Link charged forward-smash reference launches](../forward-smash-launches/README.md).

Continuation after [neutral-air and dash-attack launches](../nair-dash-launches/README.md).
Link's early meteor, early grounded response, late strike and returning hit now
use reference knockback with the existing weight, gravity, decay, tumble speed-up
and DI/LSI model.

## Source records

| Strike | Damage | Base KB | Growth | Angle |
| --- | ---: | ---: | ---: | ---: |
| Early, airborne recipient | 18 | 30 | 80 | 270 |
| Early, grounded recipient | 18 | 30 | 78 | 60 |
| Late, either situation | 15 | 30 | 80 | 60 |
| Returning hit, either situation | 11 | 50 | 80 | 65 |

The pinned vanilla [AttackAirLw script](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/AttackAirLw.txt)
provides the early air/ground split and late replacement. The
[AttackAirLw2Attack script](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/AttackAirLw2Attack.txt)
provides the returning strike. All records use position-based horizontal
orientation, ordinary recipient weight, zero fixed knockback and no forced rehit.
Copies retrieved on 2026-09-21 are in [sources/](sources/).

The project retains early **[13,19)** and late **[19,64)** windows, corresponding
to source frames 14/20/65. The early grounded override applies only in the early
window; it cannot leak into the late or returning strike. Both original windows
share group `thrust`. A rebound temporarily removes the hitbox and creates a new
group for the returning strike within the same attack identity.

## Rebound and authoring

This pass changes launch data and position-based orientation. The existing
[rebound contract](../../2026-09-15/rebound/README.md) still controls hit/shield
bounce, fast-fall suppression, hitlag-paused return timing, attack interruption
and the original active-window cutoff. The
[bound script](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/AttackAirLw2Bound.txt)
adds 1.33 native upward units; assigning 6.65 px/step and scheduling the return
after 30 advancing attack frames remain documented project policies.

The Lab exposes separate base/growth/angle controls for all four records,
hiding their inactive legacy vector fields. Nested edits survive save/load and
live factory overrides without changing the early meteor, shared groups or
rebound settings. Older saved overrides without reference records retain their
legacy behavior.

Detailed source geometry and jostle behavior, the source hitlag multiplier 1.2,
and original status implementation are not ported here. Rectangular hitboxes,
hitlag, damage modifiers, collision resolution and recovery transitions retain
the project's existing policies. Other recipients retain the existing fallback
until their own reference weight/gravity profiles are authored.

## Before and after

The [parameter comparison](parameter-comparison.json) evaluates the old legacy
vectors and new reference records for isolated fresh strikes, neutral input
and the eligible gravity boost. Against Link starting at 100%:

| Strike | Previous speed, px/step | Reference speed, px/step |
| --- | ---: | ---: |
| Early, airborne | 12.502 | 25.570 |
| Early, grounded | 12.502 | 26.011 |
| Late | 11.017 | 23.216 |
| Returning | 13.004 | 22.020 |

These are formula comparisons, not captured pre-change trajectories. The
returning samples isolate an 11-damage hit rather than measuring an 18+11 combo.
The source values substantially change launch strength; balance acceptance
remains separate.

## Verification

The independent real-Matter fixture covers early, late and returning hits
against Link and Donkey Kong at 0/100%, real grounded early contact against
both fighters, grounded returning contact, a returning hit behind a mirrored
attacker, and diagonal DI on the downward meteor. Its oracle computes source
knockback, gravity boost, influence, decay and reaction-clock groups separately
from the production helpers.

Returning cases earn an actual early rebound, observe frozen attack frames
during hitlag and an absent sensor through frame 42, then hit the same player/body
with a fresh group on frame 43. The victim is reset, repositioned and assigned
the requested percent before the measured return. This verifies return
eligibility and its isolated launch, not an uninterrupted 18+11 combo trajectory.

Grounded setups keep the attacker aside during startup, then place it above
the settled target immediately before contact. Contact staging zeroes the
attacker's downward velocity to avoid body-solver overlap in the narrow
extension below Link's body. After contact the attacker
moves aside and any grounding pad is removed to isolate recipient free flight
through three actionable integrations. Ground classification at impact is real;
these traces do not establish floor recontact, full rebound-flight, KO or
human-controller parity. The older rebound fixture separately covers lifecycle,
shield speed, fast-fall suppression, interruptions and solid ceilings.

- [Existing move, rebound and authoring tests](focused-tests.txt): **135 passed**.
- [Independent physics tests](physics-tests.txt): **17 passed**, exporting
  [17 trajectories / 787 displayed frames](physics.json).
- [Full suite](full-tests.txt): **343 files / 10,807 tests passed**. The final
  17-test focused rerun covers the grounded startup staging correction made
  after the aggregate had collected that fixture. No runtime changes followed
  the build or aggregate start.
- [Build](build.txt): **passed**, artifact `index-Cz1CoqeW.js`.
- [Production comparison](production/down-air-launches.json): **all 787 frames
  match exactly** before input, after input and after physics constraints.
  The final fixture export is byte-identical to the passing probe input.
  All **3,027 world steps / input samples / rule updates** preserve ordinary
  cadence, with maximum world-time error below 6.1e-13 ms. An unrelated gravity
  witness passes **1,039 steps** (maximum position error below 1.9e-11 px), and
  **497 attack-animation cadence checks** pass. Zero page/load errors.
- The production probe verifies all four reference records and hidden legacy
  fields, with fitting Lab labels at **1280x720** and **390x844**. This is field
  access/layout coverage, not human narrow-screen usability acceptance.
- [Existing production rebound regression](production/rebound/link-rebound.json):
  **four scenarios passed** (hit, shield, whiff and fast-fall suppression),
  including exact shield rebound speed and both Lab viewports. No page/load errors.
- Final [TypeScript](typecheck.txt) and whitespace checks passed.

## Next step

Establish Link forward smash's charged reference contract: damage and launch
scaling, distinct inner/tip records, and charge inheritance by the optional
second slash. Current charge interpolation only supports legacy launch fields,
and the damage-only sweet spot cannot represent distinct launch parameters.
Verify tap, partial and full charge before converting those two slashes.
Linked strikes and fixed/set-weight behavior also need explicit contracts.
Detailed spatial hitboxes, precise directional dodge and wider
roster calibration remain open. Replay playback and 3D remain deferred; human
controller, audio and balance acceptance remains outstanding.
