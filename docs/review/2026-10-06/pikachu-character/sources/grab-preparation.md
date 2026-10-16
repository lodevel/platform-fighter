# Pikachu grab and throw preparation

Checked 2026-10-06. `src/characters/pikachuGrab.ts` prepares sourced standing,
dash and pivot grabs, pummel and all four throws. It does not register Pikachu
or establish animation/collision match acceptance. Source fields and commands
are retained in `native-grab-records.json`, extracted from the verified native
captures by `tools/pikachu-source-grab-extract.py`.

| Action | Selected UFD contact/release | Total | Prepared elapsed/recovery |
| --- | --- | --- | --- |
| Standing grab |7–8|36|startup6, active2, whiff28|
| Dash grab |11–12|44|startup10, active2, whiff32|
| Pivot grab |12–13|39|startup11, active2, whiff26|
| Forward throw |11/15/19/23 prehits, release30|43|prehits10/14/18/22, release29, recovery14|
| Back throw |release26|49|release25, recovery24|
| Up throw |14 prehit, release16|35|prehit13, release15, recovery20|
| Down throw |release29|51|release28, recovery23|

All six root-bone CATCH capsules retain the actual separate ground/air radii,
endpoints and masks. Pivot native negative z is relative to its old facing;
the runtime turns to its new facing on entry, so the prepared x coordinates
change basis. Original source positions remain unchanged in the raw records.
The shared root conversion's scale5 and height25 are authored; sprite fitting,
capture pose, held-target offset and native movement comparison remain pending.
The bounding rectangle is only an envelope over exact capsule contacts.

Throw-kind ABS rows supply release damage/launch: forward2/45°/KBG110/BKB55,
back9/135°/KBG50/BKB85, up5/90°/KBG129/BKB48 and
down5/83°/KBG100/BKB60, all with FKB0. Separate catch-kind ABS records do not
become added release damage. Character reverses facing for back release;
the runtime back row therefore expresses native135° as equivalent45° relative
to that reversed basis. Its reference launch is numerically checked against
native135° in the original basis for both facings. Raw135° stays in provenance.

Forward throw explicitly marks all four2damage prehits catch-only, hitlag factor0,
and totals10damage including its2damage release. Up throw marks its3damage
prehit catch-only, factor1.6, then releases5 for total8. They use the shared
`ThrowSpec.heldTargetHits` consumer; ordinary collateral geometry is not inferred.

Down throw is an unresolved clock reconciliation: UFD29 is selected explicitly,
while both the pinned native script and the independent13.0.1 export apply ABS
at motion21. Native ATTACK3 at14 clears in the same execute block and has a
zero-duration extracted interval. It cannot establish a successful prehit;
UFD displays only5. No held-target3damage event is fabricated.

Pummel retains damage1, source hitlag multiplier1.3, SDI1 and launch metadata.
UFD16 total explicitly includes11 hitlag frames. Its prepared elapsed startup0
corresponds to source frame1; cooldown16 includes that fixed11 freeze, which the
shared consumer subtracts before its ordinary cooldown ticks resume. The raw
`trans` contact geometry remains unprojected, rather than inventing a pose.
Scalar pummel delivery targets only the held victim; native animated geometry
and full input cadence still require running-game verification.

`buildPikachuGrab` requires caller-supplied `holdFramesMax`,
`escapeRecoveryFrames` and `dashMomentumRetain`. Those are explicitly authored
engine policy, not native parameters. No vanilla hold/mash-out formula, escape
cooldown or grab-entry velocity parameter was obtained; fixed-cap behavior is
not source parity. The current engine applies dash momentum policy to pivot
entry too. Per-throw sourced recovery replaces the general escape cooldown on
throw completion.

Validation: `npx vitest run src/characters/pikachuGrab.test.ts` passed14 tests.
These compare all native catch regions, source/UFD clocks, exact capsule edge
and mask behavior, catch-only damage totals, ABS-kind separation, pummel data,
explicit policy requirements and both-facing back-launch equivalence. Normal
preparation's six Matter probes are recorded separately. Full grab/throw input,
animation, holding and release behavior is not claimed by these source checks.
