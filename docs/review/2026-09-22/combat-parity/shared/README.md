# Shared combat modifiers and contact timing

Part of the [combined pass](../README.md). The pinned calculator formulas and
their integration call sites are archived with hashes in
[sources/provenance.json](sources/provenance.json).

## Damage and launch

Rage now rises from 1 at 35% to **1.1 at 150%**, replacing the local 1.15 cap.
Fixed launches remain independent of attacker rage and staling.

The nine-use stale queue now weighs newest-to-oldest matches by
**.09, .08545, .07635, .0679, .05945, .05035, .04255, .03345, .025**.
An absent move receives **1.05 freshness**. A shield contact contributes 85%
of its slot's penalty. History resets with the existing round/respawn contract.
One confirmed execution caches its initial factor across all victims/strikes;
projectiles and aerial Spin now participate in that identity contract too.

The full stale factor changes damage. Ordinary reference knockback uses the
resulting post-hit percent, but only 30% of the stale penalty changes the move
damage term inside growth: `baseDamage * (1 - (1 - stale) * .3)`. It no longer
multiplies the entire reference launch by staleness. Legacy vector launches
retain their documented local scaling until their records are converted.

## Hitlag, SDI and shield contact

Ordinary non-electric hitlag now follows the source damage formula, with a
30-frame maximum, authored hitbox multiplier and participant-count scaling.
The integration source explicitly supplies **post-stale damage** to hitlag.
The earlier generic tip/high-percent bonuses are removed. Crouching applies
**.85 knockback** and **.67 victim hitlag**; the direct attacker computes its
own freeze without the victim's crouch reduction. Detached projectiles freeze
the victim without freezing their owner.

Source hitlag/SDI multipliers survive windows, collision-hit selection, saved
character data and the Lab. Zero hitlag releases the queued launch on the next
simulation input step instead of leaving it stranded.

Ordinary victim SDI now follows the [Ultimate testing page's documented rules](https://w.atwiki.jp/smashsp_kensyou/pages/66.html):
**2 game units × stick vector × hitbox SDI**, converted at the project's 5 pixels
per unit; a **four-frame interval**, **16-pulse maximum**, and requests on newly
added cardinal input components. Partial-stick magnitude is retained. The first
request during cooldown keeps its sampled vector until delivery, following that
page's explicit input trace. A secondary overview instead describes last-input
buffering; this choice and the archived page are recorded in
[SDI provenance](sources/sdi-testing-provenance.json).

The **0.5 component threshold**, unit-disc input adapter, and fresh direction
state on each hit remain explicit project policies. Native stick thresholds
were not recovered. The [training-mod hook](sources/training-src-training-sdi.rs)
delegates ordinary players to the engine. ASDI, shield SDI, consecutive-ground-hit
bonuses, native collision clipping and grounded directional restrictions remain
unimplemented. Attacker-only freeze and zero-hitlag release do not trigger SDI.

Ordinary shieldstun now uses `floor(damage * .8 * category + 3) - 1`, with
categories **normal1 / smash.725 / aerial.33 / detached projectile.29**.
Zero damage causes no shieldstun. The old eight-frame cap is removed; the
existing maximum damage bound still limits pathological authored values.
Ordinary shield hitlag applies `max(hitboxMultiplier, 1) * .67`, with the
documented zero-hitlag exception. Release-parry freeze distinguishes direct
attacks from detached projectiles and gives the direct attacker extra freeze.
The [original parry testing record](https://w.atwiki.jp/smashsp_kensyou/pages/71.html)
also supplies the three-frame difference for matches with more than two players,
which the pinned calculator omits. The implementation retains the calculator's
cap convention and adds that measured multiplayer difference; the exact native
multiplayer cap remains unverified. Successful parries still have ordinary
shieldstun after freeze. Shield release input and protection through recovery
are documented in the [defense record](../defense/README.md).

Electric attributes, shield-poking/tilting, special shieldstun overrides and
the separate 1v1 damage bonus are not added by these ordinary-contact formulas.
Automatic chained parries, their longer input buffer, and separate attached or
direct-projectile attribute combinations remain outside the implemented parry
branch; it covers ordinary direct attacks and detached indirect projectiles.
The calculator's shield wrappers omit their player-count argument; this engine
uses the common participant scaling consistently for ordinary and shield hits.
Existing additive overlapping shieldstun remains a local policy unless a
native state-transition source establishes its replacement rule.

## Verification

`referenceCombatModifiers.test.ts` executes the unmodified archived calculator
functions as an independent oracle, including combined percent, weight, rage,
queue position, shield history and fixed launches. The zero shield-hitlag
exception and multiplayer parry offset use the separate testing record rather
than pretending the calculator contains those cases. Real-Matter checks cover
zero-hitlag release, SDI factors and stale-history reset. Production checks
use real resolver jab input against two recipients and compare the delivered
damage, knockback and separate attacker/victim hitlag to that calculator.

Earlier raw authored-launch fixtures intentionally omit MatchScene modifiers;
their traces are not represented as current fresh/stale production matches.
The combined pass's production probes cover the actual modified contact path.
The [final production report](production/shared-combat.json) passes all seven
scenarios on `index-DN4pX3Za.js`, with two confirmed recipients per swing and no
page/request errors. The [SDI regressions](sdi-tests.txt) pass 529 tests, including
real-Matter pulse timing, interruption reset and attacker-only freeze isolation.
Aggregate/build results are recorded in the [combined handoff](../README.md).
