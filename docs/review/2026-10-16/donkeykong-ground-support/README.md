# Donkey Kong face-down ground support

Targeted repair to the existing Ultimate-derived DK, using existing art only.
The reported float is reproducible in `down_wait_face_down`, the prone loop
selected after a face-down knockdown landing. No new move values or source
mechanics are introduced.

The original `ledge-recovery/pack-spec.json` enabled `snapRootToFloor` for all
eleven drawings. The packer measured the bottom of the entire alpha image, so
the dangling tie established the root. The actual supporting forward hand and
fingers remained **33.37–38.03 world pixels above that root**. A real Matter
launch/landing regression measured **37.91 pixels** of hand-to-floor gap at
entry, in both facings, before the repair.

`support-registration.json` records the reviewed forward-hand contact region
and pixel for every installed atlas drawing, the source cutout region and
hash, original clip metadata, native samples and per-frame translation. The
native route remains `down_wait_d` / `f04downwaitd.nuanmb`, samples
1/9/17/25/33/41/48/56/64/72/80 on the existing 80-frame loop. Its source inventory
is `docs/review/2026-09-25/donkeykong-character/rework-2026-10-10/clip-plan.json`.
The existing native-derived contour guide and all eleven installed drawings
were inspected. The visible hands, forearms and hindleg contours establish
anatomical support; the tie is cloth. This is an authored registration repair,
not a claim of newly recovered native collision geometry.

Only this installed clip's eleven vertical trim offsets and logical cell
height change. The atlas image bytes, atlas crop rectangles, root, scale,
source clocks, movement body, receiving and protection remain unchanged.
The logical cell grows from 224 to 304 pixels to retain the existing cloth
pixels below the supporting hand. No image generation, resampling or opaque
pixel deletion is involved. Ordinary fall, landing, deliberate bounce poses
and face-up prone are not normalized to a new floor.

The original pack recipe now provides a reviewed `floorContactRegion` for each
frame. The packer uses that region for both root snapping and its floor check;
it rejects empty, malformed or out-of-image regions. Other recipes retain the
existing whole-alpha behavior. `anatomical-repack-spec.json` is the scoped
reproducible recipe. Repacking into a temporary directory passed all eleven
contact checks and the packer's saved-cell checks; the regenerated images are
not installed.

Verification uses alpha **>=32**, pixel centres (`exclusive bottom - .5`), and
a **0.5 world-pixel** tolerance: one packed pixel is 0.4666667 world pixels, so
the retained half-pixel edge and the small physical solver slop fit inside that
bound. The test measures the selected hand under the actual sprite origin,
scale and facing at the completed physics position against the actual finite
supporting platform. It does not use the lowest whole-image pixel or a
hurtbox capsule as a ground contact.

- `unit-before.log`: three red regressions, including both facings after real
  launch/landing.
- `unit-after.log`: 48 support, support-loss and render-metric tests pass.
- `packer-region-tests.log`: three focused packer tests pass; no Python
  dependency is added to the Vitest suite.
- `source-repack.log`: all eleven source contact checks and saved-cell checks
  pass.
- Generated anatomy review: before/after atlas registration was inspected at
  every source sample, in both facings. Red marked the root/floor line; blue
  marked the selected hand contact. The image is removed after acceptance.
  Its comparison is reproducible from `originalClip` and the per-frame rows
  in `support-registration.json`, together with the unchanged installed atlas.

Production browser qualification is regenerated into `runtime-before` and
`runtime-after` by `tools/dk-ground-support-match.mjs`. The retained
`runtime-comparison.json` preserves the accepted numeric results. The generated
before/after montage was inspected in both facings. Captures, per-drawing
reviews and montages are removed after acceptance under add-character skill
section 8; the harness and source/registration recipes remain for regeneration. The launch is injected
setup copied from the existing knockdown physics regression; subsequent flight,
landing, prone selection, finite support and rendering use the real match.
Getup uses a real browser key event through the saved binding. These checks do
not claim that a human controller or the original reported hit was reproduced.

## Integrated production qualification

`runtime-comparison.json` records before/after Windows Edge runs using the real MatchSim/MatchView. The injected launch uses the existing physics regression setup; landing, complete reachable prone loop, and saved keyboard getup run normally. Both facings reduce the maximum anatomical floor gap from 37.9833 to 0.18333 world pixels. All ten reachable prone drawings are visible, submitted and resident on every sampled tick. Complete authority trace hashes are identical before/after, and both browser profiles were removed. Actual after screenshots were inspected: the hands/body rest at the floor and the non-supporting tie extends beneath it.

Accepted-review cleanup completed: the combined DK/Pikachu scope removed 6 generated directories and 7 separately listed review images (639 files, 181,769,349 bytes total). No tracked files or required inputs/fixtures were removed. Compact numeric/source records, regeneration tools/recipes, native/libs inputs and installed assets remain.
