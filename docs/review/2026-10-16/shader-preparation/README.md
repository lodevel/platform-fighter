# Loading-time effect shader preparation

Continued the saved Edge first-use stall investigation. Current preview:
`http://localhost:4173/platform-fighter/`, bundle `game-CICNsKxD.js`, identity
`platform-fighter-sha256-65ef0281344a8c518aa692079306459650886d83b531721991c3f684a2f487aa`.
The previous B95 build remains archived in `.tmp/b95-before-shader-preparation`.
The pre-repair server remains stopped and its separate files unchanged.
The [qualification index](qualification.json) records the exact candidate and
scoped outcomes.

The [previous Edge profile](../../2026-10-15/user-bugs/final/edge-link-first-profile/README.md)
observed a 35.5 ms shooting callback at Link Final age61, including 30 ms inside
Three r170's first-use `getProgramInfoLog`. This change reserves the actual
normal/additive effect materials during loading, compiles their scene, waits
for KHR completion where available and performs first-use uniform/attribute
initialization and link validation before match readiness. Both PNG preparation
and shader preparation must finish before simulation starts. No warm-up art is
drawn. Disposal and host faults cancel polling; context loss, failed links and
polling timeout reject preparation through the existing recoverable match UI.
The ten-second deadline bounds asynchronous polling, not a blocking native GL
call. Without KHR the first-use synchronization happens during loading.

The program inspection uses Three's exposed `renderer.info.programs` and program
methods, including retained stage programs, rather than assuming there are
exactly two native programs. Normal/additive shape materials share their GLSL
variant on the tested renderer. The pinned Three version is unchanged.
Diagnostic checkpoint restoration acquires replacement material references
before disposing the previous view, preserving the already prepared program.

## Actual Edge result

[Two natural-RAF Finals](edge-final/report.json) ran in Windows Edge
155.0.4283.45 on its actual Intel Iris Xe / D3D11 context. The disposable
profile was removed and owned browser processes stopped; see
[launch](edge-final/bridge.json) and [cleanup](edge-final/cleanup.json).
No screenshots, manual stepping, forced drawing, readback or evaluation polling
occurred during either observed Final. Passive GL wrappers and CPU sampling
add overhead. Saved DOM special bindings activated both Finals.

| Measurement | First Final | Second Final |
| --- | ---: | ---: |
| Shooting age61 host callback, first observation | 7.5 ms | 5.0 ms |
| Startup observer wall gap median / p95 / maximum | 6.9 / 9.6 / 26.7 ms | 7.0 / 9.6 / 11.2 ms |
| Maximum startup host callback | 25.2 ms | 7.8 ms |
| Active owner observations / missing submissions | 333 / 0 | 335 / 0 |
| Owner sheet upload | 6.2 ms at age1 | None; same native texture |
| Shape first-use query during activation | None | None |

The actual effect program ID12 completed its first-use query during loading
(0.2 ms), then was used at age61 of both activations. No replacement shape
variant was compiled during either Final. The maintained harness asserts
loading-time validation, no activation-time query/recompile, valid shader links,
owner visibility, no context loss and native texture reuse. CPU profiles are
retained beside the report.

The initial prepared texture list remains **57.063 MiB**, under the existing
64 MiB preparation allowance. Link's owner sheet is still uploaded on first
use; this experiment does not raise the cap, change texture selection, transform
art, disable shader diagnostics or claim a total GPU-residency limit. The first
remaining 26.7 ms observer gap coincides with the age1 host/upload. There were
no observed long tasks during either activation. Two resource 404 console
messages are retained separately; the lifecycle probe identifies Edge's
automatic `/favicon.ico` requests as the same two messages. No shader errors or uncaught page errors
were recorded.

The earlier profile and this run are separate browser launches with potentially
shared driver caches and different external load. Their timing difference alone
is not a controlled performance guarantee. The stronger result is the directly
observed migration of the specific first-use query into loading, with the same
program reused during gameplay. The unknown original unrecovered-freeze trigger
and human Edge/controller/Final acceptance remain open.

## Verification

Type/layer checks, 17 focused preparation/lifecycle tests and production build
pass; [commands and output](build-and-focused-tests.txt). The [full suite](full-tests.txt)
passes **557 files / 12,075 tests** in 112.92 seconds. The standalone artifact
includes all **723 runtime assets**, copied after that build.

The [existing eight production recovery cases](recovery/report.json) pass on this
exact candidate: aborted PNG/retry, reconnect to a new pad index, retaining a
manual pause, a frame error/restart, actual context loss/restore and cleanup
failure/menu navigation. These use actual keyboard/UI routes and a simulated
controller API. The recovered title screenshot was inspected. The maintained
tool's old image-error assertion was updated to the new combined preparation
message; the failed assertion before that correction is retained in
`recovery-old-message-assertion.json`. No recovery behavior was weakened to pass it.

A separate pending-compilation lifecycle fixture initially could not hold KHR
completion in SwiftShader because that renderer genuinely lacks the extension;
`lifecycle-swiftshader-no-khr.json` records that failed capability assumption.
The normal no-KHR loading/recovery path is exercised by the eight-case suite.
The pending-KHR cases therefore run against actual Windows Edge with its native
extension, rather than a fabricated completion API.

All [four Edge loading lifecycle cases](lifecycle/report.json) pass on the exact
candidate: native completion held while simulation stays at frame0, leave while
pending with polling cancelled and no fault, an explicitly injected link failure
followed by restart, and actual context loss while pending followed by native
restoration/restart. Reserved shape programs have zero warm-up draws before
readiness. Each case records the exact bundle hash and source identity; only the
test context and its disposable browser profile were closed/removed.

Two fixture corrections are explicit: optional same-origin `/favicon.ico` 404s
are recorded as expected rather than hiding all resource failures, and context
loss accepts either exact first-fault owner. Polling can detect `isContextLost`
before the asynchronous canvas event; either must stop preparation at frame0,
cancel polling and expose working recovery. The final run observed the renderer
event first. Diagnostic receipts retain the earlier over-specific expectations;
production source did not change to satisfy them.

Source changes are limited to effect reservation, bounded shader preparation,
match readiness/fault/disposal wiring and replacement-view ownership. Fighter
data, sprites, simulation code, texture budgets, compression and gameplay
timelines are unchanged. Earlier B95 fighter/menu/replay receipts remain evidence
for that earlier build; they are not silently relabeled as new-candidate runs.

Link KTX2 quality/runtime work, general memory policy, optional cleanup, local
commit and broader play acceptance remain separately open as recorded in the
[existing audit](../../2026-10-15/user-bugs/PLAN-AUDIT.md).
