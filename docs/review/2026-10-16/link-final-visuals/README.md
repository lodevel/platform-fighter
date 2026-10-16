# Link Final charge and arrow presentation

Accepted in the production build `game-_LoddHLw.js`, source `platform-fighter-sha256-e236b17191fa7db98aa7d508f28193b773b06ffa7632a37ea0ea5570b51cd1d9`. [qualification.json](qualification.json) retains the measured outcomes, source/build identities, independent authority trace hashes and visual review notes.

The owner animation already contained 72 ground and 57 air drawings. Actual every-tick draws in four seeded browser scenarios confirmed that complete inventory before and after; no missing owner drawing or sparse body-strip route was reproduced. The concrete visual gaps were the missing loaded arrow and charge light. The flying arrow travels 300 world pixels per tick, while its existing glow tail covered only 75 pixels; a nearby hit therefore exposed just one or two brief projectile drawings.

`port/src/match/effects/linkFinal.ts` now draws the loaded native arrow, a charge light, a short release flash and a tracer connecting actual successive projectile positions. It reuses existing arrow raster art, adds no body frames, and changes no gameplay clock, speed, lifetime, damage or collision. The tracer ends at the actual clamped impact point. Repeated draws retain the same segment; rewinds, owner/run changes and article absence clear local render history.

The loaded arrow uses retained native HaveR/HaveL hand projections from the same sampled body poses. [sources/native-hand-projections.json](sources/native-hand-projections.json) is the compact regeneration input, with original record paths and SHA256 provenance. `tools/link-final-visual-anchors.py` regenerates the bundled presentation JSON and its [source receipt](anchor-source-receipt.json). It does not depend on temporary renders. The fit and foreshortening between the projected hands are **authored**, since common article parenting remains unrecovered; the old two-frame authoring pilot is not treated as a qualified native transform.

Pinned native receipts are under `docs/review/2026-10-12/link-character/rework/`:

- `sources/native/link_ancientbowarrow/Have.txt`: flare at held-article entry; hold effect at held-article frame 35.
- `sources/native/link_ancientbowarrow/Fly.txt`: detach/turn off the flare at flight frame 6.
- `sources/native/scripts/Final.txt`: owner shoot at frame 60, ground attack smoke at 61, flare detach at 63. The air script supplies its corresponding owner schedule.
- `sources/native/link_ancientbowarrow/Stick.txt` and `StickWall.txt`: impact-effect control/lifetime.

Mapping held-article ages 0/35 to owner ages 0/35 is an **authored presentation choice**, pending confirmation of native article-generation timing. Owner shoot 60 and detach 63 are pinned owner events. Light color, shape, intensity and release-flash design are authored interpretations, not claimed exact native visual parity. Official visual references opened by the coordinator on 2026-10-16 were [Link](https://www.smashbros.com/en_US/fighter/03.html) and [Ultimate Frame Data](https://ultimateframedata.com/link); local native receipts govern the timing observations above.

The browser check used real saved DOM special input with explicit resource and placement fixtures. Four scenarios covered ground/air, right miss/left hit, palettes 0/3. Each tick used one `host.step` view and drew that view. All 494 authority ticks matched baseline exactly, including full digest, positions, velocity, damage, hitlag, hurtboxes, Final phase/clocks, article state, damage areas and events. Hits remained 44.1 damage; misses remained zero. All 60 charge ticks per case submitted the loaded arrow (240/240), with no stale loaded quad after release, no missing body ticks and no browser errors. Twelve focused presentation checks and TypeScript checks passed.

Actual screenshots of charge, release, flight, air and fighter blast were inspected in both facings. The loaded arrow follows the hands, charge light is readable, and the tracer fills the travel gap while keeping Link, the bow and victim readable. The coordinator independently accepted ground-right charge 55, first flight and travel 61. Independent natural RAF testing is retained in [Final pacing qualification](../final-visual-pacing/qualification.json): Link first-run maximum34.7 ms remained unchanged, warm repeat14.1→14.4 ms, p95 13.9–14.0 ms, zero gaps over50 ms/long tasks and no shader compilation; manual stepped capture rates are not performance measurements. This is a targeted Final visual check, not a full fighter audit or exact-source effect reproduction.

Reproduce against a fresh production build:

```sh
flock .tmp/dk-heavy.lock node tools/link-final-visual-probe.mjs --edge --expect-effects --url http://127.0.0.1:4173/platform-fighter/ --out .tmp/link-final-recheck
python3 tools/link-final-visual-anchors.py
```

For a future before/after comparison, first run the same harness against the baseline build without `--expect-effects`; pass that report to the candidate with `--compare /path/to/baseline/report.json`. The harness compares the independent authority trace and requires the simulation digest to remain unchanged around each draw.


After coordinator and independent visual acceptance, the bounded [cleanup plan](cleanup-plan.json) removed112 generated captures/full traces/harness copies (70,241,510 bytes) from this record's `before/` and `after/` folders. The compact qualification preserves source/build identities, measured outcomes, authority hashes and reviewed-capture hashes. Native hand source data, source receipt, generator/browser tools, production data and tests remain available. No other agent's reports or historical native inputs were removed.
