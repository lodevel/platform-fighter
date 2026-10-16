# Production acceptance

Run against `http://127.0.0.1:4173/platform-fighter/`. The initial pass used `index-BM8sPag8.js`; the final 2026-09-10 floor-contact fix produced `index-N1cjduoM.js` (build log in `../build.txt`). Each harness used its own headless Chromium context with software WebGL at 1280×720. Older development and authoring evidence was preserved.

- `animation-runtime-observations.json`: six full strike timelines verify real contact/gap poses, reverse facing, F3 sensor geometry and swing trails. Pause and seven hitlag steps freeze the reverse sensor and sprite. Actual up-smash deals 4/3/11 at elapsed 9/24/40 and records one stale occurrence. All three scenario groups pass.
- `registry-lab-observations.json`: pointer-select Cat, save all 19 attacks plus grab, Test Fight with unchanged complete kit/tuning, then Return to Lab preserving the saved source and draft. Both scenario groups pass.
- `animation-first-strike.png`, `animation-harmless-gap.png`, `animation-reverse-strike.png`, `cat-live-kit-saved.png`: captured production screenshots. Visual inspection of the reverse strike and saved Lab screen found no new presentation regression relative to the development checks. Screenshots are not asserted pixel-identical.

Harnesses: `tools/link-hit-window-animation.mjs` with `PF_ANIMATION_URL` / `PF_ANIMATION_OUTPUT`, and `tools/registry-lab-acceptance.mjs` with `PF_REGISTRY_URL` / `PF_REGISTRY_OUTPUT`. This pass changed only harness output configuration and evidence; production source stayed frozen.

Final-build checks also cover `link-movement-probe.json` (139/66.9 px full/short jumps, 45/32/31/23 airborne durations, 4.62 air speed and persistent floor contacts), `acceptance.json` (20 menu/match/authoring journeys), and `cpu-first-controls.json` (four CPU-first joining/restoration paths through stage handoff and restart). The separate registry/Lab artifact retains its initial-build provenance; the final general journey harness independently repeats Link Lab save/test/return and tune handoffs.

After the floor-contact fix, movement, all 20 general journeys, all four control scenarios, animation, bomb/charge and CPU/projectile probes were rerun against `index-N1cjduoM.js`. Every process exited 0 with zero browser errors. Ordinary item-coordinate and separate registry/Lab evidence remains from the immediately preceding build; item and editor behavior also passed the final aggregate suite.
