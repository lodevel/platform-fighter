# Captured Pikachu PRC and hurtbox declarations

Checked 2026-10-06. The primary open-source parser repository includes a
[Pikachu binary fixture](https://github.com/ultimate-research/prc-rs/blob/c5855b8d0e910b1c3622c3131e6dfe0567d62397/src/tests/vl.prc),
identified as `FIGHTER_PIKACHU_VL` by its
[parser tests](https://github.com/ultimate-research/prc-rs/blob/c5855b8d0e910b1c3622c3131e6dfe0567d62397/src/tests/mod.rs).
The original 6,385 bytes are retained in
[native-vl-prcrs-pikachu.prc](native-vl-prcrs-pikachu.prc), SHA-256
`49a645b4e1833bb29f608b8d0b40eaff25c2e47750f0782a32355137f2af6b05`.
The complete decoded tree retains types, offsets, list indices, field hashes,
duplicate-capable struct entries and exact float32 bit patterns.

The file has one recorded addition in the queried path history:
[b5f52320a545507f317924b2657d8a4b5a599ad7](https://github.com/ultimate-research/prc-rs/commit/b5f52320a545507f317924b2657d8a4b5a599ad7),
2022-10-12, by `benhall-7`, alongside the Pikachu parser tests. This establishes
the historical file's presence and its repository identity. It does not establish
the game patch, original archive extraction, or whether the fixture was modified
before publication. Those provenance fields remain unknown. The sheet and
binary may share an original extraction; agreement is not asserted to be an
independent capture of the game.

## Scalar and typed coverage

[Comparison](native-vl-prcrs-sheet-comparison.json) finds all 78 Ultimate sheet
rows in this binary. All match: integers compare exactly; sheet decimals cast
to float32 compare by bytes with the binary. In particular, Quick Attack's
speed additive 11, multiplier 0, stick threshold 0.5, second-angle threshold 35,
move counter 5 and second-speed multiplier 0.9 remain unchanged. The last value
is the native float32 `0x3f666666`, decoded as `0.8999999761581421`.

All 44 captured native status-read fields now have typed binary evidence in
[required-special-parameters.json](required-special-parameters.json). The
original sheet values and provenance remain preserved. The eight ordinary
special/entity parameter lists have four structs: index 0 supplies the compared
values; the other three retain their zero-valued fields. The Final Smash vortex
list instead has one struct. The game consumer's variant
selection is not captured and no playable variant is inferred from those zeros.
The binary also resolves the native groups of the sheet's final rows: its
carried `cloud` display heading does not mean those fields belong to cloud.

## Native damage-receiving declarations

[native-hurtbox-declarations.json](native-hurtbox-declarations.json) preserves
all 12 `hit_data` structs. Their actual fields are `offset1_x/y/z`,
`offset2_x/y/z`, `size` (Float), and `node_id`, `part`, `height`, `status`,
`check_type` (Hash40). Every row declares normal status and capsule shape.
The table below abbreviates float32 values for reading; the JSON retains exact
decoded numbers and bits. These are local declarations, not world coordinates.
The convenient [capsule rows](native-hurtbox-capsules.json) preserve those same
values and bits with independently verified CRC32/length Hash40 labels;
posed-world endpoints remain null.

| Index | Bone | Offset 1 | Offset 2 | Native size | Part / height |
| --- | --- | --- | --- | --- | --- |
| 0 | hip | (1, 0.2, 0) | (−0.3, −0.3, 0) | 3.2 | body / center |
| 1 | head | (0.8, 0.7, 0) | (1, 0, 0) | 3.1 | head / high |
| 2 | shoulderr | (−0.8, 0, 0) | (0.8, 0, 0) | 0.9 | body / center |
| 3 | shoulderl | (−0.8, 0, 0) | (0.8, 0, 0) | 0.9 | body / center |
| 4 | armr | (0, 0, 0) | (0.8, 0, 0) | 0.5 | etc / center |
| 5 | arml | (0, 0, 0) | (0.8, 0, 0) | 0.5 | etc / center |
| 6 | legr | (0, 0, 0) | (1.4, 0, 0) | 1.8 | body legs / low |
| 7 | legl | (0, 0, 0) | (1.4, 0, 0) | 1.8 | body legs / low |
| 8 | kneer | (0, 0, 0) | (2, 0, 0) | 1 | body legs / low |
| 9 | kneel | (0, 0, 0) | (2, 0, 0) | 1 | body legs / low |
| 10 | tail1 | (2.8, 0, 0) | (0, 0, 0) | 1.4 | etc / center |
| 11 | tail3 | (0, 0, 0) | (0, 0, −2) | 1.6 | etc / center |

The fixture separately contains 12 `virtual_node_data_hit` entries with
`node`, `node_parent`, translation `x/y/z` and rotation `rot_x/y/z`, and four
`virtual_node_data_hit_flip` pairs. Their meanings and rotation order require
the native consumer; they are not silently applied to `hit_data` or treated as
per-frame matrices. The six `map_coll_data` nodes are movement contacts and
remain distinct from these damage-receiving volumes. The common fighter table's
shield radius and clip sphere also supply no substitute hurtbox declarations.

The captured Skyline binding
[set_hit_data](formats/skyline-set-hit-data.rs.txt) preserves the native symbol
and types: two integer arguments, two `Vector3f` references, one float,
`Hash40`, `CollisionPart`, `HitHeight`, `HitStatus`, `CollisionShapeType`.
Its arguments are unnamed. Endpoint/radius/joint interpretations are consistent
with the PRC field names and capsule declaration, but the initialization consumer
must still establish indexing, radius semantics, scaling and transforms.

## Posed-bone resources and formats

[Native archive paths](native-resource-paths.json) independently identify
`fighter/pikachu/param/vl.prc`, `fighter/pikachu/model/body/c00/model.nusktb`,
`model.nuhlpb`, `model.nuanmb`, and motion `.nuanmb` files under
`fighter/pikachu/motion/body/c00/`. This is a resource-name inventory, not the
actual model or motion bytes. The fixture's original extraction path is unstated.

Primary format/parser code is pinned to
[ultimate-research/ssbh_lib@08f8bc4470a7d480dfc9b64d7e08e97f3820fed7](https://github.com/ultimate-research/ssbh_lib/tree/08f8bc4470a7d480dfc9b64d7e08e97f3820fed7).
Raw code and hashes are retained in `formats/` and
[hurtbox-format-captures.json](hurtbox-format-captures.json):

- Skeleton `BoneData` supplies name, parent index, a column-major local matrix,
  and billboard type. The raw format also carries inverse and world matrices.
  `calculate_world_transform` accumulates each parent matrix on the left.
  The separate relative-transform helper's multiplication order must be
  reconciled before using it to derive game transforms; no algebraic convention
  is inferred solely from the serialized column order.
- Animation transform tracks supply scale, quaternion rotation and translation.
  Each decoded track value corresponds to one animation frame; a single value
  repeats through the final frame. Transform overrides and immediate-parent
  scale compensation must be respected. This does not establish the game's
  interpolation, playback rate, motion-frame/gameplay-frame mapping or blending.
- Helper `.nuhlpb` data supplies aim and orient constraints with named bones,
  quaternions, axes and ranges. The actual Pikachu constraints and their runtime
  application remain absent.

Exact posed vulnerability still requires the actual skeleton and relevant
animations, helper constraints, native model/root/facing scale and transforms,
state-dependent status overrides, validated frame sampling and the 3D-to-2D
projection contract. UFD's white overlays are visual evidence; their pixels do
not establish those missing matrices. Nothing here installs a runtime consumer
or establishes current-patch native hurtbox parity.

## Reproduction and checks

`python3 tools/pikachu-source-prc-read.py` accepts the captured binary, retained
`formats/ParamLabels.csv`, and an output path. It uses Python's standard library
and the pinned primary PRC reader format; it does not rewrite the binary.
Checks reproduce the original Rust fixture's six movement-node hashes, head
offset 1.5, `hit_target` values 1/0/6 at the expected first offset `0xd0b`, and
ledge box 16/21/−11/5. The 78 scalar comparisons and all 44 status-field lookups
pass. No runtime source, production bundle or installed software was changed.
