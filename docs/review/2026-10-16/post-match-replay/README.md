# Post-match Save Replay

**PASS.** The results screen offers **Save Replay** after the live simulation has been disposed. The [browser report](report.json) records actual Chromium downloads, repeat-save byte equality, a fresh rematch recording, and exact replay reconstruction in Node.

The check starts a one-stock Flat Stage match with two Pikachu players, seed `161016`, and items disabled. It holds a real DOM movement key while the ordinary RAF loop runs. It does not inject positions, damage, velocities, stock changes, match results or recorded inputs. Right movement pushes the second fighter off through normal body separation; the left-moving rematch runs the first fighter off. Both matches end through the real blast-zone/results flow.

| Match | Winner / final stocks | Deciding frame | Recorded inputs | Reconstructed world digest |
| --- | --- | ---: | ---: | --- |
| First, move right | P1 / `[1, 0]` | 943 | 944 | `a14731dcac30e2b3` |
| Rematch, move left | P2 / `[0, 1]` | 171 | 172 | `a56d053baf5810ab` |

The actual downloaded [first replay](first-right.replay.json) and [rematch replay](rematch-left.replay.json) pass the production replay parser. Both preserve the configuration, seed, player inputs and exact build identity. Node installs the existing Chromium-compatible math adapter before importing `MatchSim`, loads each downloaded input timeline with `setRecordedInputs`, and reproduces the live world digest at observed frames 944 and 172. Continuing the normal ending delay yields the exact original winner, stocks, stats and result payload.

Saving the first completed match twice yields identical bytes. The redundant second download was removed after comparison; its name, size and SHA-256 remain in the report, referencing the retained first replay. Clicking Rematch starts a new recorder at frame 0 (observed after two neutral ticks), then exports a distinct left-moving timeline beginning at input frame 0. It contains no previous right-moving input history.

Visual review accepts the [first results screen](first-right-results.png) and [rematch results screen](rematch-left-results.png): Save Replay is readable between the navigation buttons, and the download status names the actual file. These images are UI evidence, not performance benchmarks. Runtime/page errors are empty, and the owned Edge profile and processes were cleaned up.

## Build and environment

- Bundle: `game-TKk1n6vp.js`, SHA-256 `ed80e95197329a98fcc30c75f8c148dad936629c48299d280ebb0258651e58eb`.
- Simulation identity: `platform-fighter-sha256-ed70855adcedfbc7c96b95bb4215b15a66a5ed491977b0b2ff53ae39eed13a44`.
- Windows Edge `155.0.4283.45`, Intel Iris Xe (`0x0000A7A0`) through ANGLE/D3D11; viewport 1280 × 800, DPR 1.
- Scope: completed local stock matches, repeated downloads and rematch lifecycle. Error/unsupported-download behavior is covered separately by the results UI unit checks.

## Re-run

```sh
flock .tmp/dk-heavy.lock node --import tsx tools/post-match-replay-acceptance.mjs \
  --url http://127.0.0.1:4173/platform-fighter/ \
  --out docs/review/2026-10-16/post-match-replay
```

The harness uses its own disposable Windows Edge profile and ports 9261/9262. It observes completed browser download events and reads the actual downloaded bytes from that owned profile before cleanup. The repeat download created during a rerun can be removed after its byte-equality check.
