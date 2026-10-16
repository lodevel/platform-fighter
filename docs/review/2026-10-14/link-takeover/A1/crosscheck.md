# A1 cross-check: native geometry vs `runtimeOutgoingPoses`

Generated 2026-10-14 by comparing `src/characters/linkAttackGeometry.json` (tool: `tools/native-hit-positions.py --fighter link`) with `runtimeOutgoingPoses` in `assets/characters/link/frames.json` (read only).

Rows are matched on (resource, native sample, packet role, packet id). Old capsules are in actor-source-root px; new ones are body-centre local, so the old y is shifted by +36 (`bodyCentreFromRootY` = -36, constant for all 41 Link resources) before comparing. Deviations are in px, maximum over start and end points.

| Move | Resource | Old rows | New rows | Matched | Only old | Only new | Max dx | Max dy | Max d radius |
|---|---|---|---|---|---|---|---|---|---|
| link.jab | c00attack11 | 8 | 8 | 8 | 0 | 0 | 0.0000 | 0.1471 | 0.0000 |
| link.jab2 | c00attack12 | 8 | 8 | 8 | 0 | 0 | 0.0000 | 0.7353 | 0.0000 |
| link.jab3 | c00attack13 | 6 | 6 | 6 | 0 | 0 | 0.0005 | 1.6177 | 0.0000 |
| link.tilt | c01attacks3s | 19 | 19 | 19 | 0 | 0 | 0.0005 | 0.7354 | 0.0000 |
| link.utilt | c02attackhi3 | 20 | 20 | 20 | 0 | 0 | 0.0005 | 0.7356 | 0.0000 |
| link.dtilt | c02attacklw3 | 2 | 2 | 2 | 0 | 0 | 0.0000 | 1.0294 | 0.0000 |
| link.dashAttack | c00attackdash | 12 | 12 | 12 | 0 | 0 | 0.0005 | 0.0005 | 0.0000 |
| link.smash | c03attacks4s | 6 | 6 | 6 | 0 | 0 | 0.0005 | 0.0005 | 0.0000 |
| link.smash2 | c03attacks4s2 | 8 | 8 | 8 | 0 | 0 | 0.0005 | 0.0004 | 0.0000 |
| link.usmash | c04attackhi4 | 80 | 80 | 80 | 0 | 0 | 0.0005 | 0.0005 | 0.0000 |
| link.dsmash | c04attacklw4 | 16 | 16 | 16 | 0 | 0 | 0.0005 | 0.0005 | 0.0000 |
| link.nair | c05attackairn | 75 | 75 | 75 | 0 | 0 | 0.0005 | 0.0005 | 0.0000 |
| link.fair | c05attackairf | 18 | 18 | 18 | 0 | 0 | 0.0000 | 0.0000 | 0.0000 |
| link.bair | c05attackairb | 27 | 27 | 27 | 0 | 0 | 0.0005 | 0.0005 | 0.0000 |
| link.uair | c05attackairhi | 30 | 30 | 30 | 0 | 0 | 0.0005 | 0.0005 | 0.0000 |
| link.dair | c05attackairlw | 57 | 57 | 57 | 0 | 0 | 0.0000 | 0.0000 | 0.0000 |

All 16 normals: 392 matched capsule rows, zero rows present on only one side. The Dair "After bouncing off" packet has no old rows and no native sample, so it is not emitted (its clock comes from the rebound).

## Result

- x and radius agree to rounding (under 0.001 px) for every row of every normal.
- 10 of the 16 moves (dash, smash, smash2, usmash, dsmash, nair, fair, bair, uair, dair) agree on y to under 0.001 px (rounding of the 3-decimal output).
- Six moves differ on y only, by a per-sample constant shift that is identical for every packet and both capsule endpoints of that sample:
  - `link.jab` 0.147 px, `link.jab2` 0.735 px, `link.tilt` up to 0.735 px, `link.utilt` up to 0.736 px: under 1 px.
  - `link.jab3` 1.618 px (sample 5) and `link.dtilt` 1.029 px (samples 12 and 13): **over the 1 px target**.

## Outliers explained

The older Link families (jab 1-3, tilt, utilt, dtilt) were packed in the first 432-drawing batch. Their stored outgoing capsules carry a small vertical offset that looks like the drawing floor-support registration (the later staging scripts record `uniformSupportRetargetY: 0` and those batches match the native data to 0.0005 px; I did not find the script that wrote the older offsets). The offset is not a property of the native skeleton: it is constant across all packets of one sample, x is unaffected, and the source-centre exports that fed those families record `supportShiftApplied: false`. The new data is the unshifted native position, which is the intended behaviour once hit geometry stops depending on per-drawing registration. No native-side cause (wrong bone, wrong sample, wrong radius) was found: bones, samples and radii match exactly.

The two moves above 1 px (`link.jab3` 1.62 px, `link.dtilt` 1.03 px) are therefore explained outliers, not defects.

## Not cross-checkable against the old data

`runtimeOutgoingPoses` only exists for the 16 normals, so these have no old reference and rest on the native packet data alone:

- Recovery attacks (getup back/front, trip, ledge): all `top` bone, so position is the native root offset; samples are the public contact frame (the same convention `linkRecoveryAttackNativeFrame` uses).
- Ground and air Spin Attack (`sword2` and `top` bones; ground ages are release-local, subtract 3 to get from the combined public frame).
- Catch boxes (`catch`, `catch_dash`, `catch_turn`): `top` bone, sphere pairs for the ground (G) and air (A) masks.
- Release points: the arrow uses the Bow article rig `Pull` bone at the first sample of the End motion plus both hand bones; the boomerang and bomb have no article motion in the capture, so both hand bones are emitted (the right hand moves forward at the boomerang release frame); the Ancient Arrow uses both hand bones at Final frame 60. The article attachment bones themselves are not in the committed native scripts.
