# Restart handoff — resumed

**2026-10-16:** continued the measured Edge first-use shader stall repair.
The preview now serves `game-CICNsKxD.js` / `65ef0281…87aa`; the source-freeze
and pending-control statements below describe the older checkpoint. Read the
[current continuation](../../2026-10-16/shader-preparation/README.md) for changes,
actual Edge results and current qualification. The original freeze trigger and
broader human acceptance remain unresolved.

The user resumed this work with “continue” after restarting the PC and
confirmed **Edge** as the browser used for the reported problems. The repair
preview is running again on 4173. The pre-fix server on 4301 was restarted for
comparison, then stopped at the user's explicit request; its frozen files are
retained. The pause instructions below are historical, superseded by that
resume. Application source still matches the saved B95 identity.

The [same-context RTX repeat control](final/hardware-link-repeat-raf/report.json)
now completes: first startup has a 537.2 ms wall gap, second startup 18.0 ms,
with no owner reupload or deletion on second use. This supports investigating
first-use rendering state, without isolating an upload/driver cause. A Windows
Edge control is in progress; the WSL result does not establish Edge behavior.

2026-10-15, approximately 18:05 Brussels. The user needs to restart the PC and
explicitly requested pausing all work. Do not resume until the user asks.
All diagnostic jobs, queued heavy jobs and child browsers are stopped. Three
specialists have finished or acknowledged the pause. Preview servers may still
run until restart; they are not background development jobs.

## Saved state

Project: `/home/lombet/Workspace/platform-fighter`. Work is saved on disk,
uncommitted; no push or cleanup deletion occurred. Do not reset the dirty tree.
Read `AGENTS.md`, [repair status](README.md), [qualification](qualification.json),
[plan audit](PLAN-AUDIT.md) and [memory audit](MEMORY-AUDIT.md).

Current production build is `game-B95Fcp5p.js`, identity
`platform-fighter-sha256-74c2fec99c76cdc7942171c69ff8c02f7c207d50263dffea93787a7d94040101`.
Application source remains frozen at that identity. Type/layers/build/static
723 assets and all 554 files / 12,062 tests pass. Menu, scoped fighter, item and
flight checks are recorded. Nine replay checks / 22,200 frames match, with the
two source identities and presentation-only difference explicitly recorded.

Approved lossless DK/Pikachu packing is installed: 2,495 logical drawings,
visible pixels, alpha, ROOTs and timing preserved; combined decoded sheets
876.60 MiB instead of about 2,043 MiB. Runtime LINEAR raster output has small
documented edge differences despite exact reconstructed source pixels and
nearest-filter GPU parity. No thinning/rescaling/lossy compression of these
fighters is approved. Link KTX2 quality2 and quality4 idle pilots both FAIL the
original quality gate; PNG stays in production and KTX runtime remains absent.
Do not silently lower thresholds or call the whole plan accepted.

## Reference machine and latest performance findings

The user confirmed **this PC is the reference machine**. Read-only system checks
find about 32 GB RAM and an RTX 4070 Laptop GPU with 8,188 MiB VRAM, plus Intel
Iris Xe. The user's browser is unconfirmed. No general numeric art/memory budget
has been agreed; discuss it before changing policy.

Default headless Chromium used SwiftShader. Real RTX rendering is available
with the process-local recipe in [GPU environment evidence](gpu-environment/README.md).
No driver install, persistent setting or app change was needed.

- [Hardware Inferno head control](final/hardware-inferno-knockout/report.json):
  25 on-screen native flight draws for each of DK/Pikachu/Link, no missing bodies,
  about 1.5805 seconds visible. Maximum observed frame gap 362.3 ms at the first
  accepted flash draw. Visibility passes; do not claim every frame is smooth.
- [Hardware Link first Final](final/hardware-link-final-raf/report.json): actual
  D3D12/NVIDIA context asserted; 109 active draws across 120 ticks. Median RAF
  16.4 ms, p95 23.4 ms; host max 29.3 ms; actual owner upload max 6.7 ms. A cold
  age3→9 wall gap of 861.7 ms remains outside the measured host CPU work. Its
  cause is unresolved. The 373 ms shooting host spike from SwiftShader does not
  reproduce on hardware.
- The original user unrecovered-freeze trigger remains unknown. Recovery
  hardening and stress liveness pass within their documented scope.

## Next work when the user resumes

1. Use the existing specialists (`matchsim`, `pikachu_final`, `port_live`) as
   appropriate. User explicitly requires agents. Serialize heavy jobs using
   `.tmp/dk-heavy.lock`; keep file ownership and source/build freeze coordinated.
2. Run one bounded **same-browser second-activation control** for Link Final on
   real RTX, without screenshots or evaluation polling during observation.
   This control was **not started** before pause. Compare first-use against
   already uploaded owner texture and actual shader/driver residency; establish
   whether the startup gap repeats before editing application source.
3. Review warm scheduling only after that evidence. Current initial GPU-warm cap
   is 64 MiB. Ground startup sheets total 57.015 MiB (DK33.984 + Pika10.320 +
   Link12.710); all idle/entry sheets add 19.594 MiB, total 76.609 MiB. Thus merely
   reordering cannot warm all ground starts plus all intros within 64 MiB.
   No cap increase or new budget has been approved/agreed. Discuss measured
   policy with the user; do not invent a settled budget or thin drawings.
4. User retest of the repaired build is still needed, especially freezes,
   ordinary violent launches, intro/Final feel and appearance. Ordinary-launch
   disappearance was not reproduced; the Inferno missing flight had a concrete
   cause and implementation fix. Keep these distinctions.
5. KTX runtime/quality strategy, general skill memory gate, cleanup choice and
   local commit remain open. Existing approval covers DK/Pikachu lossless
   packing only. Retain failing pilot evidence; no full-bank encode is queued.

## Relaunch after PC restart

Run from the project root in separate terminals. Saved `dist` is the repaired
candidate, so no rebuild is required just to play it:

```bash
npm run preview -- --host 0.0.0.0 --port 4173 --strictPort
```

Play `http://localhost:4173/platform-fighter/`.

The exact pre-fix copy is independent and must remain unchanged:

```bash
python3 -m http.server 4301 --bind 0.0.0.0 --directory .tmp/pre-user-bugs-2026-10-15
```

Play `http://localhost:4301/platform-fighter/`. It serves `game-BYOl1XlT.js` /
`aedf4dbb…af86`, copied assets and the private Inferno head image. Do not point it
at current source/assets or overwrite it with a new build.
