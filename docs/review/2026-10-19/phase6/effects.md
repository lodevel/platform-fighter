# Phase 6 step 4: effects from character packages

Part of the [Phase 6 plan](PLAN.md). Date: 2026-10-18.

## Result

- The 12 effect strips are package actions named `effect.<name>`. The format did not change.
- A fighter drawn from its package draws its effects from that package. A legacy fighter keeps the legacy sheets.
- The game still decides where, when and how large. The package only answers "which drawing at this tick".
- In simulated matches, every effect sprite equals its package drawing: **7,808 effect sprite-frames, 0 mismatches**. All 12 strips were reached.
- In Edge (real GPU), the effects look the same in both modes. The remaining pixel differences in the crops come from the fighters' held body drawings.

## Inventory

Every `char.*` effect sprite drawn at runtime, before this step.

| Effect | Strip(s) | Placed by | Frame rule |
| --- | --- | --- | --- |
| DK Final (Jungle Rush) | `fx__donkey_final_rash`, `_rashhit`, `_arc`, `_lasthit`, `fx__donkey_giantpunch` | `buildSimView` → `selectFinalFxPresentation`: cue on the `top`/`hip` body point + offset, rotation, cue scale (1, 1.6 or 2), layer | Cue age → profile drawing (`finalFxDrawingAt`): one drawing per tick, stops at the end |
| Pikachu Final (Volt Tackle) | `fx__pikachu_final_hold`, `_sphere_start`, `_elec`, `_explosion` | Same, cue scale 0.8–1.2; `sphere_start` runs on the flight clock | Same; `hold`, `sphere_start` and `elec` loop every 8 ticks |
| Link bow arrow in flight | `fx__link_bowarrow` | `buildSimView` projectile → `projectileSprite` (port), rotated along the flight | Always drawing 0 |
| Link arrow stuck as an item | `fx__link_bowarrow` | `buildSimView` presentation sprite at the item root, item angle | Drawing 0 |
| Link boomerang | `fx__link_boomerang` | `projectileSprite`, mirrored for a left throw | `linkArticleDrawing`: spin angle → drawing 0–15 |
| Link Ancient Arrow, drawn back | `fx__link_ancientbowarrow` | `linkFinalCharge` (port): between the hands, stretched by the draw (`scaleX × extension`) | Drawing 0 |
| Link Ancient Arrow in flight | `fx__link_ancientbowarrow` | `buildSimView` at the article position | Drawing 0 |
| Link screen KO body | a body sheet (`installedPackedSheet`) | `buildSimView`, screen space, centre | Native samples at the KO age: the body action of the same name |

Link has no Final effect strip of its own; its flares and trails are shapes (`linkFinal.ts`).

## Format decision

- Each strip is an ordinary action `effect.<strip without fx__>`. The root is the effect's own origin; `bodyCentreFromRootY` is 0.
- The tick is what the game already computes: the cue age for Final effects (the schedule carries the loop or the stop), the drawing step for Link's articles (the boomerang's spin index, 0 for arrows).
- No schema change was needed. Rotation, mirroring, cue scale, stretch, depth and alpha are placement, which the game already supplies.
- The convention lives in `character/package/types.ts` (`EFFECT_ACTION_PREFIX`, `isEffectAction`).

## Holds and shrinking

| Tool | Effects | Why |
| --- | --- | --- |
| Holds (0.12, max 8) | Excluded | Each drawing shows for one tick of a 4–9 tick burst or one spin step. Holding drops visible animation for almost no saving. |
| Shrink (zoom 1.4, Finals 2.8) | Excluded: stored as drawn | Final effects are enlarged up to 2× by their cues in close-ups (DK rash: 0.25 × 2 × 2.8 = 1.4 screen px per page px). The final-zoom rule would store them at 0.7. Keeping them costs < 1 MiB per fighter. |
| 256-colour palette | Shared with the body | One palette per character, refitted with the effect pixels. |

Palette check (offline, costume 0, premultiplied RGBA, 0–255):

| Fighter | Body drawings before vs after the refit: mean difference | Body pixels changed by > 24 | Effect drawings vs source strips: mean difference (visible pixels) | Effect pixels off by > 24 |
| --- | ---: | ---: | ---: | ---: |
| DK | 0.30 | 0.003% | 4.9 | 0.02% |
| Link | 0.45 | 0.004% | 2.8 | 0% |
| Pikachu | 0.35 | 0.002% | 2.8 | 0% |

## Sizes (`npm run character:package`, 2 min 41 s)

| Fighter | Revision | Pages | Drawings | GPU before → after | Disk before → after |
| --- | --- | ---: | ---: | --- | --- |
| DK | `724c07729fc6` | 208 → 213 | 1,511 → 1,541 | 86,502,208 → 87,236,976 B (+718 KiB) | 19,651,808 → 19,913,367 B (+255 KiB) |
| Link | `53cd8f604519` | 229 → 232 | 1,653 → 1,671 | 32,405,936 → 32,555,008 B (+146 KiB) | 10,242,453 → 10,302,489 B (+59 KiB) |
| Pikachu | `600fbe24c9f6` | 205 → 209 | 1,157 → 1,185 | 19,711,200 → 20,661,968 B (+928 KiB) | 5,117,451 → 5,220,840 B (+101 KiB) |

The legacy strips these replace decode to 2.8 MB (DK), 0.57 MB (Link) and 3.7 MB (Pikachu) of RGBA.
The package adds about one byte per pixel of them.

## Code

| File | Change |
| --- | --- |
| `character/package/types.ts` | `effect.` action convention |
| `character/candidates/holdsCandidate.ts`, `shrinkCandidate.ts` | Effects are not held and not shrunk (importer version 3) |
| `src/finalSmash/finalFxProfiles.ts` | `finalFxDrawingAt`: the one age → drawing rule, used by the game and the exporter |
| `src/characters/actionDisplay.ts` | `effectAction(sheet)` |
| `scripts/character-package/legacyClips.ts` | Exports the 12 strips (`effectClip`) instead of skipping them; checked tick by tick like body clips |
| `src/sim/view.ts`, `src/sim/buildSimView.ts` | `EffectArtView` (`art`) on presentation sprites and Link projectiles: characterId, action, tick, facing, scale |
| `port/src/match/effects/packageEffects.ts` | `effectDraw`: legacy sprite, or the package drawing at the same place (costume 0, no tint, as legacy) |
| `port/src/match/effects/linkFinal.ts`, `linkArticles.ts` | Carry `art` |
| `port/src/match/matchView.ts` | One effect list for world, screen and diagnostics; `presentationSprites()` reports `fromPackage`, `drawnKey`, `onCanvas` |
| `scripts/character-package/displayEquivalence.test.ts` | Compares every effect sprite with its package art |
| `tools/package-effects-probe.mjs` | The Edge check below |

`packageLibrary.ts` and `packageSprite.ts` are unchanged: MatchView reads `packageLibrary.resident(id)` and compares the
selected profile with `packagePresentationProfile(id)`.

## Simulated check (`displayEquivalence.test.ts`)

Same 32 scenarios as step 0. For each effect sprite: the package drawing at `art`, its facing, its origin and its scale
times `art.scale` must equal the legacy draw.

| Action | Sprite-frames |
| --- | ---: |
| `effect.pikachu_final_sphere_start` | 1,976 |
| `effect.donkey_final_rash` | 1,116 |
| `effect.link_ancientbowarrow` | 1,076 |
| `effect.link_boomerang` | 996 |
| `effect.pikachu_final_hold` | 907 |
| `effect.pikachu_final_elec` | 823 |
| `effect.donkey_final_rashhit` | 396 |
| `effect.link_bowarrow` | 256 |
| `effect.donkey_final_arc` | 81 |
| `effect.donkey_final_lasthit` | 81 |
| `effect.donkey_giantpunch` | 64 |
| `effect.pikachu_final_explosion` | 36 |

Mismatches: 0. Body frames are still 247,000 with 0 mismatches. The exporter stays at zero differences.

## Edge check (`tools/package-effects-probe.mjs`)

Production build, `vite preview`, fresh Windows Edge, 1920 × 1080. Each scenario runs legacy and `?packages=all`
with the same setup and steps; every step is drawn. Captures: the first steps each effect shows, two ticks in.
The difference is measured in boxes around each effect's origin (RGB mean, 0–255; share of pixels off by > 24).

| Scenario | Effect sprite-frames | From package | Not drawn |
| --- | ---: | ---: | ---: |
| DK Final vs Pikachu | 190 | 190 of 190 | 0 |
| Pikachu Final vs DK | 313 | 313 of 313 | 0 |
| Link Final vs DK | 61 | 61 of 61 | 0 |
| Link bow tap, then boomerang | 108 | 108 of 108 | 0 |

| Capture | Effects (action@tick) | Mean difference | Pixels > 24 |
| --- | --- | ---: | ---: |
| DK step 29 | giantpunch@2 | 2.3 | 1.5% |
| DK step 44 | rashhit@2, rash@2 | 1.8 | 0.6% |
| DK step 176 | arc@2, lasthit@2 | 2.1 | 2.0% |
| Pikachu step 12 | hold@2 | 11.6 | 14.1% |
| Pikachu step 52 | sphere_start@2 | 4.2 | 4.8% |
| Pikachu step 242 | hold@7, elec@2 | 9.0 | 10.8% |
| Pikachu step 267 | elec@7, explosion@2 | 2.9 | 2.5% |
| Link Final step 2 | ancientbowarrow@0 | 14.9 | 18.8% |
| Link step 17 | bowarrow@0 | 6.1 | 5.4% |
| Link step 109 | boomerang@3 | 3.9 | 3.0% |

The larger numbers are body differences inside the boxes, not effect differences: the crops show the same effect
drawings, while Pikachu's mouth and Link's bow pose differ by the held body drawings (step 1 already accepted those).

Crops: [DK rash](effects/dk-final-0044-crop-legacy.png) / [package](effects/dk-final-0044-crop-packages.png),
[Pikachu elec](effects/pikachu-final-0242-crop-legacy.png) / [package](effects/pikachu-final-0242-crop-packages.png),
[Ancient Arrow](effects/link-final-0002-crop-legacy.png) / [package](effects/link-final-0002-crop-packages.png),
[boomerang](effects/link-articles-0109-crop-legacy.png) / [package](effects/link-articles-0109-crop-packages.png).
Whole first frames and all crops are in [effects/](effects/), numbers in [effects/report.json](effects/report.json).
Nine `404` console errors appeared in both modes alike (a resource the page asks for; not an effect or package file).

## Open

- **Screen KO body** carries `art` (the body action at the KO age, the same native-sample rule), but no scenario reached a screen KO, so it is not checked yet.
- **Screen KO costume:** legacy draws the KO'd Link in costume 0 whatever his costume; the package path keeps that. One field (`costume` on `art`) would fix it.
- **Step 5:** the legacy `char.*.fx__*` keys, `LINK_ARTICLE_SHEETS` drawing metrics and the legacy fields of `PresentationSpriteView` can go once packages are the only display. Gameplay still reads `getPackedBodyRenderMetrics('link', 'fx__link_ancientbowarrow')` for the draw-back geometry; that number has to move into game code first.
