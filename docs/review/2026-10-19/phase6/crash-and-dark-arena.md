# Phase 6: the rehit crash and the yellow-on-black arena

Two open items from [held-items.md](held-items.md). Date: 2026-10-19. Evidence: [crash-and-dark-arena/](crash-and-dark-arena/).

## 1. Crash: "Repeating attack contact requires an explicit non-negative gameplay clock"

### Cause

Seed 20261022 (drift-tool setup: 4 hard CPUs, flat, held weapons only), frame 1043. One contact batch holds:

| Pair | Effect |
| --- | --- |
| P1 Pikachu up-air → P2 Pikachu | Hit lands. P2's forward air ends (`getActiveAttack()` is now null). |
| P2 Pikachu forward air → DK | Same step. The sensor is still in Matter's pair list. |

Pikachu's forward air re-hits per target (`rehitClockPolicy: 'authored-attack-elapsed'`).
MatchSim's clock lookup read the attacker's *live* attack. By the second pair it was gone, so the lookup returned null and the ledger threw.

All contacts of one physics step land together (a trade, as in Ultimate). Ordinary swings already behaved so. Only repeating swings needed a clock and crashed.

### Fix

- `MatchSim` samples every live strike's re-hit clock on Matter `beforeUpdate`, before any contact of that world step resolves (`sampleRehitClocks`).
- The lookup reads that sample. A strike whose attacker is hit earlier in the same batch keeps the clock it had.
- Same policy check as before (aerial, authored attack-elapsed). The ledger's check is unchanged.
- The sample lives inside one world step, so it adds no checkpoint state.

### Test

`src/sim/MatchSim.test.ts` › "keeps a repeating strike on its step clock…": seed 20261022 to frame 1043, both Pikachus in up-air / forward air, one step, P2 is hit and its fair has ended.
It fails before the fix with the ledger error, and passes after.

### Seed scan

40 seeds (20261001–20261040) × 10,800 frames, 4 hard CPUs (DK, Link, Pikachu ×2, rotated), items `high`, 20 in parallel under the heavy lock.
Even seeds: held weapons only. Odd seeds: every item (Smash Ball included). Stage rotates over all six. Data: [seed-scan.jsonl](crash-and-dark-arena/seed-scan.jsonl).

| Seeds | Frames run | Throws |
| --- | --- | --- |
| 40 | 432,000 | 0 |

## 2. Arena drawn yellow on black

### Cause

Not a stage, Final or lighting state. It is a clock running backward in `StagePresenter.frame`.

1. The probe steps thousands of frames in one `page.evaluate` (3–8 s blocking), then `__sim.draw()` renders at `performance.now()`.
2. Edge's next animation frame carries a stamp from before that blocking task (measured below).
3. `frame()` took `dt = min(now - last, 100)` with no lower bound: about −3 to −8 s.
4. Sky Ruins blends its mood with `k = 1 - exp(-2.2 * dt)`. With dt = −8 s, k ≈ −4·10⁷. The page opens on the gate (night) and the match sets sunset, so the blend still has a residue. The colours overshoot and clamp to yellow, black and blue.
5. The blend takes many seconds to come back, so the screenshot catches it.

The longer the block, the worse the overshoot. That is why Pikachu's legacy run (shortest) looked normal. Link's Final draws no backdrop.
Normal play is not exposed: only animation-frame stamps reach `frame()` there. The match screen already clamped its own delta at 0.

### Fix

- `port/src/engine/frameDelta.ts`: `frameDeltaMs(now, last, max)`, clamped to [0, max]. It is the one delta rule for the presenter, the match screen and the fighter-select screen.
- `StagePresenter.frame` uses it and keeps `last` monotonic (`max(last, now)`).

### Checks

- `port/src/engine/frameDelta.check.ts`: never negative, capped.
- `port/src/arena/presenter.check.ts` › "stage clock": an older stamp after a draw hands the stage dt = 0. Before the fix it gets −30 s.

### Edge (real GPU), same shots as the held-items probe

`.tmp/crash/dark-probe.mjs`, pre-fix build and fixed build. "Yellow" = share of pixels with R, G > 200 and B < 60. "RAF − draw" = next animation-frame stamp minus the draw time.

| Fighter | Packages | Block (ms) | RAF − draw (ms) | Yellow before | Yellow after |
| --- | --- | --- | --- | --- | --- |
| Pikachu | none | 3,463 | −3,535 | 0.07 % | 0.07 % |
| Pikachu | all | 3,973 | −3,972 | 2.75 % | 0.07 % |
| Link | none | 6,773 | −6,841 | 15.2 % | 0.07 % |
| Link | all | 6,777 | −6,772 | 15.4 % | 0.07 % |
| DK | none | 7,705 | −7,775 | 21.4 % | 0.07 % |
| DK | all | 7,717 | −7,717 | 22.0 % | 0.07 % |

The 0.07 % is the normal arena's own yellow. Frames: DK [before](crash-and-dark-arena/donkeykong-packages-before.png) and [after](crash-and-dark-arena/donkeykong-packages-after.png), and Link in his Final [after](crash-and-dark-arena/link-packages-after.png). Reports: [before](crash-and-dark-arena/edge-before.json), [after](crash-and-dark-arena/edge-after.json).

## Verification

`npm run typecheck` passes. Targeted vitest passes: `src/sim`, `src/replay` and `src/match` (63 files), the rehit physics tests, the golden replays and the two port checks. `npm run build` passes.

## Open

- The frames in [held-items/](held-items/) were taken before this fix. Re-run `tools/package-held-items-probe.mjs` to refresh them. The item placement they show is unaffected.
