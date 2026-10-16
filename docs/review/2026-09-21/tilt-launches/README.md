# Link up/down tilt reference launches

Continuation after [launch influence and DI/KO verification](../../2026-09-20/launch-influence/README.md).
Link's up and down tilts now enter the reference launch path, including recipient
weight, decay, hitstun, tumble timing, gravity and DI/LSI where authored.

Continued in [neutral-air and dash-attack launches](../nair-dash-launches/README.md).
Use that record for the current handoff; the results below describe up/down tilt.

## Source records and direction

| Strike | Damage | Base KB | Growth | Angle | Horizontal orientation |
| --- | ---: | ---: | ---: | ---: | --- |
| Up tilt, selected inner sword | 11 | 30 | 111 | 85 | Target's side of attacker |
| Down tilt | 9 | 90 | 30 | 85 | Attacker facing |

Values come from pinned vanilla [AttackHi3](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/AttackHi3.txt)
and [AttackLw3](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/AttackLw3.txt),
retrieved on 2026-09-21. Local copies are in [sources/](sources/).
Both use ordinary weight-sensitive knockback, identical ground/air records,
zero fixed knockback, zero trip chance and no late launch replacement.
Up tilt uses position-based direction; equal horizontal positions retain the
attacker's facing under the project's existing tie rule.

The up-tilt source has four spatial variants, all damage 11 and base 30:
inner sword **85/111**, tip **95/103**, arm **85/105**, clavicle **85/104**
(angle/growth). The existing single rectangular sword arc uses the inner-sword
record as its representative launch. Separate bone hitboxes and their clank
differences remain unmodeled. Down tilt uses one source capsule, represented
here by the existing low rectangle.

Gameplay startup/active/recovery remains **7/5/23** for up tilt and **9/2/19**
for down tilt. The source up tilt activates at animation frame 8 and clears at
13; down tilt activates at animation frame 13 after a motion-rate command,
then clears two animation frames later. This launch-data pass does not reinterpret
animation frames as gameplay frames or claim a new timing calibration. The
project's hitlag policy also remains in place; the source up tilt's 0.9 hitlag
multiplier is not modeled.

## Before and after

The [parameter comparison](parameter-comparison.json) evaluates the previous
legacy vectors and the new source records under the same fresh-hit conditions.
With a neutral Link defender initially at 100%, up tilt's release speed changes
from **5.999 to 23.985 px/step**, and down tilt's from **2.992 to 18.013**.
Down tilt changes from about **17.35 degrees to 85 degrees upward**. This is a
substantial launch change, not a claim of completed balance acceptance.

The previous vectors remain in the data format for compatibility; reference
fields govern these launches. Old saved move overrides without reference data
continue to use their authored legacy behavior. Link and Donkey Kong currently
have reference weight/gravity profiles; other recipients retain their documented
fallback behavior until their own calibration.

## Verification

The [real-Matter fixture](physics.json) measures actual hitbox delivery and
compares trajectory arithmetic independently of runtime launch helpers. Its
neutral measurements are:

| Strike / defender | Pre-hit % | Reference KB | Ordinary hitstun | Displayed hitstun |
| --- | ---: | ---: | ---: | ---: |
| Up tilt / Link | 0 | 60.873235 | 23 | 23 |
| Up tilt / Link | 100 | 159.902647 | 62 | 43 |
| Up tilt / DK | 0 | 59.769515 | 22 | 22 |
| Up tilt / DK | 100 | 148.765110 | 58 | 42 |
| Down tilt / Link | 0 | 97.438235 | 37 | 34 |
| Down tilt / Link | 100 | 120.085294 | 47 | 38 |
| Down tilt / DK | 0 | 97.231718 | 37 | 34 |
| Down tilt / DK | 100 | 117.584141 | 46 | 37 |

The 14 scenarios include both defenders at 0/100%, front/back up tilt,
mirrored attacks, and final-hitlag diagonal input. Nonzero vertical input leaves
LSI at one for these near-vertical launches while horizontal input rotates DI.
Up tilt at 0% does not tumble; all measured down-tilt cases do.

Measurements use a grounded attacker on a narrow pad and airborne defenders.
Each is one fresh hit with zero attacker damage. After contact the attacker
moves aside to isolate the trajectory. The record covers contact and hitlag,
the full launch, and three actionable integrations. It does not establish
grounded-recipient, environmental collision, KO-threshold or controller-hardware
parity. The previous milestone's controlled KO fixtures remain shared-model
regressions; no new tilt-specific KO threshold is claimed here.

- [Move/authoring regressions](focused-tests.txt): **124 passed**. Both new
  reference records survive Lab editing, save/load and live factory overrides.
- [Full suite](full-tests.txt): **341 files / 10,767 tests passed** in one
  aggregate run, including all final runtime and test changes.
- [New physics tests](physics-tests.txt): **14 passed**, exporting **688 frames**.
- [Build](build.txt): **passed**, artifact `index-C6NNrrJp.js`.
- [Production comparison](production/tilt-launches.json): **14 actual-hit
  scenarios / 688 frames passed**. Positions and velocities match the fixture
  exactly before input, after input and after physics constraints. Hit delivery,
  direction, damage, hitstun and once-per-frame input/rule/world clocks pass;
  zero page/load errors.
- The same production probe verifies up/down tilt reference fields and label
  fit at **1280x720** and **390x844**, with inactive legacy fields hidden.
- Final [TypeScript check](typecheck.txt) and whitespace check passed.

No runtime or test logic changed after these checks.

## Next step

Convert the remaining straightforward Link normals, starting with neutral air's
early/late records and dash attack after source review. Charged smash attacks,
linked strikes and fixed/set-weight behavior need explicit contracts before
conversion. Spatial hitbox detail, precise directional dodge and wider roster
calibration remain open. Replay playback and 3D remain deferred.
Human controller, sound and balance acceptance remains outstanding.
