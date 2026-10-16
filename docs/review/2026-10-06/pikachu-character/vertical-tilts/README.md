# Pikachu vertical tilts: isolated grounded verification

Up tilt and down tilt have eighteen reviewed rough drawings and posed receiving
geometry on the same fixed gameplay clock. This is partial character work;
Pikachu is not roster-selectable and no complete Pikachu Lab or match is qualified.

The immutable [build record](../vertical-tilt-preview-build.json) identifies the
served [preview](http://127.0.0.1:4188/pikachu-vertical-tilt-preview.html), source
identity, bundle and nineteen PNG hashes. It preserves older previews and the
workspace production output. [Browser acceptance](browser/acceptance.json)
passed 64 outgoing scenarios: two actions, direct/saved factory fixtures,
both facings, automatic ordinary hit-stop on/off, and near/last/edge/miss probes.
It also passed 468 incoming centre/outside probes, four manual freezes and pause.
Root inspected all36actual runtime pose captures in the
[right](browser/all-poses-right.png) and [left](browser/all-poses-left.png) galleries;
[visual review](browser/visual-review.json) records their hashes and limits.

| Action | Clock | Contact | Observed damage/strike |
| --- | --- | --- | --- |
| Up tilt | 26 unfrozen steps | Elapsed6..12, three moving tail regions | 5%, once; near6, last12, outer edge11 |
| Down tilt | 18 unfrozen steps | Elapsed6..7, one source top capsule | 6%, once; near/edge6, last7 |

Up tilt keeps source per-region radii10/19/17.5 and angles105/105/110,
base40/45/45 and growth120. The independently reviewed
[contact projection](../sources/posed-resources/up-tilt-contact-review.json)
uses captured ordinary tail matrices. Down tilt preserves its source capsule
from(25,2.5) to(55,12.5), radius16, rather than inventing a limb anchor.
Damage/launch come from pinned primary scripts; orthographic reach is authored
target calibration, not a native collision claim.

Every active step has a separate drawing. Twelve receiving capsules follow each
of the18sparse drawing holds, with half-open attack-elapsed windows carried through
the real move serializer. [Candidate geometry](hurtbox-preparation/candidates.json)
and [actual-art review](hurtbox-preparation/visual-review.json) retain their
independent source and projection policy. The down-tilt drawings/receiving regions
subtract captured Trans translation consistently as an explicit target root fit;
its source top attack capsule remains unchanged. Native root-motion semantics
remain unresolved. Reset/end restores the shared fixture body.

Browser U/D establishes held vertical direction for one fixed step before a
light-attack press, then N advances actual Character/Matter steps. The saved mode
uses the real serializer and Wolf factory with only upLight/downLight overridden;
Wolf's other slots remain present. It proves transport through that shared route,
not complete Pikachu authoring or human controller feel.

The movement body is a shared40x50fixture. Matter floor rest is checked within
0.25worldpx. Drawn extremities extend up to2.1worldpx below the registered root;
this rough-art limit is measured per pose in the visual record. Broad hip/tail
receiving capsules extend beyond contours; ears/outer tail tip have no separate
regions. Maximum-column radius calibration, native scale/status/patch parity,
full-character physics, roster, Lab and launched match behavior remain unqualified.

Focused verification:61tests passed across up-tilt physics, normal source data and
capsule serializer suites; a fresh TypeScript check passed. The live exact-build
browser evidence establishes the fixture behavior beyond those unit checks.

### Packed continuation

Packed shared Match-driver fixture now passes64outgoing,468incoming and4freeze checks,22servedPNG hashes and zero page errors. All36actual Canvas captures were manually inspected. Missing animation.frameWindows caused the first numerical browser failure; explicit reviewed drawing holds now survive actual save/load and Lab edits.62focused tests and TypeScript pass. Presentation-only Donkey Kong aliases do not change Wolf saved/physics fixtures. See [pinned actual runtime inspection](packed-browser/visual-review.json). Full Pikachu match/roster integration and native status/root/radius/patch qualification remain pending.
