# Follow-up: opponents still feel hard to eject at 200%

The user reported that the game still feels insufficiently threatening at 200%
after the stage/strong-finisher correction. The earlier acceptance established
those particular fixtures, not the user's currently loaded game or every attack.
This follow-up compares ordinary moves, recipient physics and runtime versions.
No new launch multiplier is justified by a passing finisher sample alone.

## The public game and local preview differ

Checked 2026-10-05 at 15:39 UTC. The public
[game](https://lodevel.github.io/platform-fighter/) serves an older bundle than
the verified local preview:

| Runtime | Public game | Current local preview |
| --- | --- | --- |
| Entry bundle | `index-CYzz3DGq.js` | `index-B4ia6NWm.js` |
| Main flat floor | 1600 px | 800 px |
| DK launch data | Legacy pixel vectors, percent temper and physical mass | Reference BKB/KBG/angle and reference weight |
| DK full-charge duration | 60 frames | 111 frames |
| HTTP Last-Modified | September 7, 2026, 08:55:42 UTC | Local October 5 production build |

The public bundle has SHA-256
`4a5f457c9d769a6469438d863bb34dba36d6e53ec7c373c570c7c04c7059061b`.
[Capture metadata](sources/hosted-build.json) identifies the exact URLs and
hashes. Its public source map supplies captured
[combat](sources/hosted-sept7-combat.ts.txt),
[DK](sources/hosted-sept7-DonkeyKong.ts.txt) and
[stage](sources/hosted-sept7-stageDefinitions.ts.txt) code. The modern reference
knockback/launch pipeline is absent from that hosted combat implementation.
HTTP modification metadata establishes the served artifact's age, not a
separately verified deployment history.

The user's address is **not yet confirmed**. The build discrepancy is real;
attributing their particular match to it remains conditional. No deployment
was performed. The repository's Pages workflow deploys a checked-out `main`
build on push or manual dispatch; it does not serve the uncommitted workspace.

An already-open local production tab also keeps its loaded JavaScript until
reload. Preview has no HMR. The current local index uses `Cache-Control:
no-cache`; there is no service-worker registration in the project.

## Saved tunes can reproduce weak high-percent launches

Character Select distinguishes `TUNE: BASE` from selected saved tunes. Saved
move records replace matching compiled move IDs, including older records
without `knockback.reference`. Parser compatibility preserves that omission;
current movement defaults do not upgrade the saved move into native KB.

A validated partial old DK forward-tilt record
`{x:1.75,y:-1.47,scaling:0.12}` launches a 200% DK target at approximately
`(3.787,-3.181)` px/step, magnitude **4.95**, with **10** hitstun steps.
The current compiled tilt yields approximately `(19.397,-15.154)`, magnitude
**24.61**, with **64 native** hitstun steps before reference gravity boost.
This is an independent parser/math counterexample, not evidence about the
user's actual stored tune. Do not silently overwrite authored saved moves.

Built-in flat geometry is reconstructed from current stage definitions; it is
not retained by ordinary match settings. Original hazard stages still have
their separate larger authored layouts/blast zones, and saved custom stages
retain their geometry. The user's stage is also unconfirmed.

## Source and flight audit

All **52 represented effective DK move/window/collision-region tuples** checked
against the captured primary `ATTACK` digest match its damage, angle, KBG, FKB
and BKB. This cross-check excludes throws and charge-derived arrays; it does
not establish exact collision placement or full source parity.

Independent real-Matter flight measurements at starting 200%, without floors,
platforms, influence, staling or rage, show:

| DK attack against DK | Lateral travel during hitstun | Maximum rise |
| --- | ---: | ---: |
| Jab 1 | about 106 px | about 27 px |
| Jab 2 | about 346 px | about 487 px |
| Forward tilt | 845.45 px | about 252 px |
| Up tilt, hand region | near-vertical | about 1484 px |
| Early dash attack | about 754 px | about 525 px |
| Ground Hand Slap | about 196 px | about 476 px |
| Aerial Headbutt | about 74 px | about 86 px |
| Up air | vertical | about 1314 px |

Forward tilt integrates the release plus 64 ordinary locked ticks across
45 displayed frames. The independent arithmetic and Matter displacement agree
at 845.45 px. No native integrations disappear during speed-up grouping.
An aerial attack after hitstun preserves the reference launch. Jump keeps its
initial horizontal speed before ordinary control/damping takes over; a legal
neutral air dodge deliberately stops it. These later actions cannot prevent a
blast-zone crossing that already occurred during hitstun.

Opening/linking jabs and low-growth Hand Slap/Headbutt records are not equivalent
to finishers. Ground Headbutt's sourced angle 270 drives into the floor;
its missing bury mechanic remains a separate known gap. High percent must not
silently turn a setup hit into a generic finisher when diagnosing source fidelity.

Only DK/Link currently author recipient `referenceLaunch` profiles. Against an
original Wolf/Bear recipient, the same native forward tilt uses fallback weight
100 and uncompressed ordinary-Matter flight: about 991 px over 71 displayed
frames. That inconsistency primarily makes ejection look slower in this sample;
it does not explain reduced travel. It remains an explicit integration gap,
not a newly established cause of the user's report.

## Match coverage and next diagnostic

The expanded grounded-move probe records actual selected move IDs and contact
payloads, including jab 1/2, all tilts, dash attack, all smashes and the four
grounded specials against DK, Link and Bear at 200%. The final
[42-scenario report](browser-all-moves-200/dk-knockback-acceptance.json) passes
**84/84 contact/selection assertions**, with zero page errors, on the existing
verified `index-B4ia6NWm.js` / `4ffde095…890f2` production bundle.
All three smashes, full punch and grounded spin lose the target's stock in each
tested matchup. Up tilt also contacts and KOs all three targets after placing
them at body-half-width sum + 1 px: DK 61, Link 54, Bear 58.5.
The earlier 65/60 px fixture missed the narrow targets by geometry; that is
not a percent-scaling failure. These checks cover grounded source attacks and
three recipients, not the complete roster or aerial moveset.

The [defender-input comparison](browser-all-moves-200/README.md#defender-actions-after-stun)
covers **24 scenarios / 48 passing contact/selection assertions**, with zero
page errors. At 200%, forward tilt and uncharged punch still lose stocks with
inward DI, an attack press or dodge in these fixtures. Inward DI followed by a
legal air jump and up-special lets DK/Bear return to the main floor with five
stocks by frame 400; Link still falls below. The DK victim first gets control
back near x1805-1829, well past the main-floor edge at x1360. This establishes
substantial offstage ejection plus available recovery; it is not a failed
launch or a hitstun cancel. A survival horizon is not proof of indefinite
survival, and automated defender inputs are not a human-feel evaluation.

The old public runtime cannot run the modern contact hook `applyHitDetailed`.
Its compatibility attempt in `browser-public-200/` records the served bundle
but **does not verify hosted match trajectories**. Do not present its failed
probe as a gameplay failure or a passing acceptance check.

To diagnose the user's match, identify its URL/engine bundle, stage bounds and
selected BASE/saved tune. Compare those with the recorded production identity
before changing source move values or declaring the report fixed. Current
production checks alone do not establish that the user has loaded this build.

The character skill's [integration verification instructions](../../../../.agents/skills/add-character/references/integration-verification.md#launch-and-ko-verification)
now require this build/stage/tune comparison and distinguish offstage ejection,
recovery and actual blast KO across ordinary attacks and recipient profiles.
The outdated keyboard-smash guidance was corrected to the current dedicated
`smash` → `attackHeavy` route (default P1 V / P2 Numpad 0). Skill validation
and reference checks pass. This follow-up changes the probe and evidence/workflow
only; it does not rebuild gameplay, publish the site or overwrite saved tunes.
