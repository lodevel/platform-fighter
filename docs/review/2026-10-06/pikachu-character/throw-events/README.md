# Sourced catch-only throw event support

Scope: implement Pikachu's timed held-target strikes in the shared throw runtime.
This prepares the fighter's throw behavior; it does not register a complete
Pikachu, supply its animation or establish native posed collision parity.

Pinned primary scripts: [ThrowF](../sources/scripts/pikachu/ThrowF.txt) and
[ThrowHi](../sources/scripts/pikachu/ThrowHi.txt), revision
`59004685238a3f6f93bae905d3a4e079701c40b4`. Both explicitly call
`AttackModule::set_catch_only_all`. Source UFD totals are recorded separately in
the character source package.

| Throw | Source pre-hit game frames | Source pre-hit damage / hitlag factor | Release game frame / damage | UFD total |
| --- | --- | --- | --- | --- |
| Forward | 11, 15, 19, 23 | Each 2% / 0 | 30 / 2% | 43 |
| Up | 14 | 3% / 1.6 | 16 / 5% | 35 |

Forward cumulative damage is 2, 4, 6, 8, then 10% at release. Up damage is 3,
then 8% at release. Final launch uses the independently captured throw-absolute
record: forward angle45/base55/growth110; up angle90/base48/growth129.

Source game frame n converts to elapsed n-1. Forward release uses
`animationFrames:29` and `recoveryFrames:14`; up uses 15 and 20. Recovery is
`total - animationFrames`, preserving the final locked frame and first
actionable source frame44/36 respectively. Hit-stop pauses this gameplay clock.

`ThrowSpec.heldTargetHits` is an optional ordered array of elapsed `frame`,
`damage` and `hitlagMultiplier`. Validation rejects duplicate/out-of-order
frames, events at/after release, empty/nonarray events and invalid numbers.
The runtime adds damage only to the linked captive, retains the grab, applies
the source hitlag coefficient and launches only on the existing release event.
It pins the victim through the unreleased throw and drains captive hit-stop.
Interruption breaks both holding and throwing, discarding future events.

This path models catch-only held-target damage. It does not spawn collateral
throw hitboxes or measure contact against native posed hurtboxes. Captured
capsules and native attack metadata remain in the source package; those fields
do not imply a native skeletal collision consumer. Generic hit-stop arithmetic,
hold attachment and animations retain their documented engine limitations.

## Verification

- `Character.throwHits.physics.test.ts`: 5 real-Matter tests. Actual grab sensor
  contact establishes the hold; both facings measure every forward damage
  boundary, no bystander damage, no early launch, source actionable boundary,
  one release, up-hit clock pause, interruption and an entry-frame event.
- `characterThrowHitsSerializer.test.ts`: 14 checks for Lab numeric fields,
  saved parsing/serialization, factory reconstruction, cargo preservation and
  malformed data rejection. The edited damage is deliberately an authored tune.
- Shared schema/state regressions: 56 tests across throwSchema, grabState and
  grabSchema. Existing Character/factory/registry/DK physics: 559 tests.
- TypeScript and isolated production build pass.
- [Production browser report](browser/report.json): four forward/up scenarios,
  both facings, through actual MatchScene grab/contact/throw progression and
  damage. The controlled fixture uses existing DK bodies with the sourced
  Pikachu throw specs; this is shared-runtime evidence, not a Pikachu visual,
  roster, normal keyboard or full-kit match acceptance. Input is injected.
- The updated shared runtime also passes the
  [DK all-move regression](../../dk-collision/shared-throws/all-moves/report.json):
  94 scenarios, 227 checks, no failures or page errors.

Browser and regression share production bundle `index-CfNjrSwJ.js`, SHA-256
`ab22b1b70d1f97e475bf73815ea65e7234fc83971613c9feb1849c2b8468bd36`, engine
`platform-fighter-sha256-983363cc56c277877edde0d9e6c7f90283df42aaa9a5ec481e347ce9e8d4ab22`.
It was built in the isolated `/tmp/platform-fighter-dk-collision-20261006`
snapshot and served at port4177. The unfinished Pikachu preview uses a separate
build and identity.

```bash
npx vitest run src/characters/Character.throwHits.physics.test.ts src/characters/characterThrowHitsSerializer.test.ts src/characters/throwSchema.test.ts src/characters/grabState.test.ts src/characters/grabSchema.test.ts src/characters/Character.test.ts src/characters/characterFactory.test.ts src/characters/authorableCharacterRegistry.test.ts src/characters/DonkeyKong.physics.test.ts
node tools/pikachu-throw-acceptance.mjs http://127.0.0.1:4177/platform-fighter/
```
