# Pikachu up air: isolated animation and collision

Eleven accepted rough drawings and132authored receiving capsules follow26fixed
gameplay steps. Every active frame has a separate drawing; noncontact phases use
explicit sparse holds. [Art approval](art-approval.json) pins the PNG hashes.
[Primary contact review](../sources/posed-resources/up-air-contact-review.json)
preserves15projected tail regions from captured ordinary native matrices.

Source frames4..6 keep damage6/6/5, angle68, base50 and growth113. Frames7..8
keep damage4/4/4, angle55, base40 and growth80. Tail radii remain20/25/20worldpx.
The early tip centre overlaps the higher-priority middle region; independent
physics probes also check the exposed tip for its own5% payload. Geometry changes
share one strike identity, so a target receives one hit across replacements.

The immutable [build record](../up-air-preview-build.json) identifies the
[preview](http://127.0.0.1:4189/pikachu-up-air-preview.html), bundle, source identity
and12servedPNG hashes. [Browser acceptance](browser/acceptance.json) passed16outgoing
scenarios across both facings, ordinary automatic hit-stop on/off and near/last/edge/miss
placements; near hits6% at elapsed3, late/edge hit4% at elapsed7. It also passed286
incoming centre/outside probes, two manual freezes across the early/late boundary,
two synthetic incoming launch interruptions and pause. Unfrozen duration is26steps.
Source2and8are clear boundaries. End/interruption restores the default fixture body.

Root inspected all22actual rendered Canvas exports in the
[right](browser/all-poses-right.png) and [left](browser/all-poses-left.png) galleries;
[visual review](browser/visual-review.json) records their hashes. The exports preserve
the actual runtime pixels after two presentation frames while gameplay stays paused.
Browser F translates to actual Character upward C-stick/heavy aerial input; N uses
the real fixed-step Character/Matter path. This is simulated keyboard evidence.

The fixture uses a shared40x50body and zero gravity. It does not qualify Pikachu
movement, real landing, full Lab/save-use-in-match, roster or native collision parity.
Receiving radii use authored maximum-column calibration; helper/material, native
radius/status/root-motion/patch semantics remain unqualified. Broad hip/tail regions
extend beyond contours; ears/outer tail tip have no separate receiving declarations.
Sparse holds, angular stem, cheek shifts, purple/brown mouth and small pink fringes
remain accepted rough-art limits. Complete Pikachu remains partial.

Twelve new focused tests passed50both-facing contact/priority/exposed-tip/miss
probes and source guards; six existing normal-contact physics followups and a fresh
TypeScript check passed. Those checks complement the exact-build browser evidence.

## Shared explicit timing and saved aerial route

A second immutable [build](../up-air-timeline-preview-build.json) serves the
[shared-timeline preview](http://127.0.0.1:4191/pikachu-up-air-timeline-preview.html).
The move now carries eleven contiguous `animation.frameWindows`; the shared
Match animation selector consumes these exact global strip indices. Serialization
validates full gameplay coverage and in-strip integer indices. The generic Lab
numeric editor exposes them and preserves edits through reload.

[Browser acceptance](timeline-browser/acceptance.json) passed32outgoing scenarios
through direct and JSON-saved Wolf factory routes,286incoming probes,two freezes,
two synthetic interruptions,pause and12served art hashes. Every gameplay step
checks the shared selected art index against the reviewed holds. Root inspected
all22actual captures in the [right](timeline-browser/all-poses-right.png) and
[left](timeline-browser/all-poses-left.png) galleries; [review](timeline-browser/visual-review.json)
pins their hashes. The earlier preview/build remains preserved.

The saved-route check exposed first-registration precedence when an authored
aerial uses a new ID. The factory now explicitly sets the saved fair/bair/nair/uair/dair
slots after registration. The148focused schema/serializer/factory/animation tests
passed, including real saved up-air input and frozen early/late replacement in
both facings. A fresh TypeScript check passed. Other Wolf moves stay compiled in
this fixture. Full Pikachu Lab entry, full-match sheet registration, movement and
landing qualification remain incomplete. Port4190 was rejected by Node fetch as
a restricted browser port; the acceptance uses4191.

## Packed sprites through the Match driver

[Registered sprite artifacts](../../../../../assets/characters/pikachu/registered-poses.json)
contain neutral and eleven up-air cells at512x384. The packer applies one1/4
whole-canvas LANCZOS transform after integer-padding neutral to the common
2048x1536canvas; no silhouette crop/recenter occurs. Root256,288 and world scale
4*70/600 preserve the original root1024,1152 and70/600metric.

Root inspected all packed cells on light/dark before the new
[immutable packed build](../up-air-packed-preview-build.json).
[Browser acceptance](packed-browser/acceptance.json) passed32direct/saved outgoing
scenarios,286incoming probes,two freezes,two interruptions,pause and14servedPNG
hashes. Every attack step checks the actual Phaser frame and shared Match sprite
driver index against the reviewed serialized timeline, plus the unchanged world
canvas dimensions. Root inspected all22actual rendered captures;
[visual review](packed-browser/visual-review.json) records their hashes.

The isolated Wolf fixture aliases its generic attack animation to the reviewed
up-air strip; this proves the shared driver can consume these sprites/timings,
not full Pikachu manifest/roster/Lab registration. Eleven new timing/routing tests
plus21landing/schema regressions passed;283roster/factory/contract/Lab regressions
and a fresh TypeScript check passed. The shared forward-air contract hook now
honors the resolved saved ID while preserving held-item precedence.
