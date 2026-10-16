# Review evidence — 9 September 2026

See [the full review](../../REWORK-REVIEW-2026-09-09.md) for interpretation,
priorities, and limitations. These files record the pre-fix state on
`rework/gameplay`, based on commit `26e6e3f` plus its uncommitted rework.

Post-fix verification lives in [`implemented/`](implemented/acceptance.json) and
the [implementation report](../../REWORK-IMPLEMENTATION-2026-09-09.md). The
observations below remain the historical audit evidence.

## Observations

- `runtime-observations.json`: screen inventory, fresh-page resource totals,
  hitlag drift, action overlap, sparse participants, and ordinary rematch comparison.
- `physics-observations.json`: selected rules versus live stocks/time behavior,
  input capture, simultaneous/delayed jump attack, real wall collision, sprite
  timing with simulation paused, and stationary moving platforms.
- `flow-observations.json`: tuning applied in Test Fight, then lost on Pause
  Restart; the normal Results → Main Menu → Lab return crashes in `refreshFields`.
  The following attempted match entry times out. Its later Controls check did
  **not** execute; the report labels that finding as code-reviewed only.

The first two probes completed without page errors. The third deliberately
preserves the observed error and failed continuation. These are observational
scripts, not a passing regression suite; inspect their JSON output, including
`errors` and `probeFailure`, rather than treating process exit as approval.

Two physics-probe limitations are retained explicitly: its heavy-input fixture
uses `heavy` instead of the actual `attackHeavy` field, and its timer sample
records scene activity without recording the match-end phase. Thus heavy-input
omission and absent timer wiring are source-confirmed findings, not established
by those two observations alone. The archived script reproduces the original
sample; correct those fields before turning it into a regression test.

## Reproduction

Run from the repository root with the installed dependencies, Node 20 and
Playwright's Chromium available. Use the existing production build, or rebuild
when evaluating changed source. The reviewed build used the deployment base
`/platform-fighter/`:

```sh
node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4173 --base /platform-fighter/
```

In another terminal, run each probe separately:

```sh
node docs/review/2026-09-09/probes/full-review.mjs
node docs/review/2026-09-09/probes/physics-review.mjs
node docs/review/2026-09-09/probes/flow-review.mjs
```

They overwrite this dated evidence directory; copy it first if retaining the
baseline during fixes. In the reviewed WSL environment, cached Node 20 was invoked
with `npx --yes --package=node@20 node <script>`.

Each probe launches an isolated browser profile and accesses the local review
build's `window.__game` inspector. The password gate is bypassed via scene entry
in that isolated local browser; no user storage or credentials are changed.
Do not use a `deploy`-mode build that removes the inspector.

Several screenshots use direct scene entry to inspect a screen. `results.png`
is explicitly the no-payload fallback and is not evidence of missing normal
results. `results-populated.png` comes through the real match-end transition after
setting the opponent's stocks to zero as a fixture; its zero combat statistics
are not a statistics defect. `match-link.png` uses alternate palettes;
`match-default-link.png` shows default Link/Kirby colors.

The physics probes pause automatic simulation and explicitly step real Matter
where indicated. The wall is a temporary static fixture. The animation probe
pauses simulation to isolate elapsed-time sprite advancement. None of these
establishes human-perceived feel, controller latency, or GPU performance.

## Screenshot index

| Screen | Capture |
|---|---|
| Main menu | [Desktop](main.png), [portrait](main-portrait.png) |
| Mode and arena selection | [Mode](mode.png), [stages](stages.png) |
| Fighter selection | [Roster](roster.png) |
| Character Lab | [Lab](lab.png) |
| Controls | [Controls](controls.png) |
| Stage Forge | [Forge](forge.png) |
| Flat arena | [Default Link/Kirby](match-default-link.png), [alternate palettes](match-link.png) |
| Moving Platform arena | [Arena](moving-platforms.png) |
| Match at small sizes | [Portrait](match-portrait.png), [landscape](match-small-landscape.png) |
| Pause and results | [Pause](pause.png), [populated results fixture](results-populated.png) |

All screenshot dimensions describe CSS viewport size with device scale factor 1.
Headless Chromium used software rendering; local startup timing and texture-size
estimates must not be presented as real-device benchmark results.
