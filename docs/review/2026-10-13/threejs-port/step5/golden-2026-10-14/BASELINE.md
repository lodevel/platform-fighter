# Baseline 2026-10-14

- Build: dist/assets/index-Dy8I1zeM.js (vite build, 2026-10-14; earlier bundles bsQ4wm9g and C0Htf94w failed to boot on Link data errors)
- Boots: YES (PasswordGateScene active, no page errors).
- Goldens recorded (CPU vs CPU, Hard): flat-items 1800, lava 1800, moving 1800, wind 1800, crumbling 1800, ffa-items 2400 frames.
- Verify (plain / warmup 600 / hz 144): 18/18 IDENTICAL, see verify-baseline.txt.
- tsc errors: 58 on the final build (56 on the first run, before the Link fixes; tsc-baseline-first.txt)
- vitest (run before the Link fixes; not rerun) (2 workers, no OOM): Test Files 92 failed | 477 passed (569); Tests 204 failed | 12159 passed (12363); 3503 s

Failing files by top-level folder (count, folder):
```
     64 src/characters
      8 src/input
      5 src/replay
      4 src/items
      3 src/characterBuilder
      2 src/ui
      1 tools/link-runtime-input-origin.test.mjs
      1 tools/link-runtime-geometry-proof.test.mjs
      1 src/scenes
      1 src/match
      1 src/camera
      1 src/assets
```
Full list in vitest-baseline.txt (FAIL lines) and vitest-baseline.raw.txt.

## Coordinator note (after the boot fixes)

- The two extra tsc errors of the second count came from the boomerang fix (`possibly undefined` on the window arrays); the windows are now `as const` tuples. **tsc baseline: 56**, identical to `tsc-baseline-first.txt` (now also `tsc-baseline.txt`).
- Boot fixes made before recording (both Link data the other AI left invalid):
  - `linkFreshNormals.ts`: an open-ended auto-cancel window (UFD ">N") now ends at the move's `animationFrames` instead of `null`.
  - `linkFreshSpecials.ts`: `boomerang.outboundFrames` 0 → 45, the tilt throw's clean+late phases (SmashWiki 27–71) from `LINK_BOOMERANG_REFERENCE_WINDOWS`.
- The goldens above are bound to bundle `index-Dy8I1zeM.js`; the `as const` change is type-only and does not alter the bundle's behaviour.
