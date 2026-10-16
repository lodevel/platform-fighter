# Headless match extraction

`src/sim/MatchSim.ts` owns the production match: independent Matter world,
stage/hazards, fighters, collision listeners, CPU policies, rules, stocks,
items, detached projectiles, Final Smash runtime, input recording and history
reconstruction. The source methods and fixed-step order were moved from the
settled MatchScene implementation; no alternate gameplay implementation was
authored. `buildSimView.ts` selects render data and drains the presentation
FIFO. It holds no graphics objects.

Construction is `new MatchSim({matchConfig, viewport?, bindingsStore?,
runtimeBindingsStore?, inputProfiles?, inputHistory?, buildIdentity?})`.
`step(inputs?)` consumes exactly one gameplay step, or one pre-match intro
step while that separate clock is active. `advance(deltaMs, inputs?)` uses
the fixed-step accumulator. Inputs are indexed by contiguous runtime player
index: null/undefined chooses the CPU's sampled output; a provided input wins
after the CPU and its policies have rebuilt their private state.

`view()` exposes selected fighter art, held-item sockets, ordinary projectile
recipes, Link articles, Final FX, Ancient Arrows, Screen KO, source shields,
special effects, traps, spawn platforms, real debug areas, camera targets and
HUD. It drains one-shot effects once. `restoreMatchHistoryCheckpoint()`
constructs and returns a fresh MatchSim from its original inputs and disposes
the previous instance; hosts must adopt the returned instance. Reconstruction
compares canonical whole-world evidence before restoring the host's clock.

## Reproduce

```sh
npx tsx tools/sim-replay.ts docs/review/2026-10-15/takeover/golden-baseline/crumbling.json
npx tsx tools/sim-replay.ts docs/review/2026-10-15/takeover/golden-baseline/crumbling.json --warmup 600 --hz 144
npx tsx tools/sim-math-parity.ts docs/review/2026-10-15/takeover/headless/math-parity.json
npx tsx docs/review/2026-10-15/takeover/headless/final-replay-matrix.ts
```

Replay-file JSON is also accepted, producing a final canonical hash and a
throughput measurement. Golden JSON additionally checks every stored frame
hash and exits nonzero on any mismatch. Mismatches save exact first actual
state under `.tmp/sim-diff/`, plus paired records at the next available
golden dump. `src/sim/fixtures/golden-openings.json` contains the first 64
frames of all nine frozen browser recordings for the normal unit suite;
complete recordings remain in `../golden-baseline/`.

## Exact browser math in Node

The frozen browser is Chromium 148.0.7778.96, using V8 revision
`ddc9a95905de5268332a8f0216dc2bc67d26e829`. Its default
`V8_USE_LIBM_TRIG_FUNCTIONS` routes sine and cosine to V8's bundled glibc
implementation. Node 22.23.3/V8 12.4 and Node 26.12.0/V8 14.6 omit that build
flag. Host system glibc also differs on some inputs, so choosing newer Node
or linking only `-lm` does not reproduce the browser.

This was caught by the unweakened canonical digest:

- Bare Node differed at crumbling frame 32: `cos(53 * PI / 180)` was
  `0.6018150231520483`, versus browser `0.6018150231520484`.
- Host glibc passed that frame but differed transiently at frame 990 in
  Pikachu forward-air's angle48 move packet: sine was
  `0.7431448254773941`, versus browser `0.7431448254773942`.
- The pinned V8 implementation matches the browser. `math-parity.json`
  records 17,660 exact comparisons across integer move angles, dense ordinary
  angles, large angles and special IEEE values, with zero differences.

`tools/node-libm-trig.ts` compiles the checked-in, licensed upstream C sources
to `.tmp/build/node-libm-trig.node` and installs only sine/cosine before the
runner dynamically imports gameplay. Tangent and inverse functions remain
Node's V8 builtins, matching the browser. Browser and MatchSim source math
are untouched. No evidence fields or floating-point precision are changed.

The Node runner currently needs a C compiler and Node N-API headers
(`/usr/include/node` by default); `CC` and `PF_NODE_HEADERS` override their
locations. The binary is a generated local artifact. The upstream revision,
source notices and LGPL license are retained in `tools/vendor/chromium-libm`.

The CLI derives the same source build identity as Vite, including vendored
Matter JavaScript and the Three input/presentation host. Direct Node users of
`MatchSim` must supply a build identity; the unbundled module's placeholder
does not establish checkpoint or replay compatibility.

Primary provenance:

- [Chromium 148 DEPS](https://github.com/chromium/chromium/blob/148.0.7778.96/DEPS)
- [V8's pinned libm target](https://github.com/v8/v8/blob/ddc9a95905de5268332a8f0216dc2bc67d26e829/BUILD.gn#L7388)
- [V8 sin/cos dispatch](https://github.com/v8/v8/blob/ddc9a95905de5268332a8f0216dc2bc67d26e829/src/base/ieee754.cc#L2963)

## Validation

The complete extraction gate passed: all 18,600 per-frame hashes across nine
scenarios match the frozen browser exactly. See `node-golden-results.jsonl`.
That includes high-frequency items, all five original stage families and all
three fighters. The 3,600-frame Final-enabled scenario exercises meter/ball
state, but an audit found its controller sequence stays zero: nobody actually
activates a Final before the recording ends. It does not establish old/new
choreography parity. The actual Final production/browser tests qualify the
repaired moves separately; a longer current-build recording also passes in
Node and covers activated Final gameplay.

The new current-build recording contains 7,200 input/hash frames, three actual
Final activations and zero browser page errors. Its sampled canonical evidence
includes Pikachu activated at frame 3,903 and in its finish phase at 4,200;
`final-activation-coverage.json` records the audit. The browser build and Node
runner share identity
`platform-fighter-sha256-aedf4dbb82fd1923b83d2bf316a65c22b6839b12d4d82d604606e4f15282af86`.
The earlier 3,600-frame current recording is preserved with an explicit
`-no-activation` filename rather than being presented as Final qualification.

The final-source matrix passes all 11 checks / 36,600 exact frame comparisons:
the eight ordinary frozen scenarios (15,000 frames), plus the 7,200-frame
current Final recording at 60 Hz, after a 600-frame warmup, and at 144 Hz.
See `final-replay-matrix.jsonl`. The three Final comparisons use the repaired
current browser as their reference; they do not assert unchanged choreography
against the unfinished frozen implementation. The reproducible matrix checks
both source identity and a nonzero activation count before running.

The same-process opening suite uncovered one missing body-id normalization in
the old canonical record: Link's contextual `previousSupportBodyId`. Its
legacy numeric representation is now normalized relative to construction base 1,
preserving all original plain hashes while allowing warmup and rematches.
No fighter state or physics are modified by this evidence fix.

The focused extraction/renderer-seam suites passed 304 tests in 13 files.
They cover recorded CPU state, successive-match Link identities, Node/browser
golden openings, import isolation, render-read nonmutation and reconstruction
of a paused fractional clock. MatchSim preserves the pre-pause accumulator;
the browser samples its resolver within the simulation's own fixed-step clock.

Inferno integration adds the actual authored gaze clock to BaseStage and routes
its lethal flash through the lava stock/stats path. It spares crouching,
intangible, respawning and eliminated fighters. A real 1,890-frame match and
checkpoint reconstruction pass; the GazeHazard/BaseStage/integration suites
pass 27 tests. Gaze evidence is conditional on that hazard actually existing,
so unrelated stage hashes keep their existing record shape.

The coordinator also completed all nine warmup-600 and all nine 144 Hz
variants from a pinned pre-Pikachu-change module instance: all 37,200 extra
per-frame hashes match. Together the extraction gate covers 55,800 exact
frozen-browser comparisons. See `extended-node-goldens.jsonl`. Later
intentional Final changes are qualified separately from this proof that the
extraction preserved gameplay.
