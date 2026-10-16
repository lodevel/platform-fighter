# Gate merge applied (2026-10-14)

- Rehearsal (scratch copy): 74 written, 48 deleted; root tsc before == after (identical, 68 in the copy);
  tests after = before plus only the stale CameraController `snap()` test; CRLF 1602/1602; port typecheck, layers, build ok.
- Applied with `port/scripts/gate-merge.mjs --apply`: 74 files written, 48 deleted (list in apply.txt).
- Root tsc on the real tree: 56 errors, identical to tsc-baseline.txt (tsc-after.txt).
- vitest src/stages scenes entities physics camera: 2 failed | 1451 passed. Failures are only
  CameraController `snap() removes any smoothing residual` and the PreloadScene teardown test (vitest-summary.txt).
- Port: typecheck ok (12 ignored errors in game files outside port/), layers ok, port vitest 9 passed, port vite build ok (port-checks.txt).
- No "MERGE AT THE GATE" notes remain under src/ or port/src.

## Open items
- `port/scripts/vendor-matter.mjs` still has `OUT = port/src/pending/physics/matter`. The merge moved the vendored
  Matter to `src/physics/matter`, so `--check` now fails with ENOENT (and a regenerate would recreate `pending/`).
  Manual compare: every file under src/physics/matter/source/lib and CustomMain.js is byte-identical to node_modules.
  Fix: point OUT at `src/physics/matter`.
- `port/src/pending/` remains as an empty directory tree (no files); the script only deletes files.

## Closed by the coordinator

1. `port/scripts/vendor-matter.mjs`: `OUT` now points at `src/physics/matter`; `--check` passes (28 files).
2. `port/src/pending/`: contained 0 files; the empty directory tree was removed.

## Post-merge check (build index-OnRTcUZa.js)

- Boots: yes (no page errors).
- Goldens (golden-2026-10-14, not re-recorded): 18/18 IDENTICAL (plain, warmup 600, hz 144). See verify-post-merge.txt.
- Inferno: MatchScene on stage 'inferno', DK vs Pikachu (Hard CPUs), 600 frames stepped, no page or console errors, match still active. Screenshot: inferno-600.png (lava pit and platforms render, fighters on the main platform).
