# Native pose reference acquisition

Checked October 7, 2026. These are newly acquired reference resources, not a
finished collision implementation or a verified current vanilla extraction.

The [model importer author’s pinned README](https://github.com/tryptech/io_scene_numdlb/blob/9d02caa072da2cd1322e301de7d5c957be3940db/README.md)
links the public model/animation folder. The original link/commit captures are
preserved here. `tools/pikachu-native-assets-acquire.py` downloads the two
Pikachu archives, checks expected names/lengths, decrypts their file keys and
data, verifies each MEGA file MAC, and records SHA256 identities in
[acquisition.json](acquisition.json). No game installation or account is used.

The model archive is 15,292,447 bytes, timestamp December 26, 2018, SHA256
`908d98f62dbc2e2e0a9b0c912f2f7e9cffb33632c978ee143d267423b71cf406`.
The motion archive is 2,776,164 bytes, timestamp November 19, 2021, SHA256
`b143f5446975eeac5cfe08b8f4a3812ecf487f7e055ad44179ad9fee9a44b8ef`.
Timestamps do not identify a game patch. The body skeleton contains 77 bones;
the helper file contains 11 orient constraints and no aim constraints. Every
bone referenced by the 12 captured hurtbox declarations exists. The motion
archive supplies 346 animation resources, including body, article and camera
resources; this count is not the number of playable actions.

Raw archives/resources stay in ignored `assets/gen/pikachu-native-reference`.
The selected mesh/material resources are separate local authoring references
in [geometry-extraction.json](geometry-extraction.json). They are not shipped
as game art. `py7zr` 1.1.3, `ssbh_data_py` 0.9.1 and `pycryptodomex` 3.24.0 live
under `/tmp/pikachu-source-libs`; the acquisition adds no application dependency.
The parser’s [official documentation](https://github.com/ScanMountGoat/ssbh_data_py)
and the pinned [reference animation implementation](https://github.com/ScanMountGoat/ssbh_wgpu/blob/f5f9e14a83e48e0e9282c77add192b8fcfd4c24b/ssbh_wgpu/src/animation.rs)
provide the binary types and matrix conventions used here.

`tools/pikachu_native_pose.py` reads integer native animation samples, transforms
column-vector endpoints through bone ancestry and exports row-major matrices.
It handles the captured translation/rotation/scale override flags, refuses
unreviewed scale compensation, and rejects helper constraint targets and their
descendants. None of the requested damage bones has a helper constraint in its
ancestry. This avoids silently treating unimplemented helper constraints as
native poses. [Evaluator checks](evaluator-checks.json) independently compare
65 ordinary bind-pose bones with the parser’s world-transform calculation:
maximum absolute difference 0.000000783767, tolerance 0.000002. A known quarter
turn and invalid-index/helper guards also pass.

[Forward-air samples](fair-reference-samples.json) contain 54 native samples;
[neutral forward-tilt samples](ftilt-reference-samples.json) contain 46. The
last native animation sample is **not** the first actionable gameplay frame.
UFD’s 41/29-frame commitments stay unchanged. The
[forward-air index comparison](fair-native-index-comparison.png) overlays
candidate native samples at UFD image indices 0, 5, 10, 14, 25 and 26, including
the following two samples as alternatives. Root inspection favors the same
sample index at these landmarks, particularly the opening head/tail positions.
The fixed source camera/root registration remains an authored 2D calibration:
native z right, y up, root (380,463), 28.3 source pixels/unit, approximately two
pixels of registration uncertainty. Reference capsule size is interpreted as
radius in the comparison according to the previously captured viewer consumers.
The comparison is not an in-game measurement of native scaling/status behavior.

Required work: review the complete source/native mapping and other motions,
validate source attack regions against independent visible overlays, fit the
selected cartoon anatomy, define target hurtboxes and feed reviewed samples
into the actual fixed-step runtime. Native numeric patch provenance, nonuniform
radius scaling, virtual nodes and status precedence remain separate gaps.
