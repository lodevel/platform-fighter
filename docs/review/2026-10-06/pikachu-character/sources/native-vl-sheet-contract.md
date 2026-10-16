# Ultimate Pikachu parameter table acquisition

Checked 2026-10-06. The [original parameter table](https://docs.google.com/spreadsheets/d/1rwDPL1jhE-KuEbbcBkkTb44z1smJp9rYme_xb4BIJTk/edit#gid=1036933026)
is titled **vl param (Ultimate)**, with Pikachu tab 1036933026 and separately
labeled Smash4/Ultimate value columns. This is a different document from the
previously excluded Smash4-only table. Values below come exclusively from its
Ultimate column. Its game patch and original binary-dump hash are unstated.

The CSV, full workbook, page bytes, HTTP response headers and metadata summary
are retained. The page exposes model revision 14813; this is a captured document
revision marker, not an immutable revision-download URL or a game patch.
Repeated CSV export bytes match. The workbook contains no author/date
`docProps`. Meshima authorship is attributed by a linked technical wiki page;
direct creator metadata and public edit history were not acquired. The separate
common-parameter spreadsheet's 13.0.1 title cannot date this vl document.

[native-vl-sheet-pikachu.json](native-vl-sheet-pikachu.json) retains all 78 scalar
rows, original hashes/raw values, both game columns, descriptions and notes.
[required-special-parameters.json](required-special-parameters.json) resolves
all 44 previously missing status-read fields against this table. Every reference
was checked for both exact parameter-group and field Hash40 immediately before
its pinned native getter, getter type and source-file hash. Integer/float getter
types do not establish underlying PRC storage types in the sheet alone. The
later [binary acquisition](native-vl-prcrs-contract.md) supplies those types
separately, together with exact offsets and float32 bit patterns.
Empty field labels remain hashes; display sections do not establish complete
native struct layout. Wiki numbers copied from this table are not independent
corroboration.

| Contract | Ultimate table values |
| --- | --- |
| Quick Attack | Startup gravity delay 10; stick threshold 0.5; speed additive 11 and multiplier 0; each warp counter 5; second-angle threshold 35°; second-speed multiplier 0.9; wall-slide threshold 57°; ending horizontal multiplier 0.6; helpless air multiplier 0.4; landing 24. |
| Skull Bash startup/hold | Horizontal multiplier 0.8; friction 0.02; gravity 0.04; charge 80; flick bonus 20; maximum charge-dependent release delay 12. |
| Skull Bash release | Damage 6.2–21.4; initial horizontal speed 1.6–3.2; vertical speed 0.185–0.23; gravity 0.01; maximum vertical speed 1.1. Slope start 10°, angle influence 0.3; slope speed coefficients 0.4/1 require native formula. |
| Skull Bash hit/end | Hit horizontal speed −0.3, vertical 1.3, hit gravity 0.1; ending horizontal multiplier 0.7; ground brake coefficients 0.032 and 0.031; ending aerial gravity 0.075. |
| Thunderjolt | Ground/air offsets [6.5,1]; aerial lifetime 100, speed 2, angle −1.01229 rad; ground lifetime 84, motion-rate 0.9, transition-rate 1. |
| Thunder | Startup horizontal multiplier 1 ground/0.85 air; cloud offset 10.5; self-hit vertical speed 0.66/gravity 0.016; bolt speed −4, flying distance 30, ground pass distance 8, width 1.7. Cloud speed −4/width 1.7 also recorded. |

The table describes Thunder cloud height, bolt distances and detection width
as their parameter values multiplied by 10. Preserve those raw values and
literal notes. The missing engine/entity-construction consumer still needs to
prove that conversion, detector shape, origin and effective world coordinates.
Jolt coded lifetimes 100/84 are distinct from reported 98/96 observed durations;
native creation and state-clock boundaries remain required.

An apparent Skull Bash friction discrepancy is resolved by pinned
`SpecialSEnd/exec.c`, lines 41–94: the two fields are consumed as
`0.032 + 0.031 * (holdCount / 80)`, producing 0.032–0.063. The field called
`special_s_end_acl_x_max_` is an added coefficient in this formula, not an
absolute maximum. The three previously unnamed hashes supply release delay 12
and hit speed −0.3/1.3; their semantics come from matching native consumers,
not an invented label.

This materially closes scalar value coverage for the 44 captured status fields.
The later historical PRC fixture supplies a typed binary and 12 hurtbox structs,
with all 78 sheet rows matching at storage precision. Its patch and unmodified
archive origin remain unverified. Per-frame bone transforms, native entity
constructors, common status/input algorithms, reconciled gameplay clocks and
verified special behavior in a match remain absent.
No runtime or production-bundle files were changed by this acquisition.
