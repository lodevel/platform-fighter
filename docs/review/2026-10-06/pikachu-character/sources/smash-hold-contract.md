# Pikachu smash damage cap and continued hold

Inspected 2026-10-06; this is a contract audit. No runtime or builder numbers were
changed. Machine-readable provenance is in [smash-hold-contract.json](smash-hold-contract.json).

The pinned vanilla fighter table has distinct fields on all three Pikachu
smashes: `hold_frame=60`, `hold_keep_frame=120`, and maximum damage multiplier1.4.
The table's game patch is unknown. These are separate captured numbers;120 must
not replace the damage interpolation cap60.

The current consumer uses `ChargeSpec.maxChargeFrames` for both damage saturation
and forced release. `chargingSmash.framesHeld` increments until this cap, then
`fireSmash` runs. Prepared Pikachu smashes therefore fire at60 charged steps.
There is no second keep counter. The pure charge helper saturates at60 correctly,
but its documentation about continuing to hold past the cap is not implemented
by this smash input consumer. Startup progresses to the authored pause frame
before incrementing held steps; leaving ground drops the pending charge.

The [Japanese validation wiki](https://w.atwiki.jp/smashsp_kensyou/pages/36.html)
reports a180-frame maximum hold, power saturating at60 with multiplier1.4, and a
stationary pose after saturation. This page last changed2021-03-03; its section
does not link raw measurements or an exact patch. It corroborates the proposed
gameplay contract rather than supplying independently captured vanilla code.

A [pinned WuBor common hook](https://github.com/WuBoytH/The-WuBor-Patch/blob/9d5e5cf90d7d686f5ab367a92789019c05574dec/fighters/common/src/status/attack/attack_4.rs#L470)
decrements `SMASH_LOOP_FRAME` until zero and stops charge physics at that boundary.
Only subsequent calls decrement `SMASH_HOLD_KEEP_FRAME`. That implementation
uses sequential timers and supports the inference60+120=180. The captured file
[smash-hold-wubor-attack4.rs](smash-hold-wubor-attack4.rs) is a mod replacement;
neither its initialization nor its fidelity to vanilla is established here.
The inspected [HDR file](smash-hold-hdr-attackx4.rs) does not replace the timer
loop. No mod numeric values have been substituted for the vanilla table.

Hold placement also needs a clock contract. UFD says charge hold9 for forward
smash and2 for up/down smash. Native ACMD raises `START_SMASH_HOLD` at motion10
and3 respectively. The builder currently converts the UFD note to elapsed8
and1. Whether the note names the preceding paused pose, and when status exit
captures its restart frame, must be reconciled before claiming exact input
timing. The captured flag and UFD note are preserved separately in the JSON.

The proposed consumer contract separates power elapsed from total held elapsed,
saturates damage after60 steps, continues holding for an additional120 steps,
and resumes the same smash motion on release or total expiry. Full-power holding
must keep the paused pose and reference launch metadata. This is a corroborated
proposal; native common initialization/expiry and clock conversion remain gaps.
Required acceptance would cover tap/partial release, release at60/61/179,
forced release at the verified expiry, both facings and all three directions,
damage cap without further growth, held pose, interruption, save restoration,
and physical keyboard/gamepad input. None is claimed by this source-only audit.

Focused vanilla-common follow-up checked the current upstream and both public
forks using complete, untruncated recursive trees. Current upstream remains the
original413d42149 pin, contains33,085 paths, has only the master branch and has
no tags/releases. LilyLavender's d02ff666 fork has33,085 paths; zrksyd's b6bb1fec
fork has28,071. None contains a common/fighter-common NRO path. The upstream
[capture README](status-capture-README.md) explicitly lists `lua2cpp_common.nro`
as missing.

Eight pinned vanilla per-fighter hold wrappers were captured under
`smash-hold-native-delegates`. Game&Watch/WiiFit invoke common up-smash hold;
Inkling invokes common down-smash hold initialization/main; Ness invokes common
up/down hold; Peach invokes common smash initialization and a local helper that
sets Peach's smash-item work slot. That helper was captured separately. These
real game wrappers confirm delegation but expose no common timer
initialization, countdown or expiry implementation. They do not resolve the
Pikachu flag/paused-frame conversion and are not used as Pikachu numbers.

A separate [matching decompilation](https://github.com/sbergeron42/ssbu-decomp/tree/d55c91c94d18ee476bd7ffb596cedc3259c5e9f0)
targets the13.0.4 main binary. Its complete1,286-path tree has no common NRO;
the function index and selected fighter/parameter sources did not supply the
missing hold functions or Pikachu special parameters. Its README explicitly
distinguishes verified, unmatched and inferred code; no reconstructed stub was
accepted as vanilla mechanics. Repository searches also found no new vanilla
Pikachu `vl.prc` capture.

The exporter author documents an anonymous
[Ghidra research server](https://coolsonickirby.github.io/Smash-Ultimate-Documentation/Reverse%20Engineering/Ghidra/)
for omitted functions. This environment has no Java/Ghidra client, and those
functions have not been acquired. Endpoint access instructions do not constitute
a captured native implementation. Exact search provenance, tree/response hashes
and all nine native artifact hashes are in
[smash-hold-common-source-search.json](smash-hold-common-source-search.json).
The previously stated gaps and inferred180-frame contract remain unchanged.
