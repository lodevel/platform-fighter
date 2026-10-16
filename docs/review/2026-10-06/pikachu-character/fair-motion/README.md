# Forward-air rough beta preview

Sixteen reviewed drawings follow41 gameplay steps, with fixed root(768,880) and world scale70/600. The isolated [build](../fair-motion-build.json) preserves the main game and earlier previews.

[Browser acceptance](browser/acceptance.json) passes16 cases: both facings, ordinary automatic hit-stop on/off, near/late/finisher-edge/miss probes. Near and late contacts each total11.3damage (five1.3 linkers plus4.8finisher), finisher edge4.8, miss0. Gameplay11..25 has four source regions with per-target rehit3;26 clears,27 finishes,28 clears. Two manual freezes, pause and17served-art SHA256 checks pass. Browser F/N events drive the preview's Character directional-heavy aerial route and fixed steps.

[Root visual review](browser/visual-review.json) covers all32runtime pose screenshots in both facings. Drawings remain deliberately rough: sparse holds, angular contours, muted cheek colors and small alpha fringes. No native skeletal or collision parity follows from art acceptance.

Scope remains partial: static fixture movement body, one-pixel target, explicit authored rehit clock and shared ordinary hit-stop formula. Posed Pikachu hurtboxes, native electric timer behavior, victim launch, full controls, roster and Lab/save/load/match remain required.
