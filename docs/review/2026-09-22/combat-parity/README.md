# Combined Link and combat reference pass

Continuation after [jab launches](../jab-launches/README.md), covering the five
requested areas in one implementation and verification pass.

| Requested area | Implemented changes |
| --- | --- |
| 1. Link specials/projectiles | Source launches for bow charge, boomerang clean/late/return, grounded Spin phases, supported aerial Spin rungs and bombs; shared execution identity for projectiles and ladders. |
| 2. Remaining normal details | Jab inward tips and ordinary forward-air ground/inner-air variants, with per-hit source multipliers. |
| 3. Collision accuracy | Capsule narrowphase against tangible hurtboxes, source-ID priority, mirrored coordinates and exact projected static top-bone records. |
| 4. Defense | Current measured Link spot/forward/back roll and air-dodge timing, release-edge parries, shield commitment and permitted out-of-shield actions; airborne ledge regrabs lose hang protection until ground contact or a damaging launch. |
| 5. Shared combat | Weighted stale history, reference rage, proper stale damage versus knockback growth, source hitlag/SDI multipliers, crouch modifiers, category-based shieldstun and documented SDI distance/pulse timing. |

Detailed records: [specials](specials/README.md), [collision](collision/README.md),
[defense](defense/README.md), and [shared combat](shared/README.md).

This pass distinguishes source records and measured timing from unexposed native
engine algorithms. It does not turn a successful local test into a claim of
complete Ultimate parity. In particular, native angle367/target-position pulls,
animated skeletal transforms, exact directional-dodge kinetics/landing clocks
and native SDI input recognition require evidence beyond attack declarations.
The supporting records classify native script declarations, calculator code,
original community measurements and local adapters separately. Lab saves retain
the added fields, the controls expose source IDs, and the preview displays
capsule regions with the edited region highlighted.

## Verification

**361 files / 11,179 tests passed** in the clean
[final full-suite run](full-tests-final.txt), completed September 23 after all
source edits settled. The earlier [aggregate](full-tests.txt) overlapped the
last Lab field-visibility change and failed one new assertion. Both the
[57-test focused rerun](collision/lab-preview-tests.txt) and the final aggregate
pass that assertion; the earlier log is retained for diagnosis.

[TypeScript and production build](build.txt): **passed**, artifact
`index-DN4pX3Za.js`. The [artifact check](artifact-verification.json) confirms the
current build identity and all **270 runtime source-map entries**. All **66
declared source hashes** match the reviewed files in the
[integrity report](source-hash-verification.json); hashes establish local byte
integrity, not source authenticity or native-game fidelity.

Production browser reports use the same final artifact:

- [Shared combat](shared/production/shared-combat.json): seven resolver-driven
  cases, two recipients per swing, independently checked freshness/staleness,
  rage, reference knockback and separate crouching-victim/attacker freeze.
- [Collision and Lab](collision/production/collision-parity.json): 17 region/SDI cases,
  continuous three-jab chains at 0% and 100%, and desktop/narrow save/reload and
  geometry previews. Both chains hit on displayed steps 7/28/45 with damage
  3.15/3.15/4.2 and no actionable gaps.
- [Specials](specials/production/specials-parity.json): 23 scenarios, 24 actual
  contacts, 338 freeze/release trace frames and 4,022 outer steps, covering the
  supported source launches, phases, charge and execution identities.
- [Defense](defense/production/results.json): 24 scenarios and 884 traced steps,
  covering measured dodge windows, mirrored rolls, landing commitment, release
  parries and shield-category freeze/stun. Both Lab viewports save/reload the
  authored timings. Outer clocks and unrelated gravity agree within numerical
  precision.

All four production harnesses passed with **zero page or request errors**.
Defense acceptance was completed on September 23. These checks use resolved
inputs and staged contacts; they do not establish human controller, audio or
balance acceptance. Narrow screenshots establish field access in the scaled
canvas, not a dedicated mobile layout.

Initial integration runs also exposed old rectangular-jab, immediate shield
re-raise and legacy-only charged-projectile fixtures. Their assertions now
exercise the new geometry and commitment while retaining parser/sound checks.
The earlier in-progress aggregate overlapped new ledge tests and older loaded
runtime code; it is retained as debugging evidence, not the final result.

## Remaining accuracy work

- Native angle367 and target-position linking rules for outer forward air and
  unsupported aerial Spin rungs; complete special trajectories, item behavior
  and animated sword-tip regions.
- Animated bone/hurtbox transforms, depth, nonzero attack parts and non-fighter
  target categories. Static projected capsule accuracy is already implemented.
- Native dodge travel, motion-dependent directional landing, dodge staling and
  spot-dodge attack cancel; full ledge clocks, limits and option invulnerability.
- Native SDI stick recognition, ASDI, shield SDI, world-contact restrictions and
  consecutive-ground-hit rules; electric attributes, shield geometry/overrides,
  1v1 damage bonus and remaining multiplayer parry-cap validation.

Link's grab/throw source records and release timing remain the separate next kit
audit. Passing the local suite does not establish the unimplemented rules above.

Replay playback remains ultralow priority; 3D, new art, wider roster tuning and
human/controller/audio acceptance remain outside this combined mechanics pass.
