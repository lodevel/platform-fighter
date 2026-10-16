# Shared engine regressions after repeat/landing support

The immutable local snapshot at
`http://127.0.0.1:4179/platform-fighter/` serves `index-v5AbW1PH.js`, SHA256
`d065d3ec1d06f17296b2d9db22ecc0170a1b9fec04102c4e7643ff58767b2d3a`.
Its engine identity is
`platform-fighter-sha256-b574bd6fd79cb03ee4e396256dfd0f37bdf24dd5369c1ae51b073832a42fe40b`.

The shared changes pass these production checks on that same bundle:

| Check | Measured outcome | Artifact |
| --- | --- | --- |
| DK regional collision/hurtbox regression |42 scenarios, zero failures/errors|[collision/report.json](collision/report.json)|
| Source catch-only forward/up throw events in DK fixtures |4 scenarios, zero errors|[throws/report.json](throws/report.json)|
| DK move-family regression |94 scenarios/227 checks, zero failures|[all-moves/report.json](all-moves/report.json)|
| DK Lab pointer selection, save/reload and saved-fighter match |3 checks, zero errors|[lab/registry-lab-observations.json](lab/registry-lab-observations.json)|

The separately documented [source-built fair check](../fair-clock/README.md)
passes8 scenarios and [automatic landing check](../landing-browser/README.md)
passes38 scenarios against the same bundle. These are scoped shared-runtime and
DK regressions; they do not validate full Pikachu registration/art/physics.
Pikachu full roster/art/physics acceptance remains incomplete.
The prior DK source evidence, immutable earlier snapshot and isolated jab
preview are preserved rather than overwritten by these reports.

```
node tools/dk-collision-acceptance.mjs http://127.0.0.1:4179/platform-fighter/ docs/review/2026-10-06/pikachu-character/shared-regression/collision
node tools/pikachu-throw-acceptance.mjs http://127.0.0.1:4179/platform-fighter/ docs/review/2026-10-06/pikachu-character/shared-regression/throws
node tools/dk-all-moves-acceptance.mjs http://127.0.0.1:4179/platform-fighter/ docs/review/2026-10-06/pikachu-character/shared-regression/all-moves
node tools/dk-lab-acceptance.mjs http://127.0.0.1:4179/platform-fighter/ docs/review/2026-10-06/pikachu-character/shared-regression/lab
```
