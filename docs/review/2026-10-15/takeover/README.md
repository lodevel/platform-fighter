# Takeover acceptance — 2026-10-15

**Superseded completion status:** the user's subsequent play exposed freezes,
controller/menu failures and missing/coarse animations. These passing automated
results did not satisfy all plan acceptance criteria. See the current
[plan audit and repair scope](../user-bugs/PLAN-AUDIT.md). The evidence below
describes the earlier BYOl1XlT candidate, not acceptance of the reported behavior.

The interrupted refactor and Three.js cutover are implemented. The current
local game is at `http://localhost:4173/platform-fighter/`; the frozen Phaser
comparison on port 4300 remains intact. The coordinator used three agents with
separate ownership and integrated their work on the shared source tree.

Production candidate: `game-BYOl1XlT.js`, source identity
`platform-fighter-sha256-aedf4dbb82fd1923b83d2bf316a65c22b6839b12d4d82d604606e4f15282af86`.

## Delivered

- A Phaser-free production `MatchSim`, directly vendored Matter, Node replay,
  exact whole-history reconstruction and one authoritative fixed-step clock.
- The Three.js/HTML root app, actual keyboard/gamepad input, saved controls,
  disconnect/reconnect, pause, real match results, audio and all six arenas.
- Items, projectiles, traps, shields, effects, Final presentation, debug areas,
  moving/crumbling terrain and the actual Inferno gaze hazard.
- Code-drawn Remote Bomb and sword beam artwork.
- Pikachu Volt Tackle owner/recipient art and real capture, attack, release,
  finisher, miss and cleanup paths. It was unfinished in the inherited build.
- DK Final owner/recipient art and same-step victim fitting, plus Link's real
  Final motion selection and Ancient Arrow presentation.
- Retired Phaser host/editor removal, maintained browser probes and explicit
  archives for historical probes. Agent policy is now recorded in `AGENTS.md`;
  the missing local autocommit-hook reference is removed.

## Verification

| Gate | Result | Evidence |
| --- | --- | --- |
| Strict typecheck, layer check, production/static build | Pass; 723 runtime assets copied | [Build log](final-build.txt) |
| Final-source test suite | 548 files / 12,027 tests pass | [Summary](final-test-summary.txt), [full log](final-tests.txt) |
| Original extraction replay gate | 55,800 exact frame comparisons | [Headless record](headless/README.md) |
| Final-source replay matrix | 11 checks / 36,600 exact frames; activated Finals at normal timing, after warmup and at 144 Hz | [Matrix](headless/final-replay-matrix.jsonl) |
| Live browser match host | 24 checks; no page errors | [Report](final-live/report.json) |
| Title, controls, match and results journey | Pass; no page errors | [Report](final-menus/report.json) |
| Actual match audio | 600 frames, 39 buffer starts, one music loop; no page errors | [Report](final-audio.json) |
| Pikachu Final | Eight ground/air, facing, hit/miss routes plus two recipient cases; whole-history checkpoint and 281 exact continuation hashes | [Qualification](../pikachu-final/qualification.json) |
| DK Final | 16 browser cases, 3,332 owner-drawing and 1,656 victim-fit checks | [Acceptance](../dk-final/runtime-acceptance.json) |
| Link Final | Eight browser activation routes, real owner art, arrow and blast | [Qualification](../link-final/qualification.json) |

The historical short Final-enabled replay never activated a Final. Its hashes
qualify ordinary gameplay and meter/ball state, not unchanged Final choreography.
The longer current recording contains three activations and is deliberately
qualified against the repaired browser build. [Coverage audit](headless/final-activation-coverage.json).

Finals are source-guided 2D adaptations with documented authored cinematic art
and geometry/camera adapters. Exact Ultimate renderer/common-dispatch parity and
human controller feel are not claimed. The cutover record also retains the
older Link contact-fixture diagnostic mismatches without treating them as passes.
See [cutover details](THREE-CUTOVER.md) and the character qualification records.

## Cleanup and repository state

The old 17.7 GB deletion list has not been executed: it includes source and
review material needed to reproduce work. A refreshed, narrower dry run finds
7,897 scratch-build copies / 1,324,197,432 bytes (about 1.23 GiB), each identical
to a named retained original. [Review the concrete plan](cleanup/README.md).
The user's cleanup choice remains pending, and no cleanup deletion has occurred.

All work remains local and uncommitted; nothing was pushed or published.
