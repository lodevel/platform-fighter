# Step 5.1: golden-replay state-hash harness

Built 2026-10-13, ahead of the gate, without touching `src/`. The harness
drives the game's current Phaser build through `window.__game`.

## What it is

- `port/scripts/golden/digest.js` is injected into the game page. Each frame it
  builds one canonical record of the simulation and hashes it with FNV-1a 64.
  The record holds:
  - the frame;
  - `matchRng.snapshotState()` and `itemSpawnManager.snapshotState()`;
  - every Matter body: relative id, label, position, velocity, angle, angular
    velocity, sensor and static flags, collision filter;
  - per fighter: position, velocity, damage, facing, locomotion state, active
    attack, state flags, held item and trap count;
  - stocks, items (snapshot, position, hammer / Bob-omb / wear / ammo),
    projectiles, explosions;
  - `captureFinalRuntimeSnapshot()` where the build has it.
- `port/scripts/golden/scenarios.mjs` defines the matches: Hard CPU vs Hard CPU,
  DK and Pikachu only. Smash Ball and the Final meter are off.
- `port/scripts/golden/sim-golden.mjs` has two modes:
  - `record <scenario|all>`: plays the scenario and stores the recorded inputs,
    the per-frame hashes and a full dump every 300 frames in `golden/<name>.json`.
  - `verify <golden.json> [--warmup N] [--hz H]`: replays the recorded inputs
    on a fresh page. CPU controllers return the recorded inputs and the Smash
    Ball wrapper is bypassed (F7). It reports `IDENTICAL`, or the first
    diverging frame plus the differing fields of the nearest dump.

Run it from `port/scripts/golden/` under
`flock /mnt/c/Workspace/platform-fighter/.tmp/dk-heavy.lock`. Set
`PF_GAME_URL` to the build under test; the default is the published game on
4199.

## Proven so far (2026-10-13, build `index-2KfQg9H6.js`)

- A 300-frame lava recording replays `IDENTICAL`.
- The hashes are not trivially constant: 300 unique hashes for 300 frames.
- A flipped input at frame 150 is caught. The run reports `DIVERGED` at frame
  154, after the jump squat, with the exact position and velocity fields.
- Full-length self-checks for all six scenarios (plain, `--warmup 600`,
  `--hz 144`): **18/18 IDENTICAL**. Five scenarios run 1,800 frames each; the
  4-player free-for-all runs 2,400. Results are in `selfcheck-2026-10-13.jsonl`
  and the goldens (6.8 MB) in `golden/`. The current game is deterministic
  under replay, under a shifted body-id counter, and at a 144 Hz display rate.

## Gaps, closed at the gate (STEP5-DESIGN §5.1 items 1–2)

- The digest moves into `src/match/simDigest.ts`, extending `stateChecksum.ts`,
  with `MatchScene.getSimDigest()` and `setRecordedInputs()`. Only then can the
  Final Smash golden (#6) be recorded, because the Final CPU wrapper cannot be
  bypassed from outside.
- The published build `index-2KfQg9H6.js` predates
  `captureFinalRuntimeSnapshot`. Until the game is rebuilt, the `finals`
  section is a constant error string. That is harmless while Finals are off,
  but it is blind to Final state.
- Link scenarios get added when the fresh Link settles.
- The goldens are bound to their build. A rebuilt game (new engine version)
  needs new recordings, then a `verify` against itself before trusting a
  comparison.
