# Pikachu normal and aerial preparation

Checked 2026-10-06. `src/characters/pikachuNormalMoves.ts` prepares 16 typed
normal/aerial records, including up/down forward-tilt variants and separate
back/down-air landing contacts. Jab remains the separately prepared source helper.
These records are outside the playable roster and do not establish a complete
fighter, pose parity or match acceptance.

UFD supplies ordinary attack totals, active intervals, landing lag and autocancel.
The pinned native captures supply full regional damage/launch/geometry metadata,
clear/replacement boundaries and smash charge parameters. Both clocks agree for
the normal contacts in this preparation; their captured game functions have no
motion-rate changes. UFD inclusive frame ranges become elapsed `[first-1,last)`.
No conversion is applied to unrelated special/entity clocks.

Forward smash keeps one strike identity through source geometry changes at motion
frames15/16/17/18/20/24. Up-air clean/late regions also share one strike identity.
Nair, bair and down-smash clear-separated contacts receive distinct identities.
Down smash includes its sixth contact at frame23, which UFD's activeframes field
omits but its startup list and the native capture retain.

Current UFD damage takes precedence for nair linker1.7, fair linker1.3 and bair
finisher3.5. Their pinned native1.8/1.4/3.6 values remain unchanged and explicitly
accessible. No established patch explanation is inferred.

Non-root regions require an explicit `PikachuPoseProjector` for every active
frame. Missing `kneel`, `hip`, tail, neck or `trans` projection throws rather than
using an anatomy guess. The test-only projector exercises dispatch; it is not
Pikachu's pose. Root projection still uses the source helper's authored scale5
and root-below-body-centre25, so even root-only records need art/hurtbox fitting
and running-game comparison before collision parity can be claimed.

Fair retains continuous link interval11–25 and native per-target rehit3. The
frame sampler exposes that rule only on the linker, not the finisher. The runtime
move builder refuses fair by default because the native timer's hit-stop behavior
has not been verified. Explicit `rehitClockPolicy: 'authored-attack-elapsed'`
opt-in builds regional rehit3 on the continuous linker and rehit0 on the separate
finisher. The policy marker survives save/load; the shared handler must explicitly
receive the actor's elapsed attack clock. The per-target ledger is not a periodic
global window. Both-facing real Matter probes execute that authored clock and
confirm that attacker hitlag pauses it. This is authored clock behavior, not
verified native hit-stop parity.

Native smash damage caps at60 charged frames, multiplier1.4, with a separate
keep-time parameter120. UFD labels the hold frame9 for forward smash and2 for
up/down smash; native ACMD raises the hold flag at10/3 respectively, so the
paused-pose/flag conversion remains unresolved. The specs retain both charge counts, but the current
charge schema equates damage cap with maximum hold/auto-release. The prepared
builder's charge fields do not implement the separate keep-time rule; full
hold/release input verification remains pending. Regional reference launch
metadata is preserved while charged damage scales, rather than multiplying
native KBG/BKB/FKB.
See [smash-hold-contract.md](smash-hold-contract.md) for the sequential-timer
corroboration and exact current consumer limitation; no numbers were changed.

The aerial schema now consumes optional automatic `landingAttack` records on
actual touchdown outside autocancel. The source builder attaches back/down-air's
native root contacts at game1–2, clear3, and landing commitments18/22. Contact,
animation selection and hurtbox modifiers share that elapsed landing clock;
hitlag pauses them together. Save/load and factory restoration retain the nested
route. See [landing-attack-runtime.md](landing-attack-runtime.md) for actual floor
contact, miss, clear, action-boundary and interruption checks. Art/pose acceptance
and native anatomy geometry remain unverified.
Autocancel's returned zero is the move-specific aerial penalty; native ordinary
landing commitment is a separate engine requirement. Native regional trip
bonuses and setoff flags now pass through authored rows, selected collision
regions and serialization. [The source runtime contract](combat-trip-clank/runtime-contract.json)
and [actual seeded match evidence](../integration/trip-clank-retry/trip-clank-match-observations.json)
qualify grounded/no-lift trip decisions after hitlag and current direct normal
melee clanks. Native trip recovery, native rebound body motion and
special/projectile/article clank consumers remain unresolved. Other unsupported
regional metadata remains accessible as raw source rows.

Validation: `src/characters/pikachuNormalMoves.test.ts` passed31 tests and
`src/characters/pikachuNormalMoves.physics.test.ts` passed6 tests, and
`npm run typecheck` passed. Thirty tests compare captured UFD/native data and
schema behavior, with an additional explicit fair clock opt-in test. Six real
Matter contact probes verify, in both facings,
forward smash's single hit through moving replacements, its late damage and
beyond-edge miss, and down smash's six source-clear-separated strikes. Targets
are stationary one-pixel probes, with confirmed contacts recorded without
target knockback or hitlag. This verifies regional contact/group behavior,
not launch outcomes, fighter inputs, animated hurtboxes or match completion.
