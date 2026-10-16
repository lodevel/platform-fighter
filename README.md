# Platform Fighter

A local platform fighter with **Three.js arenas, HTML menus and a deterministic
Matter.js simulation**. Play Donkey Kong, Pikachu and Link with up to four
human or CPU players, six built-in arenas, items and Final Smash rules.
Keyboard and gamepad controls support saved per-player profiles.
The upper-left FPS counter shows rendered frames per second in menus and matches;
gameplay advances independently at 60 fixed steps per second.
The lower-right version badge shows the app version and a source build identifier
so you can compare installations. These changes are on the `rework/gameplay` branch.

## Run

```bash
npm install
npm run dev          # http://localhost:5173/
npm run build        # app bundle in dist/
npm run preview      # http://localhost:4173/platform-fighter/
npm run typecheck
npm test
```

Local previews serve sprites and audio directly from `assets/`. For a standalone
static hosting artifact, run `npm run build:static`; it copies only the runtime
files referenced by the asset manifest. The Inferno head is included at
`assets/stages/inferno-head.png`, so a clone and standalone build use the same
stage artwork.

The [Final Smash previews](artifacts/final-smash-previews/README.md) include
60 fps clips of Link, Pikachu and Donkey Kong, with slow motion and frame stepping.

## Code

- `src/sim/MatchSim.ts` owns gameplay, the fixed clock, items, rules and replay history.
- `src/characters/`, `src/match/`, `src/items/` and `src/finalSmash/` contain shared rules.
- `src/physics/matter/` contains the unchanged vendored Matter fork and its types.
- `port/src/` contains the Three.js renderer and HTML app; see [its architecture](port/ARCHITECTURE.md).
- `src/scenes/` retains pure menu state modules used by the HTML screens.
- `src/builder/` retains pure serialization used by replay/checkpoint data. Character Lab and Stage Forge are retired.
- `assets/` contains fighter artwork, sound and authored metadata.

## Verification

The browser exposes `window.__sim`: start a match, await `ready`, enable
`manual(true)`, then use `step`, `advance`, `state`, `view`, `draw`, `presentation`, `presentationSprites`,
`checkpoint` and `restore`. The `match` property is the actual `MatchSim`.
The sandbox runs this same host at `/platform-fighter/sandbox.html`.
After `draw()`, `presentationSprites()` reports actual effect quad submissions
and resident decoded textures; screenshots establish their appearance.

```bash
node port/scripts/live-match.mjs docs/review/local/live
node tools/link-playable-probe.mjs --out docs/review/local/link --shots
node tools/dk-runtime-mechanics-review.mjs
node tools/dk-jostle-match-regression.mjs
```

Headless replay verification runs through `tools/sim-replay.ts`; browser golden
comparisons live in `port/scripts/golden/`. Historical Phaser probes and their
replacement mapping are in [tools/archive/phaser/](tools/archive/phaser/README.md).

Gameplay uses seeded random streams, fixed 60 Hz steps and serializable owned
state. Changes require relevant physics tests, build checks and observation in
the running match. A passing suite alone does not establish visual completion.

The [October 15 takeover acceptance](docs/review/2026-10-15/takeover/README.md)
records the completed cutover, Final Smash repairs, browser evidence, exact
replays and remaining human review/cleanup decisions.

Use the repository's [$add-character skill](.agents/skills/add-character/SKILL.md)
for playable fighter work, including source coverage, animation, collision and
runtime evidence.
