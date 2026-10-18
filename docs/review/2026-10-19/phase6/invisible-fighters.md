# Phase 6: fighters that were drawn as nothing

Date: 2026-10-18. Follows [step0.md](step0.md) (its 1,531 "nothing drawn" frames).

## Result

Link vanished in two states. Both are fixed. DK and Pikachu never vanished.

| Scan (hard CPUs, headless MatchSim, art selector per frame) | Before | After |
| --- | ---: | ---: |
| Probe match (`tools/package-match-probe.mjs` config: DK, Link, Pikachu, DK; flat; seed 20261019; 3,600 steps) | 410 | 0 |
| 36 matches: 6 stages × seeds 101–106, items high, Finals on, 5,400 steps, rotating roster | 8,090 | 0 |
| Display equivalence (step 0 matches): fighter-frames drawn / nothing drawn | 245,469 / 1,531 | 247,000 / 0 |

Frames drawn as nothing, by state (36-match scan, before):

| Fighter | State | Candidate sheet | Frames |
| --- | --- | --- | ---: |
| Link | Special fall after the aerial Spin Attack | `up_special` | 7,976 |
| Link | Touchdown step of that special fall | `up_special` | 107 |
| Link | Heavy item carry, walking | `super_lift_walk_slow` / `_middle` | 7 |
| Link | Heavy item carry, standing (found by the regression test) | `super_lift_wait` | — |
| DK, Pikachu | any | — | 0 |

A human reaches both. Every aerial Up Special ends in special fall, so Link was invisible for the whole fall.

## Cause 1: Spin Attack special fall

- `FreshLink.getActiveAttack` keeps reporting the spin as an active `link.up_special` while the spin is in its `helpless` phase (until it lands).
- Link's intrinsic body route stops at that phase on purpose, so the packed body fell to the `activeAttack` branch.
- That branch asks for sheet `up_special`. Link has no such clip and draws nothing for a missing sheet.

Source: SmashWiki, Link (SSBU) Spin Attack: the aerial version leaves Link helpless. Ultimate's status is FallSpecial (`fall_special`), then LandingFallSpecial (`a04landingfallspecial`).

Fix: `baseBodyCandidate` (packedBodyPresentation.ts) ignores an active attack while the body is helpless. The existing helpless rules then draw it: `fall_special` in the air, the special-fall landing on the touchdown step. Gameplay is unchanged: `getActiveAttack` still reports the spin.

## Cause 2: heavy item carry

- The packed body state named every carry with DK's own motions (`super_lift_*`). Link has none of them.
- Link's equipment route already used the common motions: walk = `item_heavy_walk`, standing = the lift's last drawing (`item_heavy_get` at 24).

Fix: one function, `groundOnlyHeavyCarryMotion` (donkeykongHeavyItems.ts), now serves both the packed body (Character.getPackedBodyState) and Link's body route. The carry carries an explicit `carry` flag instead of a sheet-name test. Link aliases `item_heavy_walk` → `h03heavywalk`. DK keeps `super_lift_*`.

## Code

| File | Change |
| --- | --- |
| src/characters/packedBodyPresentation.ts | Helpless skips `activeAttack`; `heavyItem.carry` marks the carry rest |
| src/characters/Character.ts | Ground-only carries use `groundOnlyHeavyCarryMotion` |
| src/characters/donkeykongHeavyItems.ts | New `groundOnlyHeavyCarryMotion` |
| src/characters/linkCommonBodyRoute.ts | Uses the same function (same result as before) |
| src/characters/linkPackedBodyProfile.ts | Alias `item_heavy_walk: 'h03heavywalk'` |
| src/characters/packedBodyVisibility.test.ts | New. Keyboard aerial Spin Attack through fall and landing; heavy carry standing and walking. Both failed before |
| scripts/character-package/displayEquivalence.test.ts | Now also requires zero "nothing drawn" frames |

No package action was added or renamed. The shipped packages do not need rebuilding.

## Checks

- `npm run typecheck`: clean.
- `npx vitest run src/characters src/items src/characterPresentation`: 291 files, 5,691 tests pass.
- `npx vitest run scripts/character-package`: 35 tests pass; 0 mismatches, 0 nothing drawn.

## Open

| Gap | Note |
| --- | --- |
| Special fall ignores drift | Link has `fall_special_f` / `fall_special_b`; the shared helpless rule draws only `fall_special` (DK too) |
| Heavy carry standing | No captured heavy wait motion; the lift's last drawing holds, as Link's equipment route already did |
