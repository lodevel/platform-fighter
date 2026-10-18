# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A local platform fighter with Three.js arenas, HTML menus, TypeScript strict
mode, Vite and a deterministic Matter.js simulation. The kept fighters are
Donkey Kong, Pikachu and Link; six built-in arenas support 1–4 human/CPU players,
items, Final Smash rules, saved controls and replay/history checkpoints.
Character Lab, Stage Forge and the Phaser host are retired. Pure serialization
modules remain where replay and checkpoint schemas still use them.

Active work happens on `rework/gameplay`. Pushing to `main` auto-deploys to
GitHub Pages (`.github/workflows/deploy.yml`); `dist/` is never committed.
`docs/PROJECT-ROADMAP.md` is the living handoff for the current overhaul and
links each dated evidence record under `docs/review/YYYY-MM-DD/`.

## Commands

Node 20+ is required (`.nvmrc` = 20, CI uses 22). A Node 18 shell can run
`tsc` and `tsx` but `vite`/`vitest` fail to load with a bare `SyntaxError`,
so switch Node before assuming the test suite is broken.

```bash
npm run dev                 # Vite dev server, http://localhost:5173 (base '/')
npm run typecheck           # tsc --noEmit (~1 min; no lint step exists)
npm test                    # vitest run — whole suite (~380 files)
npx vitest run src/match/StockTracker.test.ts          # one file
npx vitest run src/characters -t "ledge"                # folder + name filter
npm run test:watch
npm run build               # tsc + vite build
npm run preview             # dist/ on :4173 under /platform-fighter/ (the --base flag matters: the
                            # built asset URLs are absolute, a plain `vite preview` serves fallback HTML)
npx tsc --noEmit -p tools/tsconfig.json   # tools/ is outside the root tsconfig
npm run character:export    # today's fighters → .tmp/character-packages (character-package/1)
npm run lab                 # standalone character lab, http://localhost:5180 (lab:build → dist-lab/)
npm run character:holds -- donkeykong --max-diff 0.12   # Phase 3 hold candidates beside the export (<id>~repack, <id>~holds-<limit>)
npm run character:shrink -- donkeykong~holds-0.12      # decided display: match-size drawings + 256-colour palette (<id>~small, ~small-c256)
npm run character:package   # rebuild the shipped packages in assets/characters/<id>/package/ (export → holds → shrink)
```

Verification ritual before calling gameplay work done:
`npm run typecheck && npx vitest run && npm run build`, then a production
preview check (see "Runtime verification" below). A green suite does not
prove something is visible or playable in the game.

## Architecture

### Browser host and simulation

The app entry is `port/src/entries/game.ts`; root Vite builds it into `dist/`
with base `/platform-fighter/`. `port/src/ui/screens/` holds HTML screens and
`src/scenes/` holds their pure state modules. Screen wiring uses `App.go`,
`FlowData` and a shared `StagePresenter`; see `port/ARCHITECTURE.md` for layers.

`src/sim/MatchSim.ts` owns the sole fixed-step clock, Matter world, characters,
items, projectiles, hazards, rules and replay history. `buildSimView.ts` exports
plain presentation snapshots plus queued one-shots. `port/src/match/MatchView`
consumes those snapshots; it never changes gameplay rules. Source-native
platform positions and hazard clocks come from simulation state, including
intro, pause and ending holds.

The live host feeds DOM keyboard/gamepad state through the original
`InputResolver` and match-local bindings projected from saved profiles.
Pause controls update that same store. `MatchSim.advance` polls the input
supplier once per fixed step, preserving the canonical accumulator in history.

### Character packages and lab

`character/` holds the display-only character format (`package/`), its pure
evaluator (`evaluator/`), the costume recolour (`render/recolor.ts`, also used by
the game's sprite layer) and the standalone lab (`lab/`). They never import
`src/` or `port/` (`character/boundaries.test.ts`); the game may import them. `scripts/character-package/`
exports today's fighters by sampling the game's own drawing selection; it is
temporary migration code. Plan: `docs/CHARACTER-LAB-PLAN.md`.
Phase 6 (`docs/review/2026-10-19/phase6/PLAN.md`): the game can draw fighters from the
shipped packages (`port/src/fighters/packageLibrary.ts`, backend `backends/packageSprite.ts`,
palette shader in `spriteLayer.ts`); opt in with `?packages=all` or `?packages=<id>`. The
legacy sprite path stays the default until the user accepts the package path in matches.

### Determinism

- Keep timing in frames and use seeded named `MatchRng` streams. Rendering and
  sound never consume gameplay randomness.
- Keep all time-varying owned state in replay/history checkpoints. Restore
  reconstructs and validates evidence; do not invent unrecorded state.
- The unchanged Matter fork and declarations live in `src/physics/matter/`.
  Physics tests load these vendored CommonJS sources directly.
- `SIMULATION_BUILD_ID` is replaced by Vite with the real source/data/config
  hash. Replay and history files must retain that identity.
- The frozen Phaser baseline and headless MatchSim passed all nine golden
  scenarios at 60 Hz, after warmup and at 144 Hz. Keep the golden harness.

### Combat and coordinates

Hits use actual Matter sensor contacts and the shared `HitboxDamageHandler`
and `MatchSim.resolveCombatHit`; damage/launch math stays in `combat.ts` and
`referenceKnockback.ts`. Stage design space is 1920×1080. Read each producer's
coordinate contract before transforming article, socket or camera positions.

### Characters

- `src/characters/Character.ts` (~9k lines) is the Matter-body fighter state
  machine: locomotion, jumps, shield/dodge/ledge/grab states, attack slots,
  traps/projectiles. Fighters extend `ContractFighter`, which routes each slot
  (`jab`, `tilt`, `smash`, `fair`, four specials, `shield`, `dodge`) through
  an optional item slot-override then the fighter's `FighterMoveset`.
- Each fighter file (`DonkeyKong.ts`, `Pikachu.ts`, `Link.ts`) exports `<ID>_TUNING`, move
  consts, `<ID>_MOVESET` and `<ID>_FIGHTER_CONTRACT`; `assertFighterMoveset`
  validates the contract. Move "kinds" are declared via the schema files
  (`specialSchema.ts`, `sideSpecialSchema.ts`, `upSpecialSchema.ts`,
  `downSpecialSchema.ts`, `grabSchema.ts`, `throwSchema.ts`, `chargeSchema.ts`).
- Registration is spread across `src/types/index.ts` (`CHARACTER_IDS`, the
  keystone union), `fighterRegistry.ts`, `roster.ts`, `visualScale.ts`,
  `handAnchors.ts`, `palettes.ts`, `fighterMovementProfiles.ts` and several
  `as const` id lists in the animation drivers. `tsc` only guards the
  `Record<CharacterId, …>` maps; ordered arrays and the asset manifest are
  runtime-only and silently break the select grid or rendering when missed.
- `authorableCharacterRegistry.ts` + `characterSerializer.ts` +
  `characterFactory.ts` let the Character Lab edit, save (localStorage
  `platformfighter:characters:v1:<slot>`) and instantiate a fighter from data;
  a roster fighter must round-trip through this path too. Saves and replays
  that name a removed fighter (or the pre-rebuild Link) are dropped/rejected.
- Animation: `spriteAnimationDriver.ts` maps state → sheet keys,
  `movesetAnimationDriver.ts`/`movesetAnimationCues.ts` map moves → per-move
  clips, `simulationSpriteAnimation.ts` runs frame selection on the sim step.

### Input, AI, replay

- `CharacterInput` (in `Character.ts`) is the per-frame held-state record;
  the fighter detects rising edges itself. Every source implements
  `PlayerInputProvider.sample(frame)` from `src/input/InputProvider.ts`:
  keyboard (`LocalInputHandler`), gamepad (`DeviceInputDispatcher`), AI, and
  replay playback. Bindings and named profiles persist under
  `platformfighter.bindings.v1.*` with versioned migrations
  (`input/BindingsMigrations.ts`); replay files embed the same shape.
- AI tiers (`src/ai/EasyTierAI.ts`, `MediumTierAI.ts`, `HardTierAI.ts`) are
  behavior trees over an immutable `WorldSnapshot` (`ai/perception/`) built
  each step by `MatchSim.buildCpuWorld()` and wrapped by
  `ai/LiveCpuController.ts`. AI reads plain snapshot data only, never Phaser,
  Matter or live `Character` objects, and is seeded per slot from the match
  seed. Perception must be pushed before `sample()`.
- Replay: `replay/InputCaptureBuffer.ts` records every player's input per
  step; `RecordingController`/`ReplayFile` write the file (with migrations in
  `replayMigrations.ts`); `RewindController` restores the nearest snapshot and
  re-steps. The browser probe exposes actual history capture/restore.

### Stages, items, builders

- Built-in stages are `StageLayout` literals in `src/stages/stageDefinitions.ts`
  (`STAGES`: flat, lava, wind, crumbling, moving-platform, inferno). `BaseStage`
  and `src/entities/` own collision and hazards; `port/src/arena/` draws them.
  Saved-stage serializers remain for replay compatibility; the editor is retired.
- Items (`src/items/`, Ultimate rules in `docs/review/2026-10-11/ultimate-items/`):
  an `ItemDefinition` is pure data: per-input `uses` (jab / ftilt / dashAttack /
  fsmash → `AttackMove`, with `usesByFighter` for per-fighter native data),
  `ammo`, a `throwProfile` (thrown-hit formula and flight) and a `visual`.
  With `ammoSpentOnShot` only shots spend `ammo`: a use move's `itemShot` (Star
  Rod star) or a shooting item's `shooting` session (`itemShooting.ts`: Ray Gun,
  Super Scope, Fire Flower fire while the legs walk/jump). Shots are queued by
  `Character` and spawned by MatchSim as projectiles.
  `Inventory` registers the uses on the holder and equips it; `Character` asks
  `resolveItemInput` what a classified press does with the held item (item use,
  fire, empty-shooter throw, smash throw or native move). Pickup, catch, throw, drop and Z-drop for every
  fighter go through one planner (`itemActions.ts`, per-fighter
  `FIGHTER_ITEM_PROFILES`; `itemCatch.ts`), driven by `MatchSim.prepareItemInput`
  and committed on the item action's callback frame. Spawning uses the
  `item-spawn` stream for timing and `item-type` for the Item Switch pick
  (`itemCatalog.ts`, `MatchConfig.itemSwitch`); hit drops roll on `item-drop`.
  A held item is drawn at the drawn hand's native socket (`itemAttachmentPoses`
  in frames.json) along its native axis per frame (`item-axes.json`), both read by
  `characters/heldItemSocket.ts`. Item and trap visuals
  are drawn by MatchView from SimView.
- Spawned world objects (projectiles, traps, summons) must obey physics by
  default, be rendered, and show their real damage area; the
  `add-spawned-object` skill has the rules and reference implementations.

### Assets and art pipeline

`src/assets/manifest.ts` is the single source of asset keys and preload
entries; URLs go through `import.meta.env.BASE_URL` because production is
served under `/platform-fighter/`. Fighters are recoloured at runtime
(`paletteSwapShader.ts` / `runtimePaletteRenderer.ts`); there is no build-time
palette step. Compressed (KTX2) fighter sheets for the optional texture quality
are git-ignored; `tools/build-basisu.sh` then `npm run assets:compress` builds
them locally, and the Pages deploy does the same. Generated art in `assets/gen/`
is git-ignored except clip-spec JSON. Art direction is locked to
Brawlhalla-style clean 2D cartoon, not pixel art (`docs/ART-STYLE.md`);
generation runs through a local ComfyUI via `tools/` (`docs/ART-PIPELINE.md`).
On a machine that cannot hold the bf16 models, set `PF_COMFY_UNET` and
`PF_COMFY_CLIP` to the official int8/fp8 variants before running any
`tools/gen-*.ts` script; the runbook has the exact names.
For a fighter with an Ultimate Frame Data source, build pose guides from the
extracted UFD frames with `tools/ufd-pose-canny.py` (runbook §2b; run it with
`~/ComfyUI/.venv/bin/python`; one 600 px scale per batch with a per-pose
canvas, never a smaller scale) instead of text drafts, and sync the manifest
block after packing with `tools/sync-manifest-sheets.py`.

## Testing conventions

- Shared game tests sit beside their implementation as `*.test.ts`. Port checks
  use `*.check.ts`; root `npm test` includes both. Keep runtime modules importable
  in Node without browser or renderer globals.
- `*.physics.test.ts` files step a real Matter world by `createRequire`-ing
  `../physics/matter/source/lib/...` and faking the minimal `scene.matter`
  surface (see `Character.referenceLocomotion.physics.test.ts`). Prefer this
  for anything about contact, launch trajectories or active frames; explain
  tolerances from integrator behaviour rather than loosening them.
- Several suites hardcode the roster (`fighterRegistry.test.ts`,
  `characterSpec.test.ts`, `palettes.test.ts`, animation-driver tests); adding
  a fighter means updating them in lockstep.

## Runtime verification

Browser evidence is expected for gameplay changes. Launch through
`tools/browser-match-host.mjs` or use `window.__sim.startMatch(config)`, await
`__sim.ready`, enable `manual(true)`, then `step`, `advance` and `draw`. The
`match` property is the real MatchSim; `presentation(playerIndex)` reports the
actual submitted fighter art and decoded frame metrics. Preserve actual DOM
input when qualifying controls; label injected gamepad input as simulated.

Maintained broad probes are `port/scripts/live-match.mjs`,
`tools/link-playable-probe.mjs`, `tools/dk-runtime-mechanics-review.mjs`,
`tools/dk-jostle-match-regression.mjs` and `tools/pikachu-final-match-probe.mjs`.
Retired Phaser/Lab/preview probes and their replacement map live under
`tools/archive/phaser/`. Historical visual qualifications keep their original
scope and do not automatically qualify the new renderer.

## Skills and workflow docs

- `add-character` (canonical text in `.agents/skills/add-character/SKILL.md`,
  referenced from `AGENTS.md`): the required workflow for creating, finishing
  or auditing a fighter, including UFD-sourced move data, art generation and
  the evidence record. Use only the relevant steps for a targeted fix.
- `add-weapon`: end-to-end pickup weapon (definition, manifest, MatchSim
  visual and swing arc, per-fighter grip clips).
- `add-spawned-object`: physics/render/damage-area/cleanup rules above.
- `docs/CHARACTER-CHECKLIST.md` is historical; `docs/REWORK-REVIEW-2026-09-09.md`
  is the current assessment with acceptance criteria.

<!-- ooo:START -->
<!-- ooo:VERSION:0.31.1 -->
# Ouroboros — Specification-First AI Development

> Before telling AI what to build, define what should be built.
> As Socrates asked 2,500 years ago — "What do you truly know?"
> Ouroboros turns that question into an evolutionary AI workflow engine.

Most AI coding fails at the input, not the output. Ouroboros fixes this by
**exposing hidden assumptions before any code is written**.

1. **Socratic Clarity** — Question until ambiguity ≤ 0.2
2. **Ontological Precision** — Solve the root problem, not symptoms
3. **Evolutionary Loops** — Each evaluation cycle feeds back into better specs

```
Interview → Seed → Execute → Evaluate
    ↑                           ↓
    └─── Evolutionary Loop ─────┘
```

## ooo Commands

Each command loads its agent/MCP on-demand. Details in each skill file.

| Command | Loads |
|---------|-------|
| `ooo` | — |
| `ooo interview` | `ouroboros:socratic-interviewer` |
| `ooo seed` | `ouroboros:seed-architect` |
| `ooo run` | MCP required |
| `ooo evolve` | MCP: `evolve_step` |
| `ooo evaluate` | `ouroboros:evaluator` |
| `ooo unstuck` | `ouroboros:{persona}` |
| `ooo status` | MCP: `session_status` |
| `ooo setup` | — |
| `ooo help` | — |

## Agents

Loaded on-demand — not preloaded.

**Core**: socratic-interviewer, ontologist, seed-architect, evaluator,
wonder, reflect, advocate, contrarian, judge
**Support**: hacker, simplifier, researcher, architect
<!-- ooo:END -->
