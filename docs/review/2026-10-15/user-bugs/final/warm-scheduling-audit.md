# Link Final warm scheduling audit

Read-only source/evidence audit, 2026-10-15, after the user's resume. No app,
asset, build, driver or budget changes; no browser or heavy job was run. This
document does not qualify a new runtime result. The same-browser second-use
control was pending in the saved [pause record](../PAUSED.md); the coordinator
subsequently reports a fresh first-use 537.2 ms wall gap versus an 18 ms
second-use maximum, with a 4.7 ms owner upload only on first use and zero missing
owner drawings. That contrast supports the first branch below, without
isolating texture upload from other first-use state. Windows Edge baseline
verification remains necessary before choosing a production change.

## What the current host actually prepares

[`preloadMatchArt`](../../../../../port/src/match/preloadMatchArt.ts) decodes all
selected fighter and item sheets with six workers, waits for decoding, then
selects startup textures within `64 * 1024 * 1024` bytes. Idle/entry pages have
priority 0, Final startup pages priority 1; ties use asset-key alphabetical
order. The [match host](../../../../../port/src/ui/screens/match.ts) calls
`renderer.initTexture` for each selection before setting `ready`.

The actual [hardware fixture](hardware-link-final-raf/report.json) records:

| Prepared page | MiB (RGBA8 estimate) |
| --- | ---: |
| DK entry + idle | 5.069458 |
| Link idle + entry | 13.736267 |
| Pikachu entry + idle | 0.788574 |
| DK `final_air_start` | 37.468750 |
| **Total** | **57.063049** |

The six initial pages total **19.594299 MiB**. Alphabetical ordering puts DK's
**air** startup before its ground startup. After that air page, the remaining
6.936951 MiB cannot admit any other startup candidate. Link's `d04final` is
decoded but unprepared. This is deterministic selection, not a decode race.

The cap is a per-preload preparation allowance, **not a total GPU residency
limit**. [`TextureStore`](../../../../../port/src/engine/sprites/textureStore.ts)
retains the current roster's decoded bank and existing texture objects. Draws
upload other pages on demand; no Three.js eviction mechanism caps those later
uploads at 64 MiB. `preparedDuringLoading` reports host preparation calls; it
does not establish new allocation on every call, physical VRAM residency or
driver completion. A second activation must preserve its page/context and
record actual upload calls, rather than treat that diagnostic list as proof of
coldness. The separate `src/assets/textureResidency.ts` Phaser cache does not
govern this Three.js path.

## CPU submission is distinct from first GPU use

The installed Three.js implementation of `initTexture` calls the texture
binding/upload path and unbinds it. It does not render a sprite, compile a scene
or wait for a completed GPU frame. `TextureStore.fetch` creates an ImageBitmap
and a texture with linear filtering, no mipmaps and `needsUpdate = true`.
The normal presenter later flushes sprite quads and calls `renderer.render`.
The sprite layer uses a shared shader source with per-slot materials; a new
Final sheet alone does not imply a new GLSL source. Driver pipeline setup,
texture use and GPU/compositor scheduling can nevertheless have deferred cost.

In the first hardware Final, Link's actual `texSubImage2D` call takes **6.7 ms**
at age 1; its whole host callback takes **22.5 ms**. The **861.7 ms** observer
wall gap occurs later, from age 3 to age 9. The callback after that gap takes
**12 ms**, including 8 ms advancing simulation and 0.3 ms constructing views.
The owner is submitted at full alpha throughout all 109 active observations.
These observations establish a small synchronous upload and a large gap
outside the measured host callback. They do **not** establish that upload,
shader compilation, GPU execution, compositor scheduling or browser scheduling
caused that gap. Fast wrapped compile/link calls also cannot exclude deferred
driver work. [Hardware evidence](hardware-link-final-raf/README.md).

Moving `initTexture` earlier can remove the measured CPU upload from activation
and may move deferred work earlier. It cannot by itself prove that the large
wall gap has been removed. Likewise a hidden warm draw would be a separate
experiment; a zero-alpha/offscreen quad might be culled or fail to exercise the
same GPU path. Drawing or synchronizing during the measured gameplay interval
would contaminate the acceptance control.

## Concrete choices within the existing cap

The following calculations use the exact decoded dimensions in that hardware
report, without modifying art. They are alternative policies, not installed
changes or broad memory budgets.

| Candidate policy for this three-fighter roster | MiB | Tradeoff |
| --- | ---: | --- |
| Current: every initial page + DK air startup | 57.063049 | Link ground and air remain cold. |
| Every initial page + Link ground/air + Pikachu ground | 53.561462 | Targets both Link variants and preserves all intros; DK starts and Pikachu air remain cold. |
| Every initial page + Link ground + Pikachu ground/air | 53.812073 | Targets measured Link ground case and both Pikachu variants; Link air and DK starts remain cold. |
| Every idle + every ground startup | 61.179932 | Fits all ground starts, but abandons guaranteed preparation of every intro page. |
| Every initial page + DK/Pikachu ground | 63.898987 | A simple ground-before-air ordering still leaves Link cold. |
| Every initial page + smallest Final pages first | 52.039001 | Admits Pikachu ground/air and Link air; measured Link ground case still remains cold. |

All initial pages plus all ground startups need **76.608948 MiB**. All initial
pages plus both Link and both Pikachu variants need **64.748962 MiB**. Neither
fits the current cap, and reordering cannot change that arithmetic.

If evidence supports a warm experiment, preserve every initial page, classify
Final starts as ground before air, then admit smaller pages first within each
class with an explicit key tie-break. On this roster it admits Pikachu ground,
Link ground, then Link air, producing the **53.561462 MiB** row. This gives a
general rule with broader ground coverage rather than a hardcoded Link
exception. Merely sorting all priority-1 pages by bytes fails to prepare Link
ground: Pikachu's smaller air page consumes the needed headroom first.

Promoting only `char.link.d04final` ahead of other priority-1 entries would
produce the same selected pages on this roster, but encodes the current bug's
character rather than a general policy. The ground-then-size candidate is the
preferred neutral experiment. It preserves the cap, decode concurrency, source
pixels and initialization guarantee. It deliberately shifts which other
fighters get warm Final starts and leaves DK's larger ground/air pages cold;
describe that tradeoff rather than claim a universal scheduling fix.

No new warm draw, artificial GPU wait or background post-ready bank upload is
recommended as the first change. Post-ready uploads can merely move a stall
into another live gameplay frame. A staged loading draw or program-preparation
experiment becomes relevant only if upload-only preparation fails and evidence
still points to first GPU use; any render-target storage must be accounted
separately instead of calling the whole operation bounded by this texture cap.

## Decision after the repeat control

1. **Second use has no comparable gap and performs no owner upload:** first-use
   state is implicated, without isolating texture upload from driver/pipeline
   state. Run the narrow upload-priority experiment on a fresh page/context,
   then repeat exactly the same natural-RAF observation. Compare all initial
   preparation keys/bytes, age-1 CPU upload, later wall gaps and correctness.
   Attribute success only to the tested policy, not to a proven GPU root cause.
2. **Second use repeats the large gap without an owner upload:** the evidence
   weakens a texture-upload-only remedy. Keep application source frozen and
   investigate a bounded scheduler/GPU timeline or external-load control before
   changing warm policy. Increasing the cap would not follow from this result.
3. **Fresh first use is now smooth:** retain the original failure and report the
   nonreproduction. A single smooth rerun does not justify promising a warm
   policy fix. Keep policy unchanged pending a reproducible contrast or user
   retest on their browser.

The user decision is which guarantee matters when these pages compete: keep all
intros prepared and target Link's startup, or favor all ground Final starts at
the expense of some intro preparation. Any cap increase, whole-roster art
budget, further DK/Pikachu art transformation, KTX quality-policy change or
full-bank encoding remains outside this audit. Windows Edge is installed at
version 155.0.4283.45, per the coordinator's file-version
check; that does not establish the version used in the user's original report.
Preserve both failing Link KTX pilots and the distinction
between measured RGBA payload and physical memory, as required by the
[memory audit](../MEMORY-AUDIT.md).

## Windows Edge baseline follow-up

The [new Windows Edge baseline](edge-link-repeat-raf/report.json) uses installed
Edge **155.0.4283.45**, a disposable TEMP profile and its actual **Intel Iris Xe
D3D11** context. No adapter was forced; this is a different hardware/browser
path from the earlier WSL NVIDIA run. First activation has a 119.1 ms maximum
wall gap at age 60→61, with a 116.5 ms host callback and an observed 118 ms long
task. Second activation's maxima are 19.3 ms wall and 14.7 ms host. The owner
upload is 8.6 ms at age 1 on the first activation and absent on the second; the
same native texture ID persists. Missing owner drawings remain zero.

This is a first-use contrast, but the largest Edge cost now falls **inside the
shooting host callback**, unlike the earlier NVIDIA age 3→9 outside-callback
gap. Initial owner upload and this age-61 cost must not be conflated. A warm
priority experiment can move the age-1 upload; improvement of the later spike
remains unproven. Broader GL/host profiling is the appropriate next Edge
diagnostic before interpreting an upload-only policy as the repair.
The user also reports that Link's start-of-match animation is now smooth in
Edge. No preload priority change is recommended from the shooting evidence;
the policies above remain contingency calculations rather than a proposed
production edit.

[`windows-edge-cdp.mjs`](../../../../../tools/windows-edge-cdp.mjs) supplied
the binary PowerShell TCP relay between Windows loopback 9223 and WSL loopback
9224. The launch used the installed executable with `--headless=new`,
`--no-first-run`, `--no-default-browser-check`,
`--remote-debugging-address=127.0.0.1`, `--remote-debugging-port=9223`, its unique
`--user-data-dir`, `--window-size=1280,720` and `about:blank`. CDP version and
browser UUID were checked across the relay before the harness connected. The
bridge held the shared heavy lock throughout the attached run. After the
harness closed its context, bridge shutdown reported `profileRemoved: true`,
terminated only owned Edge processes and exited 0, releasing the lock. Existing
user profiles/processes, firewall rules and persistent system settings were
untouched. The helper passes `node --check`; the baseline itself exercises its
bidirectional WebSocket transport and cleanup.
