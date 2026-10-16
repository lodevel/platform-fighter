# Applying UFD stats to Link

Source: [Ultimate Frame Data stats](https://ultimateframedata.com/stats), checked September 23, 2026. The page is a primary project reference alongside [Link's move page](https://ultimateframedata.com/link). The initial comparison found Link's air speed, fall limits, jump heights, weight and ordinary landing values already represented, but ground locomotion was still using generic speed ratios.

| Ground motion | Previous configuration | UFD native value | Current world value |
| --- | --- | --- | --- |
| Maximum walk | 3.51 px/step | 1.247 | 6.235 px/step |
| Initial dash | 7.02 px/step target, reached by acceleration | 1.98 | 9.9 px/step entry burst |
| Sustained run | 7.8 px/step | 1.534 | 7.67 px/step |
| Initial dash duration | 12 steps | 12 frames | 12 steps |

The project uses five pixels per source distance unit and a fixed 60 Hz step. Native values and their source are held separately in `src/characters/linkUfdStats.ts`; the fighter profile converts them to world units. The runtime now supports a fighter-authored immediate dash start and does not damp it to the lower run-speed limit. Existing generic fighters retain their acceleration-based entry. Fresh attack input takes precedence over this burst, preserving standing-move classification.

Locomotion fields survive character parsing, save/load and factory construction. Partial tuning overrides retain the rest of the fighter profile, and tuning edits re-resolve the locomotion state configuration.

This change does not establish native movement trajectories: walking/running acceleration, dash deceleration and turnaround details remain engine adaptations. The stats page's base/additional air acceleration and pivot-dash duration are recorded for subsequent work. Ordinary movement gravity/jump integration remains calibrated; the native gravity value used for reference knockback is a separate setting. Where the stats table and individual move page differ (for example neutral air-dodge intangibility), the existing measured implementation is retained pending reconciliation.

## Artwork

The built-in image generator was tried for a dedicated Link up-tilt sequence using the existing tilt and up-air sheets as identity/style references. Its output was rejected by the image service, so no image was produced or installed. The user was asked which alternate generator they can supply. No API/CLI fallback was run.

Animation work remains based on UFD's visible poses and timing, with consistent body/weapon anchors. The [frame-inspection audit](../frame-inspection/README.md) documents the visible-reach mismatch and missing poses. Generated images need inspection and packing before being used as game sprites; timing and collision data stay deterministic.

## Verification

The final focused run passes **947 tests across ten files**, including nine real-Matter locomotion tests, nine locomotion import/save tests, the existing Character/Link suites, air movement, serialization, factory and roster checks. TypeScript passes. The old Link run-speed fixture now expects the sourced value; real-contact tests allow the independently observed 0.004 px/step floor-friction reduction.

The production probe in [tools/link-movement-probe.mjs](../../../../tools/link-movement-probe.mjs) now measures initial dash and sustained run in both directions in addition to its four jump arcs and air speed. Its air-control input begins on the first fully airborne step, so the measurement does not inherit a grounded dash impulse on the takeoff step. [Measured results](browser/link-movement-probe.json) show 9.896 px/step during the initial dash and 7.666 at sustained run, with 4.62 isolated air speed and unchanged hop heights/timings. No page errors occurred.

Build and browser checks use temporary synchronous file-I/O wrappers for the existing WSL asynchronous read/write problem, as documented in the preceding frame-inspection record. Those helpers are not game dependencies and were removed after verification. The final build is **`index-F2Vfjzov.js`**. Its embedded sources match current Character, serializer, fighter profile, locomotion state and UFD reference files; the final production movement probe passes against that artifact. The preview is available at <http://127.0.0.1:4176/platform-fighter/>.
