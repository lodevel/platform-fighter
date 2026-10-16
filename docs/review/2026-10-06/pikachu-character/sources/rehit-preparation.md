# Per-target aerial repeat contacts

Checked 2026-10-06. The pinned vanilla `pikachu/AttackAirF` records retain
`rehit=3` on all four continuous linker regions at source frames11–25. They
clear at26; frame27 is a new finisher with `rehit=0`. UFD linker damage1.3
is selected over the preserved native1.4; finisher damage4.8 is unchanged.

The [original Ultimate hitbox investigation](https://w.atwiki.jp/smashsp_kensyou/pages/146.html)
describes repeat intervals relative to the first contact: its interval5 example
can contact at10/15/20 or11/16. This supports separate target histories rather
than periodic global hit windows. The page was last revised2020-04-27; its patch
is unspecified. Its ID priority and bone-axis discussion also support the
existing minimum-ID selection and explicit non-root pose requirement. Inspection
used browser-extracted content; no raw HTML hash is claimed.

The [original hit-stop investigation](https://w.atwiki.jp/smashsp_kensyou/pages/88.html)
does not establish how this repeat timer ages during attack/victim hit-stop.
**Native repeat-clock parity remains missing.** The implemented reusable clock
contract is explicitly authored: the caller injects a nonnegative integer
gameplay frame; wall time and Matter substeps never age contact eligibility.
An unchanged clock does not allow another contact. A backwards clock for an
existing identity throws rather than silently resetting its history.

`AttackContactLedger` records only confirmed contacts, separately per logical
strike and target. `HitboxDamageHandler.setRehitClockLookup` supplies the clock
by attack owner body and actual live sensor. The caller can require that the
sensor belongs to the current marked action, preventing stale or detached
hitboxes from borrowing another action's clock. Regional
`AttackCollisionHit.rehitFrames` is selected with
the actual minimum-ID contact region. Missing clock for a positive interval
fails explicitly. Ordinary zero/absent intervals keep lifetime deduplication;
sensor replacement preserves history while a fresh action/finisher identity
starts independently. Rejected damage resolution does not start or renew the
interval. This implementation does not establish native hit-stop aging.

Validation: `npx vitest run src/match/HitboxDamageHandler.rehit.physics.test.ts
src/match/HitboxDamageHandler.test.ts
src/match/HitboxDamageHandler.collisionHits.physics.test.ts` initially passed84
tests. The later sensor-aware run also includes
`src/characters/pikachuFairClock.physics.test.ts` and passes89 tests.
Eight new actual-Matter scenarios cover both facings, five linker contacts and
one finisher, two targets whose first contacts differ by one frame, clear gaps,
physical sensor replacement,20 substeps with a frozen clock, rejected first
and repeat contacts, new action identity, required clock, reset, ordinary
deduplication and exact live-sensor ownership context. Stationary one-pixel
probes confirm geometry/timing/history;
they do not simulate target launch, native hit-stop or complete Pikachu gameplay.

`buildPikachuNormalMove('forward-air', undefined,
{ rehitClockPolicy: 'authored-attack-elapsed' })` now creates the continuous
linker with each native regional interval3 and distinct finisher interval0.
Default construction still fails. The explicit policy marker survives save/load.
Four additional Character/real-Matter scenarios pass both facings with the
actual `activeAttack.framesElapsed` lookup, with and without attacker hitlag5.
The two targets contact at elapsed10/13/16/19/22 and11/14/17/20/23, followed
by the finisher at26. Hitlag extends physical elapsed time without changing
these authored gameplay-clock outcomes. Five freeze frames are a test stimulus,
not a sourced Pikachu hitlag constant. Production MatchScene wiring now requires
the actual current aerial sensor and saved authored policy marker. Separate
[production acceptance](../fair-clock/README.md) passes8/8 both-facing scenarios
on bundle `index-v5AbW1PH.js`, including first-contact10/11, freeze0/5 and
detached-sensor rejection. These are DK fixture bodies carrying the exported
source move under the canonical fixture routing ID; no victim launch or
Pikachu roster/art acceptance is inferred. No global periodic strikes, approximate special
constants or playable-roster registration were added.
