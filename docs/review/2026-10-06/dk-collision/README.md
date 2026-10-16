# DK collision corrections

Pipeline: Ultimate/UFD Donkey Kong, existing appearance. Scope: address concrete
collision errors after the user prioritized hitbox correctness and accepted the
existing animation flaws. No art generation or source damage/launch retuning.
This is a targeted correction, not a claim of complete Ultimate collision parity.

## Findings and fixes

| Error | Corrected behavior |
| --- | --- |
| Angled forward tilts called the source overlay without authored positions. Both arm regions collapsed to x=60, losing the deliberate fist reach. | All three regions retain the neutral tilt's authored spacing and the variant's vertical offset. |
| Neutral air's middle window silently replaced its arm/hip geometry with generic anchors, then switched back for the late window. | Removing the one-frame root sphere leaves the three continuing regions in their deliberate positions; no accidental flip or extra phantom reach. |
| Aerial Spinning Kong put its outer and inner regions at identical anchors, with asymmetric left/right reach. | Four explicit regions occupy the two outer and two inner arm positions. |
| Hurtbox offsets were always transformed as facing right, although the debug overlay correctly mirrored them. | Actual contact selection, hurtbox modifiers and sweet spots use the defender's current facing independently of the attack axis. |
| Contacts were considered only when an attack sensor touched the fighter's movement collider. An extended limb outside that collider could never receive a hit. | Each Matter substep also samples actual live attack sensors against live hurtbox candidates, then uses the same shape/mask/priority/intangibility/confirmation path. The movement collider stays independent. |

Missing non-root geometry now throws during DK kit construction instead of
silently substituting a generic anchor. Full-punch waist regions and the grounded
spin opening's shoulder have explicit entries. Windowed moves use their window
geometry rather than attempting to construct an unused parent region set.

## Source and geometry contract

The existing [numeric source captures](../dk-all-attack-values/sources/verified.json)
and [motion records](../../2026-09-25/donkeykong-character/motion/) remain the
source inventory. The [UFD legend](https://ultimateframedata.com/smash) and
[DK page](https://ultimateframedata.com/donkey_kong) were checked on October 6.
Red/pink attack overlays and pale body overlays were distinguished; source PNGs
were inspected at full size before modifying placement.

Inspected source indices: `DonkeyKongFTilt` 0/7; `DonkeyKongFTiltUp` 7;
`DonkeyKongFTiltDown` 7; `DonkeyKongNAir` 9/10 and the second contact sheet;
`DonkeyKongSpinningKongA` 3/11 and the first contact sheet;
`DonkeyKongGiantPunchGMax` 18. GIFs/extracted PNGs remain in the existing ignored
`assets/gen/dk-ufd/` capture with hashes in the September source manifest.

Root regions continue using z-forward at 5 pixels/unit and screen y=42-5*native_y.
Non-root geometry is a **deliberate 2D adaptation**, not reconstructed native bone
transforms. Tilt vertical translations -18/+27 preserve the existing project
projection; they are not measurements of exact source angles. Neutral air holds
its existing arm/hip positions rather than reproducing the native rotation.
For aerial spin, source frame 12 shows distinct outer and inner regions, while
the pinned script places them at bone-local x=6/-4. The held side-on projection
uses outer x=+/-85 and inner x=+/-35 at y=-18, preserving that 50-pixel separation.
Native radii, IDs, masks, damage/launch and hit clocks remain independently sourced.

`donkeykongCollisionGeometry.ts` contains the affected authored projections;
`donkeykongSourceMoves.ts` overlays the native numeric records without replacing
authored geometry. These are consumed by the standard attack and saved-kit paths.

## Verification

[Independent comparison](source-comparison.json): all **138 source records across
42 motions**, **29 timing comparisons** and the full saved-kit round trip pass
with zero numeric mismatches.

**268 unique tests across 12 files pass.** Commands:

```bash
npx vitest run src/characters/DonkeyKong.collisionGeometry.test.ts src/match/HitboxDamageHandler.collisionHits.physics.test.ts src/characters/DonkeyKong.attackValues.physics.test.ts src/characters/DonkeyKong.recovery.physics.test.ts src/characters/DonkeyKong.physics.test.ts src/characters/attackCollisionShapes.test.ts
npx vitest run src/match/HitboxDamageHandler.test.ts src/characters/characterCollisionSerializer.test.ts src/characters/characterFactory.test.ts src/characters/authorableCharacterRegistry.test.ts src/characters/DonkeyKong.smashKeys.physics.test.ts src/characters/DonkeyKong.knockback.physics.test.ts
```

The final four added extended-limb tests and the damage-handler suite were rerun
after adding live candidate sampling: 77/77 pass. Physics checks explicitly
establish zero Matter movement-body pairs but one actual sensor-to-hurtbox hit,
correct mirrored limb contact, an off-capsule corner miss, intangible limb
protection and one-hit confirmation.

Production acceptance uses an isolated source/runtime-asset snapshot at
`/tmp/platform-fighter-dk-collision-20261006` so parallel Pikachu work cannot
change the source underneath the browser. `npm run build` passes, including
palette generation, TypeScript and Vite. Generation intermediates were excluded
from the public assets. This snapshot is not a deployed site.

- URL: `http://127.0.0.1:4177/platform-fighter/`.
- Bundle: `index-8IroiRev.js`.
- Bundle SHA-256: `829ebb580aba6d4c9a00fd5f5b0dcc9be28410320976d1bbd450e9cbcaa1a3af`.
- Engine identity: `platform-fighter-sha256-64115ec30f2a55481f0dd75ba41e38fc6cdb24fb6b62bfa858406bf117a229d9`.

[Before](before/report.json): the unchanged earlier production bundle has
**23 failures in 42 cases**. [After](browser/report.json): **42/42 pass**, zero
page errors. These measure both facings, fist reach/outside misses, neutral air's
one-frame sphere/continuing/late regions, aerial spin's inner/outer reach and
outside miss, mirrored hurtboxes, extended-limb contacts, intangibility and
capsule-corner rejection. Actual live MatchScene sensors and normal damage
delivery decide contact. Controlled one-pixel recipient hurtboxes and positions
isolate the geometry; pinning bodies at the measured frame boundary avoids
movement confusing that measurement. These cases do not establish native 3D
collision or ordinary recipient-size matchups.

An initial eight-case diagnostic fixture landed the aerial attacker on an upper
platform before the continuing window. It was corrected by placing aerial
fixtures farther up and away from that platform; the interrupted report is
archived as `before/diagnostic-before-fixture-fix.json` and is not successful
evidence.

[All-move regression](all-moves/report.json): **94 scenarios, 227/227 checks pass**,
both facings, all implemented attack routes, grab variants, pummel, normal/cargo
throws, grounded/aerial special variants and shield bonus. Aerial spin connects
all 14 ladder hits in this fixture. Actual ordinary body contacts and physics
run without the collision probe's one-pixel hurtbox substitution.

The [match image](browser/match.png) was inspected: existing DK artwork renders.
It does not establish per-pose art/hurtbox agreement.

[Lab acceptance](lab/registry-lab-observations.json): **3/3 checks pass**, zero
page errors. Pointer-selected DK saves all 22 live attacks and grab, enters a
match with unchanged tuning, returns to Lab with its complete draft, and
reconstructs the complete saved kit after a page reload. The saved
[Lab image](lab/dk-live-kit-saved.png) was inspected. Its bundle hash matches
the collision and all-move evidence.

The verified snapshot's `dist` was subsequently copied into the workspace's
local `dist`. The existing port-4176 preview now serves `index-8IroiRev.js`;
the downloaded response has the same SHA-256 shown above. This local build
excludes the separate, unfinished Pikachu work and does not update a deployed
site. Browser acceptance was run on the identical snapshot bundle at port 4177.

### Final build after shared throw-event support

Pikachu preparation subsequently added optional catch-only held-target throw
events to the shared runtime. The
[throw event record](../pikachu-character/throw-events/README.md) describes that
change and its source scope. The isolated snapshot was rebuilt with those shared
files; the unfinished Pikachu fighter remains outside this production roster.

The final bundle is `index-CfNjrSwJ.js`, SHA-256
`ab22b1b70d1f97e475bf73815ea65e7234fc83971613c9feb1849c2b8468bd36`, engine
`platform-fighter-sha256-983363cc56c277877edde0d9e6c7f90283df42aaa9a5ec481e347ce9e8d4ab22`.
Against that exact bundle, [collision acceptance](shared-throws/browser/report.json)
again passes **42/42**, [all moves](shared-throws/all-moves/report.json) passes
**94 scenarios / 227 checks**, and
[Lab save/reload](shared-throws/lab/registry-lab-observations.json) passes **3/3**.
No page errors occurred. The workspace's local `dist` is updated to this final
verified bundle. Earlier reports and the unchanged-production baseline remain
preserved above.

## Remaining collision limits

DK still lacks complete pose-following native hurtbox volumes and per-bone
intangibility. Limb attack projections still hold representative positions or
capsules rather than native animated 3D transforms. Accepted artwork can therefore
remain misaligned with those deliberate projections. The new candidate path
supports hurtboxes outside movement bodies; it does not author missing anatomy.
Native bury, attack-clash/no-rebound behavior and exact autolink transport also
remain the previously documented engine gaps. Source numeric agreement does not
remove these limits.

Reproduction with the verified preview running:

```bash
node tools/dk-collision-acceptance.mjs http://127.0.0.1:4177/platform-fighter/ docs/review/2026-10-06/dk-collision/browser
node tools/dk-all-moves-acceptance.mjs http://127.0.0.1:4177/platform-fighter/ docs/review/2026-10-06/dk-collision/all-moves
node tools/dk-lab-acceptance.mjs http://127.0.0.1:4177/platform-fighter/ docs/review/2026-10-06/dk-collision/lab
```
