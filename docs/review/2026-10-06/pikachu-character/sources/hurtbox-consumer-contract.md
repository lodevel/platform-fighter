# Hurtbox consumers: verified source and remaining native behavior

Checked 2026-10-06. [Machine-readable evidence](hurtbox-consumer-evidence.json)
preserves 20 primary source files/excerpts, their pinned URLs, line ranges and
hashes. The captured Pikachu PRC remains a separate historical declaration
source. No native posed outputs, initialization implementation or scale
measurement were acquired. No software was installed and no runtime files changed.

## Original Ultimate viewer

The [Ultimate Hitbox Viewer FAQ](https://drakeirving.github.io/ult-hitbox-viewer/faq.html)
credits EyeDonutz's rendered animations from Cross Mod. This establishes that
Cross Mod was used for those published animations; it does not identify every
Pikachu UFD asset's renderer, version or game patch.

[Ploaj/SSBHLib@9cba352d10490f41d6be14f2828c11f61d65d6c6](https://github.com/Ploaj/SSBHLib/tree/9cba352d10490f41d6be14f2828c11f61d65d6c6)
contains that Ultimate viewer. Its parameter reader consumes `vl.hit_data`,
`node_id`, `size`, and both offset triples directly. The size is passed unchanged
to a unit-radius sphere/capsule mesh. The capsule shader computes each vertex
as the animated bone matrix applied to the local endpoint plus a unit-radius
hemisphere vertex multiplied by size. Its native-size interpretation is therefore
**local radius in this viewer**, not diameter. The parameter renderer selects
the capsule's animated bone matrix; unresolved bone hashes are skipped.

The full bone matrix also transforms the radius mesh. Under nonuniform scale,
this can distort the cross-section. The source is an offline viewer, not the
game's `HitModule` implementation, and supplies no matched native scale
measurement. Its inspected parameter reader has no virtual-hit-node consumer.

## Newer editor and live status hooks

[Common-Leap/Visionary@e7df465c24a97995ef59b49a6222d6783e5be66f](https://github.com/Common-Leap/Visionary/tree/e7df465c24a97995ef59b49a6222d6783e5be66f)
also reads the endpoints and `size` as a local radius. Its desktop renderer
transforms endpoints by the posed bone matrix, but calculates a spherical world
radius using the largest length of the three transformed unit axes. This
**differs from Cross Mod's full-matrix mesh scaling** under nonuniform scale.
Neither policy is promoted to verified native scaling.

Its in-game plugin hooks `HIT_NODE`, `HIT_NO` and `WHOLE_HIT` separately, captures
their typed arguments, and forwards to the native original when no editor rule
changes the call. The editor uses joint, numbered-list-index and whole-body
targets for its own status reconstruction. Its README explicitly states that
mixed whole-body and joint states lack vanilla calibration. The hook code
establishes how the plugin intercepts native calls; it does not provide an
observed capsule scale, native override precedence or per-frame Pikachu pose.

## Native APIs and captured Pikachu status assignments

[Skyline symbol bindings](https://github.com/ultimate-research/skyline-smash/blob/bed642e37da23bbf2db2544bb6ac119007d1cbf0/src/cpp.rs)
expose `ModelModule::joint_global_position_with_offset`: a bone Hash40, local
Vector3f input, Vector3f output and an unnamed boolean. This offers a concrete
future path to capture posed endpoint positions in the running source game.
The boolean's semantics and actual outputs remain unverified here. A bone
origin alone would not establish either endpoint's rotation or scale.

`HitModule` exposes indexed, joint and whole status setters, status queries,
and center/part queries. The current binding returns opaque `u64` for
`get_center_pos` and `get_part_size`; these are not interpreted as typed endpoint
or radius data. Bindings establish native signatures, not implementations.
Pinned constants identify NORMAL=0, INVINCIBLE=1, XLU=2 and OFF=3; their full
collision/feedback behavior and override precedence still require consumers.

The existing pinned Pikachu status capture concretely restores whole-body
NORMAL in `SpecialHiWarp/end.c` line 24 and `SpecialHiEnd/end.c` line 21.
These are status-end events, not assigned gameplay frames. They do not establish
the onset of a preceding status. Twelve captured Final Smash ACMD actions set
whole-body XLU at guarded motion startup. No ordinary normal/aerial status
override was found in this captured ACMD set. Absence there does not establish
absence in shared status code, whose body remains unavailable.

## Special parameter list selection

The primary PRC loader hook resolves archive-table indices to resource hashes
and forwards the original file load. Its archive-table index does not select a
special parameter list entry. The native module interface exposes parameter
getters with group/object and field hashes, plus `set_customize_no` for a move
variant and move number, documented for Mii and Joker customization. No getter
body, initialization default or Pikachu-specific list-index selection was
acquired. Index 0 remains the captured scalar table's matching entry; the other
three zero-valued structs remain preserved without invented meaning.

Required next evidence is the native initialization/size consumer or measured
game capsule outputs at known model and bone scales; actual skeleton, motion and
helper resources with validated pose sampling; virtual-node consumer semantics;
native parameter variant selection; and native status precedence/restoration.
This research establishes useful viewer contracts and native API routes, while
leaving those unresolved behaviors explicit.
