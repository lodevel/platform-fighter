# Link neutral-air and dash-attack reference launches

Latest continuation: [Link down-air reference launches](../down-air-launches/README.md).

Continuation after [up/down tilt launches](../tilt-launches/README.md).
Link's neutral-air early/late hits and dash attack now use reference knockback,
recipient weight, launch gravity, decay, tumble speed-up and DI/LSI where authored.

## Selected source records

| Strike | Damage | Base KB | Growth | Angle | Horizontal orientation |
| --- | ---: | ---: | ---: | ---: | --- |
| Neutral air, early outer knee | 11 | 22 | 100 | 361 | Target's side of attacker |
| Neutral air, late | 6 | 15 | 100 | 361 | Target's side of attacker |
| Dash attack, middle sword | 13 | 85 | 85 | 50 | Attacker facing |

Pinned vanilla [AttackAirN](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/AttackAirN.txt)
and [AttackDash](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/AttackDash.txt)
provide these records. Copies retrieved on 2026-09-21 are in [sources/](sources/).
Both use ordinary weight-sensitive launches, zero fixed knockback and shared
ground/air hit records. Neutral air's angle 361 still resolves differently for
grounded and airborne recipients under the existing reference model.

Neutral air's source early inner/right and left knees deal 9 damage with the
same knockback parameters. The current single rectangle retains the outer-knee
11-damage representative. All three late records agree at 6 damage/base15.
Source dash attack has a 14-damage tip (base70/growth85/angle45) and 12-damage
arm (base85/growth77/angle55); the current rectangle uses the existing 13-damage
middle-sword representative. Bone geometry, dash-tip hitlag and clank differences
remain unmodeled. Dash attack's source shield setoff multiplier1.4 and high attack
height are not newly implemented in this launch-data pass.

## Hit windows and authoring

Neutral air retains project windows **[6,8)** early and **[8,31)** late, sharing
group `kick`. The source replaces the same hitbox IDs without clearing between
strengths; the late window therefore cannot hit an already-struck victim again.
A fresh victim entering late receives the weaker damage and its own reference
record. Both windows orient launch by target position; exact horizontal ties
keep attacker facing under the project's existing rule.

Dash attack retains **[19,23)** and attacker-facing launch direction. Existing
recovery, landing and autocancel timings remain intact. The source has no new
motion-rate command in either gameplay script; its frame7/9/32 neutral-air and
20/24 dash boundaries correspond to these existing zero-based windows.

The Lab exposes both neutral-air reference records and the dash record, hiding
their inactive legacy vector controls. Editing the late record preserves the
early launch, shared hit group and direction flag through save/load and live
factory overrides. Older saved overrides without reference fields retain their
legacy behavior. Other recipients still use the documented fallback until their
own reference weight/gravity profiles are authored.

## Before and after

The [parameter comparison](parameter-comparison.json) evaluates the former
legacy vectors and the new reference records for fresh airborne hits with neutral
input, including eligible gravity boost. At a Link defender's initial 100%:

| Strike | Previous speed, px/step | Reference speed, px/step |
| --- | ---: | ---: |
| Neutral air, early | 4.036 | 21.182 |
| Neutral air, late | 2.715 | 14.009 |
| Dash attack | 7.991 | 30.280 |

These are formula comparisons, not captured pre-change trajectories. The changes
are substantial; source-based launch values do not establish balance acceptance.
The project's existing hitlag, rage/stale and damage-modifier policies remain.

## Verification

The [independent real-Matter traces](physics.json) measure actual hitbox delivery
through three actionable integrations after hitstun. Selected neutral results:

| Strike / defender | Pre-hit % | Reference KB | Ordinary / displayed hitstun |
| --- | ---: | ---: | ---: |
| Early nair / Link | 0 | 49.813725 | 18 / 18 |
| Early nair / Link | 100 | 139.029412 | 54 / 40 |
| Early nair / DK | 100 | 128.995595 | 50 / 39 |
| Late nair / Link | 0 | 36.294118 | 13 / 13 |
| Late nair / Link | 100 | 91.196078 | 35 / 33 |
| Late nair / DK | 100 | 85.299559 | 33 / 32 |
| Dash attack / Link | 0 | 111.675000 | 43 / 36 |
| Dash attack / Link | 100 | 199.175000 | 78 / 48 |
| Dash attack / DK | 0 | 110.522467 | 43 / 36 |
| Dash attack / DK | 100 | 189.156828 | 74 / 47 |

All 16 exported cases use fresh hits against airborne recipients. They cover
both strengths, both weights at 0/100%, rear/mirrored launch and diagonal DI/LSI.
The attacker moves aside after contact to isolate the launch. Dash attack is
dispatched from a stationary grounded attacker; these traces do not establish
running approach/root motion, environmental collisions, KO thresholds or full
controller parity. Production input is injected at the resolved-stick boundary.

Two additional real-Matter tests are separate from the exported traces: one
puts the same victim back into the late sensor to prove hit-group deduplication;
the other hits a grounded 0% victim with late nair, proving angle-zero release,
the grounded 0.8 speed factor, and non-tumble immunity to DI/LSI. These are bounded
contact cases, not broad grounded-trajectory parity.

- [Existing move and authoring tests](focused-tests.txt): **144 passed**,
  including the late-hit group and early/late save/load isolation.
- [Full suite](full-tests.txt): **342 files / 10,788 tests passed** in one
  aggregate run, including all final runtime and test changes.
- [New physics tests](physics-tests.txt): **18 passed**, exporting **16 scenarios /
  717 displayed frames**.
- [Build](build.txt): **passed**, artifact `index-qgSsjK5c.js`.
- [Production comparison](production/nair-dash-launches.json): **all 717 frames
  match exactly** before input, after input and after physics constraints.
  All 2,570 steps preserve one input/rule update and one world timestep; gravity
  restores correctly. There are zero page/load errors.
- The production probe also passes Lab reference-field and label-fit checks at
  **1280x720** and **390x844**, including the late window's distinct fields.
- Final [TypeScript check](typecheck.txt) and whitespace check passed.

No runtime or test logic changed after these checks.

## Next step

Audit and convert down air's early/late meteor, grounded-response and returning
hit launch records together. Charged smash attacks, linked strikes and fixed/
set-weight behavior need explicit contracts before conversion. Detailed spatial
hitboxes, precise directional dodge and wider roster calibration remain open.
Replay playback and 3D remain deferred. Human controller, audio and balance
acceptance remains outstanding.
