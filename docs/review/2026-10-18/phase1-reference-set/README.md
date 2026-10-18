# Phase 1: reference set and envelope

2026-10-18. Closes Phase 1 of the [character system roadmap](../../../CHARACTER-SYSTEM-ROADMAP.md).
Reviewed by the user on a preview page that plays every motion with today's art
at match size (zoom 1.4, 1920×1080 buffer), both facings, dark/light stage:
https://claude.ai/artifact/C5w9UnEqXHeuPsuGJ23WFX (private to the user).

## Reference motions

Ten per fighter: Donkey Kong (unarmed, largest bank) and Link (armed). Costs are
uncompressed sheet bytes; heights are the tallest drawing on screen at zoom 1.4.
Figures come from installed metadata ([reference-set.json](reference-set.json));
previews were rendered by [build-previews.py](build-previews.py).

| Role | Donkey Kong | Link |
| --- | --- | --- |
| Idle | `idle` 12 drawings, 2.4 MiB, 160 px | `idle` 11, 1.4 MiB, 137 px |
| Run | `run` 6, 1.8 MiB | `a02run` 5, 0.6 MiB |
| Turn | `run_turn` 6, 1.9 MiB | `a02turnrun` 5, 0.7 MiB |
| Quick attack | `jab` 7, 1.7 MiB | `jab` 6, 1.1 MiB |
| Broad attack | `smash` 12, 4.1 MiB | `smash` (two-hit) 11, 1.8 MiB |
| Recovery / spin | `up_special_air` 12, 5.2 MiB | `d02specialairhi` 13, 3.4 MiB |
| Throw | `bthrow` (spinning) 12, 3.6 MiB | `e01throwb` 10, 1.5 MiB |
| Being held | `captured` 6, 1.8 MiB | `e02capturewaithi` 9, 1.1 MiB |
| Held item | `item_bat_swing_4` 12, 3.8 MiB | `h04swing4` 11, 1.7 MiB |
| Final Smash phase | `final_attack` 74, 70.8 MiB | `d04final` 72, 12.7 MiB |
| Set total | 97.1 MiB | 25.8 MiB |

Whole banks today (all runtime sheets): DK 682 MiB uncompressed / 171 MiB BC7,
Link 281 / 70, Pikachu 366 / 91. Pikachu, a third body shape, joins in Phase 5.

## Decisions (user, 2026-10-18)

- Today's art is the **test material, not the quality ceiling**. Its motion is not
  the best achievable; a candidate may move differently, and difference from the
  current drawings is not a defect in itself.
- The **20/20 motion reference is the original Super Smash Bros. Ultimate move**,
  as documented by Ultimate Frame Data and SmashWiki. Candidates are judged by how
  close their motion gets to the Ultimate original, in the project's own 2D art
  style (docs/ART-STYLE.md); today's sprites sit somewhere below that mark.
- The user has **no metric goals**. The limits below are accepted as guidance; the
  aim is a smarter use of the available tools (reuse, deformation, computed poses,
  compression, generation) rather than hitting numbers.

## Envelope (guidance)

| Area | Guidance |
| --- | --- |
| Look | The user scores each candidate motion against the Ultimate original (20/20) at match size: both facings, dark/light stage, default and one recoloured costume; Final also at zoom 2.8. The lab shows the Ultimate reference, today's art and the candidate together |
| Gameplay alignment | Gameplay is unchanged (hitboxes, hurtboxes, roots, damage, event order on recorded inputs). Drawn hits, contacts and releases line up with those gameplay frames and positions; held items stay attached to the drawn hand |
| Transitions | No visible jump where stored drawings and computed poses meet |
| Fighter memory | Complete fighter about 128 MiB uncompressed, ideally 64 MiB; any single motion above 8 MiB is reviewed |
| Performance | Frame time and match loading no worse than today on the reference PC (mean 4.0–4.4 ms, p99 8–10 ms, 4.6–5.0 s Full quality) |
| Automation | One script rebuilds the motions from accepted sources; hand corrections are rare and their time is recorded |
| Reference device | Windows Edge, Intel Iris Xe, 1920×1080, DPR 1, with a DPR 2 check |

The proposal's per-frame silhouette-overlap and 2 px hand-position limits are
dropped: both measured closeness to today's drawings, which the decision above
rules out as a goal.

## Ultimate references available locally

Git-ignored UFD hitbox recordings (local reference only, not shipped):
`assets/gen/dk-ufd/sources/` and `extracted/` (DK attacks, throws, specials) and
`assets/gen/link-rework-ufd/` (Link attacks, throws, spin attack, ledge).
They cover the reference set's attacks, throws and recoveries: DK `Jab1`,
`FSmash`, `SpinningKongA`, `BThrow`; Link `Jab1`, `FSmash1`/`FSmash2`,
`SpinAttackA`, `BThrow`. UFD has no idle, run, turn, held-item, grabbed-victim or
Final Smash recordings; those references must come from other Ultimate footage
or SmashWiki media before Phase 3 scores them.
