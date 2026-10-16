# Pikachu down air and landing: scoped runtime evidence

Twenty-two rough airborne drawings and seven landing drawings have manual output
reviews and fixed2048x1536 canvases/root1024,1152 at70/600worldpx per source pixel.
[Art approval](art-approval.json) pins30files including neutral. Landing-turn
attempt1 was rejected because its nose resembled a third eye; a reviewed local
ComfyUI mask correction produced accepted attempt2 without changing any pixel
outside the mask. Inputs, graphs, raw/final outputs and reviews remain in `../art`.

The [contact review](../sources/posed-resources/down-air-contact-review.json)
pins13native-derived neck projections. Game14..15 preserve13damage,270angle,
base16,growth86,radius27.5worldpx. Game16..26 preserve12damage,361angle,base20,
growth84,radius28.5. Geometry/payload replacement keeps one strike identity.
Source landing game1..2 uses a ground-only4damage capsule from(-30,5)to(30,5),
radius20,angle361,base50,growth100; game3 clears. Air lasts47unfrozen steps;
a non-autocancel touchdown replaces it with the22-step landing action.

Explicit drawing windows and348authored receiving capsules survive nested JSON
serialization and saved-factory input routing. All29actual final/capsule comparisons
were inspected in [geometry review](hurtbox-preparation/guide-review.json).
Receiving radii are a conservative maximum-world-column calibration, with broad
hip/head/tail coverage beyond contours. Flat landing head capsules extend below
floor-facing art; native radius/status/virtual spheres remain unresolved.

The immutable [build](../down-air-preview-build.json) serves the
[preview](http://127.0.0.1:4193/pikachu-down-air-preview.html) with bundle
`pikachu-down-air-preview-BUaa2EpS.js` and30servedPNG hashes.
[Browser acceptance](browser/acceptance.json) passed32airborne cases across direct
and saved inputs, both facings, automatic hit-stop on/off and near/last/edge/miss.
Near hits13damage at elapsed13; last hits12at25; outer edge hits12at20.
Sixteen actual shared-gravity floor descents verify contact/clear,22-step landing
commitment and release. Four late descents autocancel without landing contact.
The same exact build passes754incoming capsule-centre/outside probes, four manual
freezes, two synthetic5damage interruption/launch checks and pause. No browser errors.
F/N and pointer controls are simulated browser input; F invokes actual Character
heavy-down C-stick routing. This is a shared40x50/Wolf movement fixture, not native
Pikachu movement or human-controller evidence.

Root inspected all58actual Canvas captures, both facings, in eight review galleries.
[Visual review](browser/visual-review.json) pins all capture/gallery hashes and
records rough-art limitations. The head-first barrel spin, source contacts/clear,
mirrored receiving geometry and landing squash/rise are visible. Fixed floor root
rests within0.25worldpx tolerance. Landing ear/outline alpha extends up to5.37worldpx
below that root in flat/rise drawings; final grounded art registration still needs
resolution before complete-fighter acceptance. No per-pose bottom alignment was used.

Separate authored electric/cheek glyphs follow native activation/off clocks and
pose-held head anchors. Browser checks cover every boundary and scale/anchor;
native particle shape,NO_STOP continuation, flash3/impact14 one-shot resources and
durations remain unqualified/missing. They are independent of contact geometry.

A fresh TypeScript check and44focused tests passed:28source projection/actual-Matter
contact tests, five direct/saved landing physics/schema tests and11shared explicit
animation/saved-aerial routing tests. Complete Pikachu remains partial: dedicated Pikachu packed
Dair/landing routes, character movement/body, roster, full Lab/save-use-in-match,
remaining moves/states, special source gate and native collision qualification remain.

### Packed continuation

Packed shared Match-driver fixture now passes32airborne,16real-floor,4autocancel,754incoming and4freeze checks,33servedPNG hashes and zero page errors. All58actual Canvas captures were manually inspected. Presentation-only Link aliases do not change Wolf saved/physics fixtures. Existing landing overlap remains explicit. See [pinned actual runtime inspection](packed-browser/visual-review.json). Full Pikachu match/roster integration and native status/root/radius/patch qualification remain pending.
