# Link jab launches and chain authoring

Continuation after [forward/back aerial launches](../fair-bair-launches/README.md).
Link's first two jabs now use the source inner-hit reference launch, and the
third uses the source finishing launch. This pass also fixes fractional Lab
edits of jab-chain timing and repeated staling when one ordinary swing hits
several opponents.

## Source and mapping

The pinned [Attack11](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/Attack11.txt),
[Attack12](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/Attack12.txt)
and [Attack13](https://github.com/WuBoytH/SSBU-Dumped-Scripts/blob/59004685238a3f6f93bae905d3a4e079701c40b4/smashline/lua2cpp_link/link/Attack13.txt)
scripts provide the records below. Copies, hashes, the calculator formula
sources, timing references and omitted variants are in
[the provenance manifest](sources/provenance.json).

| Stage | Damage | Base KB | Growth | Angle | Representative source hitboxes |
| --- | ---: | ---: | ---: | ---: | --- |
| Jab 1 | 3 | 25 | 25 | 361 | Inner IDs 0/1 |
| Jab 2 | 3 | 25 | 25 | 361 | Inner IDs 0/1 |
| Jab 3 | 4 | 70 | 70 | 30 | Shared launch across IDs 0/1/2 |

All three are ordinary percent/damage/weight launches with forward-facing
orientation and ground/air eligibility. None uses fixed knockback, forced
weight or added reaction frames. The first two use the existing grounded/air
Sakurai-angle rules; the finisher uses the existing gravity, tumble, DI/LSI and
reaction-clock contracts. Legacy vectors remain inactive while a reference
record is present.

Jabs 1 and 2 also have an inward fighter-only tip at 180°, growth15/base20,
plus a coincident all-category fallback at 361°. Those spatial variants are
not represented by the current single rectangle. Adding the inward hit as
an ordinary sweet spot would make any tip overlap win over inner overlap;
the script's ordered hitboxes alone do not establish that native behavior.
This conversion does not invent a priority rule or claim to reproduce the
source capsules. Their omission remains relevant to jab connection range.

The old calibrated rectangles were too short for the sourced launches: in
the initial neutral-chain measurements, jab one connected and both follow-ups
missed. The [before-geometry trace](physics-before-geometry.json) preserves that
result. Reach now uses the rectangular envelope of the selected source
capsules/spheres at the established **five pixels per reference unit**, with
the source foot projected **36 pixels below Link's body center**:

| Stage / geometry selection | Source forward bounds | Source height bounds | Local center | Local width × height |
| --- | --- | --- | --- | --- |
| Jab 1, inner IDs 0/1 | 5.2–15.8 | 6.2–9.8 | (52.5, -4) | 53 × 18 |
| Jab 2, inner IDs 0/1 | 5–18 | 5–12 | (57.5, -6.5) | 65 × 35 |
| Jab 3, top-bone IDs 0/1 | 5.5–19.5 | 3.5–12.5 | (62.5, -4) | 70 × 45 |

These bounds come from the source geometry rather than from adjusting launch
values until a combo connects. The foot projection is an explicit local
coordinate convention, not a verified animated root transform. Rectangles
include corners outside the source capsules/spheres, and jab three's animated
sword-bone ID2 geometry is omitted. The projection therefore improves sourced
reach without claiming exact native collision geometry.

The existing gameplay active windows remain **[6,8)**, **[4,6)** and **[5,7)**,
with totals **23/25/34**. The chain openings remain elapsed **11/7**, matching
the retained [UFD earliest-follow-up timings](https://ultimateframedata.com/link).
Raw script motion frames and flags differ, particularly for jab one's motion
rate. No exact animation/status-clock conversion is claimed.

## Input, identity and Lab behavior

The existing chain requires a fresh attack press while grounded. Each stage
starts its own timeline at zero and preserves the attack facing. Early or
hitlag presses, held buttons and whiff transitions retain the current project
input policy; source combo/no-hit flags are evidence to audit, not proof that
the native input/status algorithm is implemented.

In the measured neutral approaches, earliest presses land all three hits
against Link at 0/100% and Donkey Kong at 100%, with no actionable gap. The
contacts occur at steps **0/13/25** relative to jab one's contact. Delaying
both follow-up presses by four attack frames still hits a stationary opponent,
but exposes a real opening: the 0% Link recipient first becomes actionable at
step **15**, before jab two connects at **17**. Held attack and a single press
during hitlag do not advance under the current local policy.

An ordinary single-sensor attack now receives an execution identity after
Matter creates its body. MatchScene uses that identity to keep one stale
snapshot across every victim of the swing and register one consumed use.
Each chained jab stage and each fresh attack gets a new identity. Existing
windowed/rebound attacks retain their shared identities and per-strike hit
deduplication. Separate projectile/transient-sensor paths are outside this fix.
The single-sensor path also initializes missing plugin metadata, as the
windowed path already does, so lightweight scene bodies follow the same contract.

The Lab now treats `jabChain.advanceWindowStart` as a whole-frame value. The
previous generic quarter-step control could create a value the JSON parser
rejected. Edits from 11 to 12 and 7 to 8 now save, reload and construct correctly,
and real-Matter input checks verify the corresponding delayed chain opening.

## Verification

The [initial regression run](initial-tests.txt) passes **613 tests / four files**.
The [identity and collision regressions](identity-tests.txt) pass **124 tests /
four files**, including both victims sharing one stage identity, distinct
identities across all three jabs, and fresh identity on a repeated jab.
The [source-geometry regressions](geometry-tests.txt) pass **57 tests / four
files**. The [authoring checks](authoring-tests.txt) pass 148 focused tests,
followed by all five jab tests after strengthening the exact edited-opening
boundary checks.

The [final physics fixture](physics-tests.txt) passes **33 scenarios**, exporting
[1,130 trace frames](physics.json). Twenty-six isolated cases cover every stage
against Link/DK at 0/100%, actual ground/air selection, mirrored facing and
finishing DI/LSI. Earlier stages intentionally miss before the selected
isolated contact; the floor is removed after that contact for a free-flight
oracle. Seven whole-chain cases keep the floor and both fighters throughout,
with no repositioning between hits. They exercise earliest/delayed/held/hitlag
presses, all three source launch records, per-stage identities, jump-defense
attempts, and the neutral finisher's independent trajectory. Earliest free
input and final recovery are recorded separately so delayed gaps stay visible.

The initial [aggregate run](full-tests-before-plugin-guard.txt) passed 10,703
tests but failed 299 in seven files because their mock hitbox factories do not
initialize `body.plugin`. The ordinary attack-identity assignment now guards
that object consistently with windowed attacks. The fresh final
[full-suite run](full-tests.txt) passes **352 files / 11,002 tests**, with no
failures. No runtime or fixture edits followed that run's start.

The final [production build](build.txt) passes TypeScript and Vite as
**`index-B5ZhKgBj.js`**, with [matching source-map contents](build-source-check.json)
for all six checked runtime/collision/scene files. The [browser run](browser.txt)
and [production report](production/jab-launches.json) pass on that same artifact:
**33 scenarios / 1,130 compared frames**, maximum position error
**1.11 × 10⁻¹² pixels** and velocity error **5.69 × 10⁻¹⁴ pixels/step**.
They check **5,670 outer/input/rule steps** (5,530 scenario steps plus 140 in
the multi-opponent smoke), **1,130 ordinary-gravity witness steps** and
**735 attacker-animation samples**, with zero page or load errors.

The [earlier build attempt](build-in-progress-fixture.txt) captured the new
fixture midway through editing. The completed fixture subsequently built and
passed all production comparisons on `index-DOoZD6_9.js`; that evidence is
preserved in the [prior build log](build-before-plugin-guard.txt) and
[prior browser report](production-before-plugin-guard/jab-launches.json).

Production checks cover the same 33 scenarios and 1,130 fixture frames, normal
attack dispatch and chain transitions, an ordinary gravity witness, independent
outer/input/rule clocks, and attacker animation. A separate two-opponent smoke
checks equal damage/knockback for both victims and one stale use per stage.
Recipients are restaged between its two swings to isolate staling; this smoke
is not continuous-combo evidence. The unchanged whole-chain fixtures provide
that evidence instead.

Lab checks exercise actual 11→12→11 and 7→8→7 edits and launch fields at
1280×720 and 390×844. Desktop fields are readable; the narrow canvas retains
the existing compressed, letterboxed presentation. Its checks establish field
access and logical bounds, not mobile usability. The initial browser setup
accidentally assigned the same keyboard device to two recipients; the runtime
rejected it correctly. That attempt is retained in
[the initial browser log](browser-initial.txt); the corrected setup gives the
third fighter a distinct device identity.

All ten final screenshots were inspected; they are byte-identical to the
corresponding images from before the metadata guard:

| Lab page | Desktop | Narrow |
| --- | --- | --- |
| Jab 1 launch | [1280×720](production/lab-jab-1280.png) | [390×844](production/lab-jab-390.png) |
| Jab 1 chain | [1280×720](production/lab-jab-chain-1280.png) | [390×844](production/lab-jab-chain-390.png) |
| Jab 2 launch | [1280×720](production/lab-jab2-1280.png) | [390×844](production/lab-jab2-390.png) |
| Jab 2 chain | [1280×720](production/lab-jab2-chain-1280.png) | [390×844](production/lab-jab2-chain-390.png) |
| Jab 3 launch | [1280×720](production/lab-jab3-1280.png) | [390×844](production/lab-jab3-390.png) |

## Next and remaining limits

Audit Link's grab/throw damage, release timing and launch records. Jab's inward
tip/fallback and exact collision priority, forward air's angle367, and the
remaining projectile/special launches still need source-backed work. Native
hitlag multipliers (jab1/2/3: 1.6/1.2/2.0), motion/status clocks and precise
geometry are not ported by this milestone. Existing local stale damage, rage,
hitlag, collision integration and coordinate projection remain explicit
policies. Physical controller, audio and human balance acceptance are still
outstanding; replay playback stays ultralow priority and 3D stays deferred.
