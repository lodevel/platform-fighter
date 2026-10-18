# port/ architecture

The Three.js + HTML front end replacing Phaser (plan: `docs/review/2026-10-13/threejs-port/PLAN.md`).
Game rules and data stay in the game's `src/` and are imported read-only; `port/` only presents them.

## Layers

Dependencies point down only. `npm run typecheck` runs `scripts/check-layers.mjs`, which fails on a violation.

| Rank | Folder | Owns | May import |
|---|---|---|---|
| 5 | `entries/` | One file per page (`game.ts`, `viewer.ts`, `parity.ts`, `sandbox.ts`): wiring only | everything below |
| 4 | `ui/` | Menus and HUD | `match`, `fighters`, `arena`, `engine` |
| 3 | `match/` | The match view: draws a `SimView` (camera rig, fighters, items, projectiles, explosions) | `fighters`, `arena`, `engine` |
| 2 | `fighters/` | Character appearance instances, backends, resource providers and previews for matches and menus | `arena`, `engine` |
| 1 | `arena/` | The 3D stage: themes, platforms, hazards, stage clock | `engine` |
| 0 | `engine/` | Renderer, design-space camera, Phaser-equivalent sprite layer, textures | nothing in `port/` |

Any layer may import the game's renderer-neutral `src/` modules. MatchSim owns gameplay; presentation receives its snapshots and events.

The character appearance boundary is described in the
[rendering foundation record](../docs/review/2026-10-16/character-rendering-refactor/README.md).
Portable requests/profiles in `src/characterPresentation/` may import only the
portable core; `legacy/` is the explicit game-data bridge. These extra import
checks also run during typecheck. The pinned gameplay pose provider remains
independent of the visual registry. Register a visual backend and its resource
provider, then select a registered profile; do not add fighter branches to
MatchView or menu consumers. Managed geometry shares sprite queue ordering and
uses explicit world/screen passes. The common appearance submission does not
require textures or sprites.

## Inside the layers

- `arena/contract.ts` is the theme contract (`StageTheme`, `ThemeHooks`, `StageClock`).
  - `arena/themes/` holds one file per arena. Arenas never import each other; `themes/index.ts` maps the game's `backgroundTheme` ids to themes.
  - `arena/kit/` is the procedural modelling kit shared by themes (`toonKit`: materials, outlines, shapes, cracks; `skyKit`: sky, lights, clouds, motes, water; `lavaKit`: lava shader and smoky sky; `props`: islands, trees, plank decks; `humanoid`: jointed figures and poses; `creatures`: wings, horns, tails).
  - A theme may be a folder (`themes/inferno/`: `index.ts` theme, `head.ts`, `figures.ts`).
  - `arena/hazards/` holds hazard entities (`index.ts`, built with the game's factories) and their theme-independent views (`lavaPools`, `windZones`).
  - `platforms.ts`, `outline.ts`, `view.ts` (composition), `runtime.ts` (stage + clock), `presenter.ts` (render loop).
- `ui/shell/` is the app frame:
  - `app.ts`: contracts between shell and screens;
  - `dom.ts`: element helpers;
  - `input.ts`: keyboard + Gamepad API → menu actions;
  - `players.ts`: player colours;
  - `menu.css`: the design tokens and styles.
- `engine/audio/`: the Web Audio backend (`SoundManagerLike`) for the game's `AudioManager` and stage music.
- `engine/sprites/spriteSnapshot.ts`: one sprite drawn offscreen for HTML (menu art in costume).
- `ui/screens/`: one file per screen. Screens never import each other; they navigate with `app.go(name)`, and `screens/index.ts` is the registry.
- `ui/screens/match.ts` hosts the real `MatchSim`: a fixed 60 Hz loop,
  browser controls, pause/restart, controls edits, sound and results.
  `ui/shell/gameplayInput.ts` feeds DOM/gamepad state through the original
  `InputResolver` and saved profiles. The renderer reads `SimView` only.
- `ui/components/`: reusable widgets (pause overlay).
- `ui/hud/`: the in-match HUD, drawn from `src/sim/hudView.ts`.
- The match probe `window.__sim` exposes `startMatch`, `manual`, `step`,
  `state`, `view`, `checkpoint`, `restore`, `pause`, `resume` and the actual
  `match`. Manual mode suspends animation-frame simulation for deterministic
  probes. `sandbox.html` launches the same live host with CPU players.
- `ui/shell/tokens.css`: design tokens shared by menus and HUD.
- `ui/model/`: small view helpers (fighter names).
- `scripts/golden/`: the golden-replay harness (step 5.1) driving the game build; see `docs/review/2026-10-13/threejs-port/step5/README.md`.
- `fighters/`: `appearance.ts` (shared instances and profile selection;
  `applyFighterDisplay` picks legacy or package profiles from the Fighter art option, or the
  probe flag `?packages=all|<id>|none`), `backends/` (legacy sprite/resource implementations;
  `packageSprite.ts` draws a fighter from its character package), `packageLibrary.ts` (shared,
  reference-counted package leases: indexed pages decoded on workers (`pageDecoder.ts`) into R8
  textures plus a costume palette, uploaded a little per frame), `artHold.ts` (the fighter
  select holds the picked fighters' packages), `packageIndex.ts` (the shipped packages'
  revisions), `resources.ts` (preparation leases), `lineup.ts`, `gazeDemo.ts`. Only the legacy backend calls `poses.ts`.
  `engine/presentation/` supplies managed geometry, shader preparation and
  composite snapshots. Single legacy menu images keep the original snapshot path.
- `private/` (outside `src/`) is local-only. The Inferno head is a normal
  manifest-listed asset at `assets/stages/inferno-head.png` and ships with builds.
- `ui/assets/`: menu art derived from game assets.

## Rules of thumb

- One implementation per behaviour. If two modules need it, it moves down to the lowest layer that both can import.
- New arena = new file in `arena/themes/` plus one registry line. New screen = new file in `ui/screens/` plus one registry line plus a `ScreenName`.
- Everything that looks like gameplay is drawn from simulation data (layout, hazard entities, presentation modules), never re-derived.
- Port tests are named `*.check.ts`; the root Vitest configuration runs them
  together with game `*.test.ts` files. Qualification-only appearance pages are
  included by `PF_PRESENTATION_FIXTURE=1` builds, with no production registration
  of their computed character profiles.
