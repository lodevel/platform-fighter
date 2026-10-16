# Neutral forward-tilt posed projection

The pilot now has an explicit runtime consumer:
`buildPikachuNormalMove('forward-tilt', pikachuForwardTiltPoseProjector)`.
The projector is in `src/characters/pikachuForwardTiltPose.ts`; its
[calibration record](forward-tilt-pose.json) retains source-image hashes,
per-frame centres, projected local axes and uncertainty. The self-contained
[source-only annotated review](forward-tilt-pose-review.html) displays original
active images5/6/7 without altering their pixels.

All three original active frames were inspected. The visible debug crosses
locate region0 on the extended knee axis, region1 at the knee origin and
region2 at the hip origin. The native region0 offset remains localX4;
region1/hip remain local0. Their projected axes change as the source leg turns
and retracts, rather than using one generic limb anchor. This is **authored
2D source calibration**, not an acquired native skeletal transform. Unknown
angled variants, frames, source rows, capsule endpoints and local Y/Z axes
throw explicitly.

The previously reviewed source root(420,586) and neutral height557 map to world
height70 with one uniform factor70/557. Existing simulation root offset25
converts ground-root coordinates to body-centred coordinates. Hand-selected
debug-cross centres were checked locally against their crossline pixels;
uncertainty is±2sourcepixels (~0.251worldpixels). Cyan review outlines retain
native radii3.5/3/2.5 at world scale5, rather than deriving radius from the
rendered sphere. Perspective and retargeting mean this cannot establish native
3D collision parity.

Gameplay contact remains source frames6–8, clear9, damage9, angle361, KBG100
and BKB15. Three per-frame snapshots share one strike identity. Contact drawing
source image8 is immediate post-contact game9 and supplies an approximate
overlay-free pose held over gameplay6–8; that art adaptation does not change
the sourced clock or replace the actual active-image projections.

Validation: `npx vitest run src/characters/pikachuForwardTiltPose.physics.test.ts`
passes10 tests. Thirty actual-Matter point probes cover foot/knee/hip centres
and outer-edge hit/miss across all three source frames and both facings. Native
minimum-ID priority correctly selects region1 at the game6 knee centre, then
region0 there at game7/8 as the projected circles overlap. Two further
Character/real-Matter scenarios verify physical sensor replacement through
the three poses, one confirmed strike and clear at elapsed8 over the fixed
29-frame action. Pure checks verify native numbers and fail-fast boundaries.

These are one-pixel target fixtures recording contact data without victim
launch. They do not accept drawings, posed hurtboxes, angle variants or a full
Pikachu match. The root owns the separately named three-pose animated preview
and its production/browser/art acceptance; the earlier jab preview is unchanged.
