# Step 5 design: headless `MatchSim`

Status: **partly implemented. Read [§8, the 2026-10-15 refresh](#8-2026-10-15-refresh)
first**: it has the current sub-step status, order, estimates and golden
procedure. Sections 0–7 are the original 2026-10-13 design; their line numbers
are stale.

Measured 2026-10-13 with grep against the other AI's uncommitted working tree.
Line numbers will drift, so re-measure them at the gate before starting. The
counts are rough but real. The structure they describe will not change much.

## 0. Findings that shape the design

| # | Finding | Evidence |
|---|---|---|
| F1 | `Character` uses `scene` only for Matter. All Phaser imports in the fighter files are `import type`. | `Character.ts:94` (type import), `:1834` field, `:3241` ctor. No `scene.add/anims/textures/time/events` in the file. DonkeyKong/Pikachu/FreshLink/LegacyLink/characterFactory/fighterRegistry are type-only too. |
| F2 | A narrow Matter interface already exists: `HitboxScene` (`attacks.ts:550`). Character casts to it 37 times. A second copy is `CreatureScene` (`creatures/Creature.ts:61`). Nothing outside `creatures/index.ts` imports Creature, so it is dead code. | `grep "as unknown as HitboxScene"` → 37 hits |
| F3 | `stepCharacterPhysics` (`characters/stepCharacterPhysics.ts`, 172 lines) is already Phaser-free. It takes `bodies`, `gravity`, `body` API and `stepWorld`. It **mutates the gravity object in place** (`:127-128`, `:163-164`), so that object must be the engine's own `engine.gravity`. | MatchScene `:7180-7187` |
| F4 | The game does **not** run Matter's default resolver tuning. Phaser's `MatterPhysics` constructor sets module globals `Resolver._restingThresh=4`, `_restingThreshTangent=6`, `_positionDampen=0.9`, `_positionWarming=0.8`, `_frictionNormalMultiplier=5`. The bare lib defaults are 2 and √6. | `node_modules/phaser/src/physics/matter-js/MatterPhysics.js:388-392` vs `lib/collision/Resolver.js:17-22` |
| F5 | Only 10 of the 97 `*.physics.test.ts` set Phaser's thresholds (the Link launch suites and `Character.referenceLaunchEnergy`). The other 88 build `Engine.create()` with lib defaults, so they exercise slightly different contact resolution than the game. | `grep _restingThresh` |
| F6 | **Full-state snapshot/restore does not exist.** `RewindController`, `PlaybackChecksumVerifier`, `PlaybackSimulationStateManager` and `DesyncRecoveryController` are library-only: no non-test code constructs them. `stateChecksum.ts` hashes fighters only (`MatchStateSnapshot`, `:205-252`) and nothing records it. CLAUDE.md's "snapshot every 300 frames" is aspirational. Partial checkpoints do exist: `captureFinalRuntimeSnapshot`/`restoreFinalRuntimeSnapshot` (`MatchScene.ts:1260-1452`: rng, Final controller/choreography/ball, Link articles, ScreenKO, intro), `MatchRng.snapshotState`, `ItemSpawnManager.snapshotState`, `ItemEntity.getSnapshot`, AI `snapshot()`. `Character` has about 385 fields and no snapshot. | `grep "new RewindController"` → only doc comments |
| F7 | **The current replay re-simulation applies the CPU input wrappers twice.** `tools/replay-resim.mjs` feeds recorded inputs through `cpuControllers`. MatchScene then runs `retainedBallCpuInput` + `finalSmashCpuInput` on top (`MatchScene.ts:6996-7021`), but the recorded inputs were already captured after those wrappers (`captureFrame`, `:7109`). The result is the same only while no Smash Ball or Final is in play. | `MatchScene.ts:1175-1200` changes inputs when a ball is roaming |
| F8 | Sim geometry depends on `scene.scale.gameSize` (stage transform). | `BaseStage.ts:374`, `StageRenderer.ts:249`; `replay-resim.mjs` warns about it |
| F9 | Vite resolves `phaser` to `dist/phaser.esm.js` (`package.json` `"module"`), which carries its own copy of Matter. Any direct import of `phaser/src/physics/matter-js/...` is a second module instance with separate globals (`Common._nextId`, the `Resolver` thresholds). | `node_modules/phaser/package.json:11-14`, `vite.config.ts:100` |
| F10 | Matter assigns `collision.bodyA/bodyB` by **relative** body id (`lib/collision/Collision.js:83-84`). Pair keys use ids (`Pair.js:116-118`). Results depend on creation order, not on the absolute counter. | |
| F11 | Simulation frame data comes from JSON, not Phaser: 15 modules import `assets/characters/*/frames.json` (`heldItemSocket`, `linkBodyRuntime`, `donkeykongPairedProtectionClock`, `pikachuRecoveryAttacks`, `finalBodyPose`, ...). Character never reads `anims`/`texture`. | `grep frames.json` |

## 1. Phaser touchpoints on the simulation path

### 1a. Matter (world, bodies, events)

| Site | Count | What | Sim? |
|---|---|---|---|
| `Character.ts` `scene.matter.*` | 151 | `body.setVelocity` 116, `body.setPosition` 28, `world.on` 3 (`:3395-3399`), `body.scale` 2 (`:1445-1446`), `body.setInertia` 1 (`:3384`), `body.getVelocity` 1 (`:12537`), `add.rectangle` 1 (`:3350`), plus `world` in destroy (`:14001`) | sim |
| `Character.ts` → `HitboxScene` casts | 37 | spawn/despawn/update hitbox, grab sensor, DK pose consumers, Pikachu specials | sim |
| `attacks.ts` | 5 | `add.rectangle` `:664,:737`, `setInertia` `:684,:757`, `setPosition` `:844` | sim |
| `donkeykong{Attack,Catch}CollisionPose.ts` | 6 | `body.scale`, `body.setPosition` | sim |
| `pikachuSpecialRuntime.ts` | via `HitboxScene` | spawn/despawn/update hitboxes | sim |
| `MatchScene.ts` `this.matter.*` | 24 | `world.on` 5 (`:5629,:5633,:5642,:5667,:5672`: collisionstart/active/end, beforeupdate, afterupdate), `world.getAllBodies` 5 (`:3283,:5527,:7183,:7202,:8547` (last is F3 debug)), `body.setVelocity` 6 (`:2863,:4691,:5401,:8909,:8910,:9114`), `body.setPosition` 1 (`:9118`), `world.step` 1 (`:7187`), `world.localWorld.gravity` 1 (`:7184`), `world.autoUpdate` 3 (`:4590,:6573,:8096`), `world.setBounds` 1 (`:4732`, all walls off, so a no-op) | sim (autoUpdate/setBounds: drop) |
| `StageRenderer.ts` | 4 | `add.rectangle` `:300,:430` (platforms, blast sensors), `body.setPosition` `:605` (moving platforms), `world.remove` `:629,:632` | sim |
| `LavaHazardRenderer.ts` | 2 | `add.rectangle` `:258`; `update()` `:302-393` writes body position/vertices/mask **and** Phaser rects in one function | sim + render mixed |
| `WindHazardRenderer.ts` | 2 | `add.rectangle` `:144`; body sync `:190-195` + visual `:210-212` | sim + render mixed |
| Watchers (`BlastZoneWatcher`, `HitboxDamageHandler`, `LavaCollisionWatcher`, `WindForceController`) | 0 live | Phaser-free handlers fed `event` objects | sim, already clean |
| Type namespace `MatterJS.BodyType` | 78 uses in 27 files | Global types from Phaser's `types/matter.d.ts` | types only |
| Constraints | 0 | none (`grep Constraint.create`) | — |
| Collision categories | 0 dynamic | explicit bits in `engine/collisionCategories.ts:35+`, no `nextCategory/nextGroup` | — |

### 1b. Scene time, tweens, events

| Site | Count | Sim? |
|---|---|---|
| `scene.time` / `delayedCall` anywhere on the sim path | 0 | — |
| `this.tweens.add` (`MatchScene.ts:4437`, save toast) | 1 | render |
| `this.events` (`:5932-5933` WAKE bindings refresh, `:6503` ADDED_TO_SCENE camera split, `:6558,:9456` SHUTDOWN) | 7 | host lifecycle |
| Wall-clock delta used by the sim: `advanceSourceIntro(deltaMs)` (`:1156`, `:6893`) runs the 121-frame Link source intro on its own accumulator and calls `advanceSourceMatchEntry` | 1 | **sim** (pre-roll phase) |

### 1c. GameObjects created or touched inside simulation code

| Site | Lines | Notes |
|---|---|---|
| `this.add.*` in MatchScene, total | 80 calls | rectangle 15, circle 9, sprite 7, graphics 7, text 6, container 6, ellipse 3, image 1 (single-line breakdown, 54), plus 26 multi-line `this.add\n.x` |
| Phaser-typed fields in MatchScene | 35 | of 161 fields |
| **Inside the fixed step** (`:6897-8117`) | | |
| item spawn containers | `:7314-7341` | `itemVisualSprite`, `crateVisualParts`, `entity.attachedRender = container` |
| item container sync / destroy | `:7393-7440`, `:7451-7458` | lives beside sim state `itemFallingY`/`itemSurfaceY` |
| projectile graphics | `:7537-7615` | sim record holds `container` (`:1539`) |
| swing flash | `:7646-7660`, aging `:7829-7840` | render |
| thrown-item container sync | `:7694-7695`, `:7732-7733`, `:7807-7808` | record holds `container` (`:1595`) |
| `renderTraps()` | `:7826` → `:8778` | redraws trap graphics, latches explosions, spawns explosion art |
| explosion bursts | `:7842-7854` | render |
| projectile container sync / destroy | `:7870-7872`, `:7863`, `:7986` | render |
| `stageBackground.tick(frame)` | `:7152` | render |
| Lava/Wind visual update inside `baseStage.tickHazards` | `:7149` → `LavaHazardRenderer.ts:375-393` | render, mixed into the body sync |
| `resolveCombatHit` connect SFX + hit spark | `:5446-5507` | render (spark seed = frame + slot) |
| Methods the step calls that also create visuals | `spawnItemShot` (`:1716`), `openContainer` (`:3386`), `tickHammer` (`:3479`), `tickSmashBall` (`:3254`), `removeItem`, `explodeItem`, `spawnExplosionArt` (`:1922`), `spawnFreshLinkBomb` (`:2607`), `spawnConvertedLinkArrow` (`:2965`) | 44 render-token lines in the sim-method block `:1996-4060` |
| **Render callback writing to sim objects** | `:8511` `consumeDiveLandingEvent()` | write-only one-shot cue; Character never reads it back |

### 1d. Input

| Site | Sim? |
|---|---|
| `createPhaserKeyboardSource(this)` `:5934`, `DeviceInputDispatcher` `:5936`, `InputResolver` `:5992`, `inputResolver.update(frame)` `:6977` | host input |
| `this.input.keyboard` (ESC/F3/F9) `:6376,:6510,:6548-6549`; gamepad START `:9313` | host UI |
| `LocalInputHandler.ts`, `RawInputSource.ts` (type-only Phaser) | host input |
| CPU path: `buildCpuWorld` `:6982,:9233`, `cpu.sample`, `retainedBallCpuInput` `:1175`, `finalSmashCpuInput` | Phaser-free, deterministic, reads sim state. It belongs **inside** MatchSim (seeded per slot from the match seed) |

### 1e. Registry

30 `this.registry` uses. Only one feeds the sim: the seed read in
`initialiseMatchSeed` (`:4078`). `matchRng`/`matchRngSeed` (`:4106-4107`) are
written but never read. The rest are host-side: bindings store
(`:4405-4425`), last config and scene data, mute flags, controls profiles,
`lastReplay` (`:8109`). MatchSim takes the seed as an explicit argument.

### 1f. Cameras and scale

| Site | Sim? |
|---|---|
| `CameraController` `:6185`, update `:8164-8170`, UI camera split `:6474-6503`, `:1123-1124`, `:8476` | render |
| `finalCameraAnchor` set by the choreography `camera:` hook `:2128` and checkpointed `:1376` | **sim-produced camera hint** (render reads it) |
| `GAME_CONFIG.width / GAME_CONFIG.height` passed into the choreography `:2129` | sim constant, Phaser-free |
| `this.scale.gameSize` → BaseStage/StageRenderer transform (F8) | **sim** |
| `this.scale` for HUD text placement (`:1127,:1138,:6117,:8159,:9392`) | render |

### 1g. Textures, anims and frame data

| Site | Sim? |
|---|---|
| `this.textures.exists` 8 (`:1136,:1771,:1880,:1924,:4748,:4871-4872,:5106`): placeholder alpha, sprite creation | render |
| `this.anims.get` 1 (`:1686`, upper-body overlay); `registerAllCharacterSpriteAnimations(this)` `:4917` | render |
| `createSimulationSpriteAnimationDriver` (`simulationSpriteAnimation.ts:623`): picks the sheet and frame each render from `captureSimulationAnimation`, frame counts come from Phaser's AnimationManager | render. Frame **selection** (`resolveSimulationAction` + `selectActionArtFrame`) is pure and must be shared with the Three.js view |
| `captureSimulationAnimation` / `resolveSimulationAction` inside Character (`:1073,:1100,:1453,:1464`): DK attack/catch collision poses | **sim**, Phaser-free |
| `frames.json` / `item-axes.json` (F11): sockets, hurtbox/hitbox poses, protection clocks, Final body poses | **sim input** (already part of `SIMULATION_BUILD_ID`) |

### 1h. Phaser imports by file (non-test `src/`)

84 files, about 69.4k lines. Classified for step 5:

- **Value imports on the sim path (must go):** `stages/BaseStage.ts`,
  `StageRenderer.ts`, `LavaHazardRenderer.ts`, `WindHazardRenderer.ts`,
  `scenes/MatchScene.ts`.
- **Type-only on the sim path (retype to `PhysicsHost`):** `Character.ts`,
  `DonkeyKong.ts`, `Pikachu.ts`, `FreshLink.ts`, `LegacyLink.ts`,
  `characterFactory.ts`, `fighterRegistry.ts`, `entities/Fighter.ts` (pulled in
  through `hurtState.ts:39` as a type).
- **Render-only, stays with the Phaser view until step 9:** `fx/*`,
  `ui/{ChargeIndicator,DamageHud,ShieldBubble,FpsCounter,VcrOverlay,...}`,
  `camera/CameraController.ts`, `StageBackgroundRenderer.ts`,
  `PlatformVisualBinder.ts`, `spriteAnimationDriver.ts`,
  `simulationSpriteAnimation.ts` (Phaser types used in the driver only),
  `assets/freshLinkTextureResidency.ts`.
- **Out of scope:** menus/scenes, `builder/`, `previews/` (13 Pikachu move
  previews register Matter listeners of their own), input sources.

## 2. Fixed-step order in `MatchScene.update` (`:6877-8686`)

`update()` polls pause (`:6885-6892`), runs the source intro (`:6893`), then
`physicsEngine.advance(delta, step, render)` (`:6895`). The step callback runs
from `:6897` to `:8117`, the render callback from `:8118` to `:8677`.

| # | Lines | Work | Class |
|---|---|---|---|
| 1 | 6898-6900 | Link ScreenKO presentation step (`sourceScreenKo`) | sim-owned presentation state (checkpointed) |
| 2 | 6908 | `matchOverFrozen` gate | sim |
| 3 | 6976 | `finalSmashController.step` → `consumeFinalEvents` | sim |
| 4 | 6977 | `inputResolver.update(frame)` | host input |
| 5 | 6981-7027 | per-slot input: CPU (`buildCpuWorld`, `cpu.sample`, ball and Final wrappers) or resolver | CPU = sim, resolver = host |
| 6 | 7029-7041 | Final Smash activation requests (`finalSpecialHeld`) | sim |
| 7 | 7042-7045 | `finalChoreography.beforeStep` | sim |
| 8 | 7046-7058 | platform tops, `baseStage.updatePlatforms` (riders, drop-through), ledge candidates, presentation clock | sim |
| 9 | 7059-7064 | Final opponent slow input, remote bomb sync, Link bomb/boomerang owner sync | sim |
| 10 | 7067-7079 | footstool resolution | sim |
| 11 | 7086-7107 | `prepareItemInput` + `applyInput` per slot, drain item events | sim |
| 12 | 7108-7109 | prone food events, **`inputCaptureBuffer.captureFrame`** (replay capture) | sim |
| 13 | 7114-7138 | ledge trump | sim |
| 14 | 7149-7152 | `baseStage.tickHazards` (+ hazard visuals inside), `stageBackground.tick` | sim + **render** |
| 15 | 7159-7175 | Pikachu special entities vs surfaces/targets | sim |
| 16 | 7176-7225 | `stepCharacterPhysics`: Matter step(s). `afterSubstep` runs capture attachments, hurtbox sampling, lava, blast-zone position watcher. Then fighter separation | sim |
| 17 | 7230-7240 | Hammer start (rng), held-item positions | sim |
| 18 | 7249-7250 | `applyHazardEffects`, remote bomb sync | sim |
| 19 | 7272-7475 | item spawn manager, Smash Ball proposal, spawn, spawn-fall, registry tick, inventory sweep | sim + **render** (containers) |
| 20 | 7477-7644 | projectile spawn, item shots | sim + **render** (graphics) |
| 21 | 7646-7660 | swing flash | **render** |
| 22 | 7664-7675 | commit catches/item/recovery/food/DK heavy/Link events, Link article ticks | sim |
| 23 | 7676-7817 | thrown-item flight + swept hits | sim + **render** (container sync) |
| 24 | 7819-7823 | choreography afterPhysics, Ancient arrows, world items, Link bomb blasts, Smash Ball | sim |
| 25 | 7826-7854 | `renderTraps`, swing flash and explosion aging | **render** |
| 26 | 7858-7993 | projectile flight, sweeps, reflect/absorb/hit | sim + **render** (container sync) |
| 27 | 8003-8052 | position KO scan, respawns, spawn-platform expiry, eliminated unregistering | sim |
| 28 | 8060-8072 | `matchRules.update` (sudden death / finish), `matchEndDetector.update` | sim |
| 29 | 8082-8116 | stop recording, build replay, `scene.start('ResultsScene')` | host |

The render callback (`:8118-8677`) is render-only: `baseStage.updateRender`,
camera, body proxies, sprites (`spriteAnimSm.tick()`, per-fighter presentation
metrics `:8213-8303`), capture depth, Pikachu specials, spawn platforms,
invincibility flicker, shield bubble, charge indicator, SFX, swing trails, Link
articles, ScreenKO, hit sparks, explosion particles, F3 debug, HUD and damage
HUD. The one exception is the `consumeDiveLandingEvent` drain (`:8511`).

Size: `create()` is `:4538-6876` (2,339 lines, mixed). The step callback is
about 1,220 lines. The render callback is about 560. The sim helper block is
about `:1120-4537` plus `:8860-9311`. MatchSim will take roughly 5-6k lines of
MatchScene, and the Phaser host keeps 3-4k.

## 3. `PhysicsWorld`

It is exactly the subset of Phaser's `MatterPhysics` that the sim uses, so
`scene.matter` satisfies it structurally (sub-step 5.2), and one Phaser-free
implementation replaces it (5.3). It absorbs `HitboxScene` and `CreatureScene`,
which are deleted.

```ts
// src/physics/PhysicsWorld.ts — Phaser-free
export type Body = MatterJS.BodyType;               // vendored types at step 9
export interface Vec2 { x: number; y: number }
export type PhysicsEventName =
  'collisionstart' | 'collisionactive' | 'collisionend' | 'beforeupdate' | 'afterupdate';
export interface CollisionEvent { readonly pairs: ReadonlyArray<MatterJS.IPair> }

export interface PhysicsWorld {
  readonly add: {
    rectangle(x: number, y: number, w: number, h: number, options: MatterJS.IChamferableBodyDefinition): Body;
  };
  readonly body: {                                   // = Matter.Body module (Phaser: MatterPhysics.js:175)
    setVelocity(body: Body, v: Vec2): void;
    setPosition(body: Body, p: Vec2): void;
    setInertia(body: Body, inertia: number): void;
    scale(body: Body, sx: number, sy: number): void; // was optional in HitboxScene; the guards go
    getVelocity(body: Body): Vec2;
  };
  readonly world: {
    on(event: PhysicsEventName, fn: (event: CollisionEvent) => void): void;
    off(event: PhysicsEventName, fn: (event: CollisionEvent) => void): void;
    remove(body: Body): void;
    getAllBodies(): Body[];
    step(deltaMs: number): void;
    /** The engine's own gravity object: stepCharacterPhysics mutates it in place (F3). */
    readonly localWorld: { readonly gravity: { x: number; y: number; scale: number } };
  };
}
/** What Character, attacks, stage bodies and hazards receive instead of Phaser.Scene. */
export interface PhysicsHost { readonly matter: PhysicsWorld }
```

`PhysicsHost` keeps every existing call site textually unchanged:
`this.scene.matter.body.setVelocity` keeps working (only the field is renamed
`scene` → `host`). The 88 physics-test fakes (`{ matter: { body, add, world } }`)
also satisfy it, so no test churn. A later optional cleanup can shorten
`host.matter.x` to `physics.x` with a sed.

```ts
// src/physics/matterPhysicsWorld.ts — the only importer of the Matter fork
import Matter from 'phaser/src/physics/matter-js/CustomMain.js'; // Phaser 3.90.0's Matter 0.20.0 fork
import { GAME_CONFIG } from '../engine/constants';

const NAME = { collisionstart: 'collisionStart', collisionactive: 'collisionActive',
  collisionend: 'collisionEnd', beforeupdate: 'beforeUpdate', afterupdate: 'afterUpdate' } as const;

export function createMatterPhysicsWorld(): PhysicsWorld {
  // Same globals Phaser's MatterPhysics constructor writes (MatterPhysics.js:388-392).
  Object.assign(Matter.Resolver, { _restingThresh: 4, _restingThreshTangent: 6,
    _positionDampen: 0.9, _positionWarming: 0.8, _frictionNormalMultiplier: 5 });
  // Same as Phaser World: Engine.create(config) then setGravity(x, y) with default scale 0.001.
  const engine = Matter.Engine.create({ enableSleeping: false });
  Object.assign(engine.gravity, { x: 0, y: GAME_CONFIG.gravity, scale: 0.001 });
  return {
    add: { rectangle(x, y, w, h, o) {                 // Phaser Factory.rectangle → World.add
      const b = Matter.Bodies.rectangle(x, y, w, h, o); Matter.Composite.add(engine.world, b); return b; } },
    body: Matter.Body,
    world: {
      on: (e, fn) => Matter.Events.on(engine, NAME[e], fn),   // registration order preserved
      off: (e, fn) => Matter.Events.off(engine, NAME[e], fn),
      remove: (b) => Matter.Composite.remove(engine.world, b),
      getAllBodies: () => Matter.Composite.allBodies(engine.world),
      step: (dt) => Matter.Engine.update(engine, dt),          // Phaser World.step
      localWorld: engine.world,                                // engine.world.gravity === engine.gravity
    },
  };
}
```

Why this is the same physics as today:

- Same Matter source. Phaser's dist bundle is built from the same
  `src/physics/matter-js/lib` files.
- Same resolver globals.
- Same gravity object and values.
- `Engine.update` with the same 1000/60 ms and substep deltas.
- The event proxy order is the same. Phaser re-emits each engine event once
  through EventEmitter in insertion order (`World.js:568-700`). Matter's
  `Events.on` also appends.
- Phaser's extra work in the collision proxy (`gameObject.emit`,
  `onCollideCallback`, `onCollideWith`) has no listeners in this game
  (`grep onCollide` → 0).
- `setBounds` with all four walls off creates no bodies (`World.js:796-869`).

Phaser's own `scene.matter` world for MatchScene becomes an idle empty engine
until step 9.

The same function runs in both builds. The Phaser build (from 5.3 on) and the
Node sim import `createMatterPhysicsWorld` and the same `CustomMain.js` module.
They do not use Phaser's bundled copy. Build wiring:
`optimizeDeps.include += 'phaser/src/physics/matter-js/CustomMain.js'` (dev
pre-bundles the CJS). The rollup commonjs plugin handles the build, and
vitest/tsx import CJS natively. The cost is a second Matter copy in the bundle
(about 100 KB min) until step 9.

Step 9 consequence: the `phaser` package cannot be dropped while Matter comes
from `phaser/src`. Vendor `lib/` (11,068 lines, 428 KB, MIT) and the
`MatterJS` type declarations byte-identically into `src/physics/matter/`, then
re-run the golden check.

## 4. `MatchSim` API and render contract

```ts
// src/sim/MatchSim.ts — Phaser-free
export interface MatchSimOptions {
  readonly matchConfig: MatchConfig;          // after snapshotMatchCharacters()
  readonly rngSeed: number;                   // resolved by the host (was registry, MatchScene:4078)
  readonly stage: StageLayout;                // built-in or customStageLoader output
  readonly viewport: { width: number; height: number }; // 1920×1080; replaces scene.scale.gameSize (F8)
  readonly characterOverrides?: MatchSceneData['characterOverrides'];
  readonly labMode?: boolean;
}
export type SlotInput = CharacterInput | null; // null = CPU slot: MatchSim samples its LiveCpuController + wrappers

export class MatchSim {
  static create(options: MatchSimOptions): MatchSim;
  readonly physics: PhysicsWorld;
  readonly frame: number;
  readonly phase: 'intro' | 'playing' | 'ending' | 'over';
  /** One fixed 1000/60 ms step. During 'intro', advances the source intro (no inputs, no frame). */
  step(inputs: ReadonlyArray<SlotInput>): void;
  /** One-shot effects produced since the last drain (no state of their own). */
  drainEvents(): readonly SimEvent[];
  /** Read-only state for renderer, HUD, probes; plain data, no Phaser. */
  view(): SimView;
  /** Golden-replay digest of the deterministic state at `frame` (section 5.1). */
  digest(): string;
  /** Recorded inputs so far (InputCaptureBuffer) and the ReplayFile builder. */
  readonly recording: RecordingController;
  result(): MatchResultPayload | null;
  destroy(): void;
}
```

**Snapshot/restore (F6).** A real full-state snapshot means serializing about
385 Character fields plus Matter internals, so it is out of scope for step 5.
Instead, `restore` is **deterministic re-simulation**: `MatchSim.create(sameOptions)`
followed by stepping the recorded inputs to the target frame. This is
`RewindController` with one snapshot at frame 0, and the existing controller
can drive it through its `simulateStep`/`restoreSnapshot` callbacks.
Headless speed decides whether that is fast enough for the VCR; measure it in
5.7. A true checkpoint is a separate later task built on the existing partial
snapshots (F6).

**Inputs.** Recorded replays pass a non-null input for every slot, which
bypasses the CPU and its ball/Final wrappers. That fixes F7. Live play passes
`null` for CPU slots. The host (Phaser or the Three.js shell) owns devices,
bindings, pause and the disconnect monitor.

**Render-facing state: prefer state, use events only for one-shots.** The view
diffs ids for spawn and despawn, so a re-simulated rewind redraws correctly
without replaying events.

| `SimView` field | Source today (reused, not copied) | Three.js consumer (step 6) |
|---|---|---|
| `fighters[]`: playerIndex, characterId, paletteIndex, position, facing, tuning w/h, grounded, `animation: SimulationAnimationSnapshot`, Final presentation, Link body pose, Pikachu special state, crouch, eliminated, respawning, invincibility frames, shield (active, health), charge ratio, held item id | `Character` getters, `captureSimulationAnimation`, `getFinalSmashPresentation`, `getLinkBodyPose`, `getPikachuSpecialState`, stock tracker | fighter cards through a shared `fighterDraw()` (below) |
| `hurtboxes[]`, `hitboxes[]` (damage areas) | `getActiveHurtboxes`, active attack sensor bodies | debug layer and real damage-area rule (`add-spawned-object`) |
| `items[]`: id, type, `visual` descriptor, lifecycle state, position, holder + socket pose, flight, broken, hammer, Bob-omb phase, durability/ammo | `ItemEntity.getSnapshot()` + getters, `heldItemSocket`, `thrownItems` without `container` | item sprites |
| `projectiles[]`: id, moveId, x, y, w, h, facing, chargeT, boomerang age | `projectiles` without `container` | projectile meshes |
| `traps[]` per fighter | `getActiveTraps()` | trap sprites + blast boxes |
| `linkArticles` | existing `getLink{Arrow,SwordBeam,Boomerang,RemoteBomb,BowStandby}Snapshot` (`MatchScene.ts:1227-1249`) | Link article renderer |
| `explosions[]` | `itemExplosions` | explosion art/particles |
| `smashBall` | `smashBallRuntime.getRoaming()` | ball |
| `stage`: platform bounds (moving/crumbling state), lava heights/active, wind state | stage runtime (5.4) | `port/src/arena` (already driven by the same hazard classes) |
| `spawnPlatforms[]` | `respawnHandler.getActiveSpawnPlatforms()` | revival platforms |
| `camera`: targets, `finalAnchor`, stage bounds | `finalCameraAnchor`, blast zone | camera |
| `hud`: mode, seconds, sudden death, scores, per-player damage/stocks, Final meter model | `matchRules`, `stockTracker`, `finalHudModel()` | HTML HUD |
| `sourceIntro`, `sourceScreenKo` | `getSourceIntroSnapshot`, `getSourceScreenKoSnapshot` | intro and ScreenKO overlays |

`SimEvent` = `hit {frame, x, y, damage, seed}` (spark + connect SFX; same
contact math as `:5483-5506`) | `sfx {key}` (Character's existing `sfxSink`,
`Character.ts:3253`) | `explosion {x, y, radius}` | `trapDetonated {key, box}` |
`diveLanding {x, y, facing}` | `ko {playerIndex, edge}` | `matchEnd {payload}`.

**Shared presentation code, no duplicates:**

- `fighterDraw(fighterView, artPose) → SpriteDraw` holds the metrics logic
  that is inline at `MatchScene.ts:8213-8303` today. It uses
  `donkeykongBodyPresentation`, `pikachuPresentation`, `linkBodyPresentation`
  and `finalBodyPose`.
- `selectArtFrame(snapshot, prev) → {key, frameIndex, overlay}` is the pure
  part of `createSimulationSpriteAnimationDriver`, with frame counts read from
  the manifest/`frames.json` instead of Phaser's AnimationManager.

The Phaser driver becomes a thin adapter over both functions, and the port's
`SpriteLayer` (which takes Phaser-sprite fields) consumes `SpriteDraw` directly.

## 5. Migration sequence (strangler; the Phaser game works after each sub-step)

Each sub-step ends with `npm run typecheck && npx vitest run && npm run build`,
the golden check (5.1) on `npm run preview`, and an evidence note under
`docs/review/<date>/threejs-port/step5/`.

### 5.1 Golden-replay state-hash harness on the old build (about 2 d)

1. **`src/match/simDigest.ts`** (Phaser-free) builds one canonical record per
   frame. It extends `stateChecksum.ts` instead of adding a second hasher:
   `MatchStateSnapshot` gains a `world` section and the algorithm id becomes
   `state-fnv1a-64-v2`. The digest is still `computeReplayChecksum` (FNV-1a
   64) over the canonical string, and numbers are rendered with
   `Number#toString` as today. Contents:
   - `frame`, `matchRng.snapshotState()`, `itemSpawnManager.snapshotState()`;
   - **every Matter body** in `getAllBodies()` order: relative id (`id − id of
     the match's first body`, F10), label, position, velocity, angle,
     angularVelocity, isSensor, isStatic, collisionFilter
     {category, mask, group}. This covers platforms, hazards, hitboxes, grab
     sensors and traps;
   - per fighter: the existing `StateFighterSnapshot` fields, plus active
     attack `{id, framesElapsed, facing}`, grab state name, ledge key,
     `captureSimulationAnimation(ch, frame, false)`, Final lease snapshot,
     active traps;
   - stock tracker (stocks, respawning, eliminated), `matchRules` scores and
     seconds, end-detector phase;
   - items: `getSnapshot()` + hammer/Bob-omb/durability/ammo; `itemFallingY`,
     `itemSurfaceY`; thrown items and projectiles without `container`;
     explosions;
   - `captureFinalRuntimeSnapshot()` (Final, ball, Link articles, ScreenKO,
     intro).
2. **MatchScene hooks (small, read-only).** Add `getSimDigest()` and
   `setRecordedInputs(timeline)`. The latter replaces `frameInputs` at `:6984`
   for every slot and skips the resolver and CPU wrappers (F7). Add no other
   behaviour.
3. **Golden replays (8).** Record CPU-vs-CPU Hard matches through the
   RecordingController:
   1. DK vs Pikachu, flat, items high;
   2. Link vs DK, lava;
   3. Pikachu vs Link, moving;
   4. DK vs Link, wind;
   5. crumbling, 3 players;
   6. Final Smash: ball on and meter on, with all three Finals landing;
   7. 4-player free-for-all, all items, time mode into sudden death;
   8. the existing item replays under `docs/review/2026-10-11/ultimate-items/`
      that still load.
4. **`tools/sim-golden.mjs`** (adapt `replay-resim.mjs`) does the following:
   1. starts MatchScene with the replay's config and seed;
   2. installs `setRecordedInputs`;
   3. steps in batches of 600 frames per `page.evaluate`;
   4. writes `step5/golden/<name>.json`: `{buildId, replay, frames:[[frame, digest]], dumps:{every 300th frame: canonical record}}`;
   5. offers `--compare <golden.json>`, which reports the first diverging
      frame and a field diff of the nearest dumps.
5. **Self-checks before trusting it:**
   - two fresh-page runs are identical;
   - `PF_RESIM_WARMUP=600` (shifted body-id counter) is identical;
   - `PF_RESIM_HZ=144` (different render cadence) is identical.

   A failure here is a real determinism bug and gets fixed first.

### 5.2 `PhysicsWorld` types, no runtime change (about 0.5 d)

Add `src/physics/PhysicsWorld.ts`. Then:

- Retype `Character`, the fighters, the factory/registry, `attacks.ts`, the
  DK pose consumers, `pikachuSpecialRuntime`, StageRenderer and the
  Lava/Wind renderers from `Phaser.Scene`/`HitboxScene` to `PhysicsHost`.
- Delete `HitboxScene` and the 37 casts.
- Delete the dead `creatures/` module.
- MatchScene still passes `this` (a Phaser scene satisfies `PhysicsHost`).

Verify: tsc, all 97 physics tests unchanged, golden identical.

### 5.3 Own Matter instance (about 1 d, highest-risk switch)

Add `src/physics/matterPhysicsWorld.ts` (section 3). MatchScene then:

- creates `this.physics = createMatterPhysicsWorld()` and passes
  `{ matter: this.physics }` to BaseStage, the stage, hazards and every
  fighter;
- moves its own 24 `this.matter.*` uses over to it;
- deletes the `autoUpdate` toggles and the no-op `setBounds`;
- keeps the creation order: background, stage bodies (platforms, blast
  sensors, lava, wind), p1, p2, extra fighters, then the scene listeners at
  `:5629-5672`, which run after the fighters' own listeners at
  `Character.ts:3395-3399`.

Verify: golden identical on all 8 replays; `link-movement-probe.mjs` and
`animation-acceptance.mjs` pass in preview; dev server boots (CJS
pre-bundle). Leave the physics-test fakes alone. Moving them to the real
factory changes their resolver thresholds (F5), so that is a separate task.

### 5.4 Phaser-free stage runtime (about 1.5 d)

Split `StageRenderer`/`LavaHazardRenderer`/`WindHazardRenderer`/`BaseStage`
into:

- `stages/stageRuntime.ts`: transform from an explicit viewport, bodies,
  hazard body sync, watchers, platform motion, ledges;
- Phaser view modules that read hazard and body state in `updateRender`.

The step no longer touches Phaser rectangles (`:7149`, `:7152`). Move
`createLavaHazardFromStageHazard` and `computeStageViewportTransform` into
`entities/LavaHazard.ts` next to the wind factory. Keep body creation order.

Verify: golden identical; BaseStage/StageRenderer tests; the port viewer's
`arena/hazards/index.ts` import switches to the Phaser-free module.

### 5.5 Visual side effects out of the step (about 2.5 d, 4 slices)

Each slice keeps sim code identical and moves visuals to the render callback.
Render state is keyed by id from sim records, or driven by a `SimEvent` queue
on MatchScene, which becomes MatchSim's queue later.

- a. `resolveCombatHit` spark and SFX → `hit`/`sfx` events.
- b. Projectiles: drop `container` from the record, keep a `projectileVisuals`
  map in the render callback.
- c. Items: spawn/fall/held/thrown/despawn containers and `attachedRender` go
  to an id-keyed `itemVisuals` synced in render. `itemFallingY`/`itemSurfaceY`
  stay sim.
- d. Traps, explosion bursts and swing flashes: `renderTraps` and the aging
  loops move to render, with latches keyed by trap id. `consumeDiveLandingEvent`
  becomes a `diveLanding` event.

Verify per slice:

- golden identical (the sim is untouched);
- before/after screenshots at fixed frames of golden replay 1 and 7 match;
- the `add-spawned-object` damage-area rule still holds (F3 overlay).

### 5.6 Extract `MatchSim` (about 4 d, 5 slices; delete as you move)

Each slice moves code out of MatchScene into `src/sim/`. MatchScene keeps a
`this.sim` and delegates. Nothing is duplicated.

- a. Shell: physics world, stage runtime, fighters, stock, rules, end,
  respawn, watchers, recording, `step()` order from section 2.
- b. Items (`simItems.ts`).
- c. Projectiles and thrown items (`simProjectiles.ts`).
- d. Link articles and Final Smash runtime (`simLinkArticles.ts`,
  `simFinalSmash.ts`), including the checkpoint pair at `:1260-1452`.
- e. CPU path (`buildCpuWorld`, wrappers) and the `null`-input contract.

`MatchScene.passThrough`/`upperPlatformRecovery` physics tests currently
transpile methods out of `MatchScene.ts` by AST. Point them at the moved
exported functions.

Verify per slice: golden identical; tsc; vitest; preview probes;
`window.__game` probes still find `scene.sim` (alias the old field names
only where the qualification probes need them).

### 5.7 Headless runner (about 1 d)

- `tools/sim-replay.ts` (`npx tsx`) runs a replay and writes the per-frame
  digests.
- `src/sim/goldenReplays.test.ts` (vitest, Node) runs every golden replay and
  asserts frame-for-frame equality with `step5/golden/*.json`.
- An import-graph test imports `src/sim/MatchSim.ts` without
  `vi.mock('phaser')`. It fails if anything reaches `phaser` other than
  `phaser/src/physics/matter-js/CustomMain.js`.
- Measure steps/s to decide whether re-simulation is fast enough for rewind.

This is the step 5 acceptance from PLAN.md.

### 5.8 Render contract for step 6 (about 1.5 d)

- `SimView`, `fighterDraw()` and `selectArtFrame()` (section 4).
- The Phaser render callback switches to them and drops its inline copies.

Verify: Phaser parity capture unchanged; port typecheck consumes the types.

**Total:** 8 sub-steps (13 slices). About 14 working days, range 11-18.
PLAN.md's estimate for steps 4-7 combined (11-19 d) is too low once this
lands; re-estimate steps 6-7 after 5.6.

## 6. Risks

### 6a. Determinism hazards

| Hazard | Where | Mitigation |
|---|---|---|
| Resolver thresholds 4/6 (Phaser) vs 2/√6 (lib) | F4 | set them in `createMatterPhysicsWorld`; golden 5.3 |
| Gravity must be the engine's own object (mutated during substeps) | F3, `stepCharacterPhysics.ts:127,163` | `localWorld = engine.world` (`engine.world.gravity === engine.gravity`, `Engine.js:69`) |
| Two Matter module instances in the browser (bundle + fork import) | F9 | every sim body comes from one `PhysicsWorld`. 5.3 converts all body creators together, because bodies in different engines never collide |
| Body creation order / relative ids decide bodyA/bodyB and pair keys | F10 | keep create order; digest uses relative ids; warm-up self-check in 5.1 |
| Listener order: fighters' `collisionstart/active/end` before the scene's | `Character.ts:3395-3399`, `MatchScene.ts:5629-5672` | preserve: fighters (`:4798`, `:4806`, extra slots `:5090`) are constructed before the scene handlers are registered |
| `beforeupdate`/`afterupdate` fire once per **substep** | `:5667,:5672`; `stepCharacterPhysics` | unchanged by construction (same `Engine.update` calls) |
| Engine settings | GameConfig `:110-121`: gravity y 1.0, scale 0.001, `enableSleeping:false`; iterations default 6/4/2; `Engine._deltaMax` = 1000/60 only warns | replicate exactly; no runner, no `autoUpdate` |
| Phaser body defaults (`gravityScale`, `ignoreGravity`, `onCollideWith`, `scale`) | fork `lib/body/Body.js:105-115` | they live in the fork's `Body.create`, so `Bodies.rectangle` from the same lib carries them |
| Source intro runs on wall-clock delta | `:1156` | MatchSim models it as a 121-step `intro` phase; replays start at frame 0 after it |
| CPU wrappers applied twice in replay | F7 | recorded-input override (5.1) and the `null`-input contract |
| Stage geometry from viewport | F8 | explicit `viewport` option, always 1920×1080 for sim |
| Float math across engines: Chromium's V8 (Playwright) vs Node's V8 | about 500 `Math.hypot/cos/atan2/sin` calls in sim code + Matter | V8 uses the same fdlibm ports, so this is expected to be identical. 5.7 proves it; on mismatch, use the first-divergence dump |
| Iteration order | Maps/Sets (insertion), sorts with tie-breaks (`:6994` sorts by distance then playerIndex) | moving code keeps the containers; no `Object.keys` over id-keyed objects added |
| Rewind expectations | F6 | restore = re-simulate; no promise of 300-frame snapshots in step 5 |

### 6b. Looks render-only but feeds the sim

- `frames.json` / `item-axes.json` (F11): sockets, poses, hurtboxes. These are
  sim inputs, so the port must not "optimise" them into texture metadata.
- `captureSimulationAnimation` is used by Character for DK attack and catch
  geometry (`:1453,:1464`).
- `sourceScreenKo` / `sourceIntro` are "presentation" states stepped in the
  sim and checkpointed (`:1264`).
- `finalCameraAnchor` is a camera value produced by the sim.
- `GAME_CONFIG.width/height` aspect is passed into the Final choreography
  (`:2129`).
- `itemFallingY` / `itemSurfaceY` are sim state stored next to the item
  containers.
- `scene.scale.gameSize` sets stage geometry (F8).
- Lava and Wind `update()` mixes the body mask/position with the rectangle
  visuals in one function.
- Not sim (safe to move): hit-spark seeds, swing flash and explosion frame
  counters, `textures.exists` placeholder alpha, `isFighterAnimationFrozen`,
  `stageBackground.tick`.

### 6c. Size and process

- MatchScene is 9,524 lines with 161 fields and dense one-line methods.
  Character is 14,211 lines. Both are mid-edit by the other AI, so the work
  starts at the gate from a committed tree and re-measures these line numbers.
- 170 of 242 `tools/*.mjs` drive `window.__game` and MatchScene internals
  (`playerSlots`, `cpuControllers`, `itemRegistry`, `projectiles`, ...).
  5.6 breaks them. Keep only what the DK/Pikachu/Link qualification probes
  need (aliases), and leave the rest to step 7.
- 2 physics tests AST-extract MatchScene methods by name and break on move
  (handled in 5.6).
- Per-sub-step size: 5.3 and 5.6a are the risky ones (globals, ordering).
  5.5 and 5.6b-e are long but mechanical, and the golden check makes them
  safe.

## 7. Waits for the gate, and port merges

Everything in step 5 edits `src/`, so all of it waits:

- golden hooks and `simDigest` in MatchScene and `stateChecksum.ts` (5.1);
- the new `src/physics/` modules, retyping of Character/fighters/attacks/stage
  modules, and deleting `HitboxScene`/`creatures/` (5.2-5.3);
- `vite.config.ts` `optimizeDeps` (5.3);
- splitting the stage modules, moving the lava factory into
  `entities/LavaHazard.ts` (5.4);
- every MatchScene change and the new `src/sim/` (5.5-5.8);
- fixing CLAUDE.md's replay-snapshot claim (F6) and its "Match runtime" line
  numbers.

Port changes to make then (from PLAN.md "Blocked on step 5" and "MERGE AT THE
GATE"):

- `port/src/arena/hazards/index.ts:5` stops importing
  `src/stages/LavaHazardRenderer` and uses the Phaser-free factory (5.4). The
  port then has no Phaser on its game path.
- `port/parity.html` / `entries/parity.ts` keep Phaser on purpose until step 9.
- `port/src/ui/model/matchRules.ts` (item frequency / Item Switch / Final
  rules) moves into `src/scenes/modeSelect.ts` at **step 4**, not step 5. It
  must have landed before 5.1 records the Final Smash golden replay, so the
  rule shape is final.
- `port/src/arena/presenter.ts`, `fighters/idlePoses.ts`,
  `ui/screens/{match,results}.ts` keep their own clock and sample data until
  step 6 wires `MatchSim`. `idlePoses.ts` then switches to the shared
  `fighterDraw()` (5.8) instead of its own copy of the presentation calls.

## 8. 2026-10-15 refresh

Measured 2026-10-15 01:16 CEST on a copy of the live tree (agent scratchpad
`step5-refresh/`). MatchScene: 8,795 lines. Character: 14,469 lines. At that
time A4.2 was wiring Link into MatchScene, FreshLink, the manifest and
PreloadScene, and B3 was about to collapse Link branches in Character.ts, so
those files were read-only for this refresh. Line numbers will move again;
re-anchor each change on method names.

### 8.1 Changes since §0–7

- Port step 4 is done: `CHARACTER_IDS = ['link','donkeykong','pikachu']`;
  11 fighters and LegacyLink are deleted.
- Link's articles live in `src/match/linkArticles.ts` (`LinkArticles`,
  snapshotted): sword beam, bombs, boomerang, arrows and the Ancient Arrow.
  MatchScene keeps only adapters (`linkArticleHost`, `linkArticleFighters`).
- DK's presentation is the shared `src/characters/packedBodyPresentation.ts`
  with per-fighter profiles.
- The gate merge landed: `src/physics/` (`PhysicsWorld`,
  `createMatterPhysicsWorld`, the vendored Matter in `src/physics/matter/`),
  `src/sim/{view,hudView}.ts` and `src/camera/cameraFraming.ts`.
  `CameraController` delegates to `cameraFraming`. The sprite driver sits on
  `artFrameSelector`.
- **New since the design: match history.** The other AI built
  `captureMatchHistoryCheckpoint` / `restoreMatchHistoryCheckpoint` (`src/replay/MatchHistoryCheckpoint.ts`):
  - Restore is `scene.restart({historyCheckpoint})`, then re-simulation of the
    recorded inputs up to the target frame (`historyRestore`, `update()` :6182).
  - The result is then checked against `captureMatchHistoryEvidence()`
    (`src/replay/MatchHistoryEvidence.ts`, `Character.getMatchHistoryEvidence()`).
    That is a strict canonical whole-world record: every scalar field of each
    Character, every Matter body including vertices and bounds, the live pairs,
    item and CPU history, input latches, support history and
    `captureFinalRuntimeSnapshot()`.
  - This is §4's "restore = deterministic re-simulation", already built.
    MatchSim must own it (5.6a).
- MatchScene now resets Phaser's reused Matter engine at the start of
  `create()` (:3857–3859): `Phaser.Physics.Matter.Matter.Engine.clear`, then
  timestamp and lastDelta set to 0. That is a Phaser **value** call on the sim
  path. A fresh `createMatterPhysicsWorld()` per match makes those three lines
  unnecessary.

### 8.2 Re-measured MatchScene (2026-10-15)

| What | 2026-10-13 | 2026-10-15 |
|---|---|---|
| Lines | 9,524 | 8,795 |
| Fields / methods | 161 / – | 157 / 124 (AST) |
| Phaser-typed fields | 35 | 26 |
| `create()` | 2,339 lines | 2,362 lines (:3797–6158) |
| `update()` step callback | ~1,220 lines | ~1,185 lines (:6195–7380) |
| `update()` render callback | ~560 lines | ~565 lines (:7381–7946) |
| Methods with render tokens (`this.add/cameras/textures/...`, containers, sprites) | – | 53 methods, 5,407 lines (including `create` and `update`) |
| Methods with none | – | 71 methods, 1,466 lines |
| `this.matter.*` | 24 | 30: `getAllBodies` 8, `world.on` 5, `body.setVelocity` 5, `autoUpdate` 3, `engine` 5 (new: history pairs, engine reset), `step` 1, `localWorld.gravity` 1, `setBounds?.` 1 (now an optional call), `setPosition` 1 |
| `this.add.*` | 80 | 79 (59 single-line, 20 multi-line) |
| registry / cameras / scale / textures / input / events / tweens / sound | 30 / – / – / 8 / – / 7 / 1 / – | 34 / 10 / 9 / 13 / 6 / 6 / 2 / 4 |
| Non-test `src` files importing Phaser | 84 | 71. Sim-path **value** imports: `BaseStage`, `StageRenderer`, `LavaHazardRenderer`, `WindHazardRenderer`, `StageBackgroundRenderer`, `MatchScene`. Type-only: `Character`, `DonkeyKong`, `Pikachu`, `FreshLink`, `characterFactory`, `fighterRegistry`, `entities/Fighter`, the animation drivers |
| `HitboxScene` references | 37 casts | 52 refs (38 in Character.ts) |

**Fixed-step order today** (step callback, :6195–7380; replaces §2):

| # | Line | Work | Class |
|---|---|---|---|
| 1 | 6197 | `sourceScreenKo` step | sim-owned presentation (checkpointed) |
| 2 | 6207 | `matchOverFrozen` gate | sim |
| 3 | 6268 | `finalSmashController.step` → `consumeFinalEvents` | sim |
| 4 | 6269 | `inputResolver.update` | host |
| 5 | 6271–6335 | per-slot input: `recordedInputs` (golden), CPU + ball/Final wrappers, or resolver / `historyRestore` timeline; then the `historyRestore` override of every live slot | CPU = sim, resolver = host |
| 6 | 6336–6356 | Final activation, `finalChoreography.beforeStep`, Final FX clock | sim |
| 7 | 6357–6368 | platform tops, `updatePlatforms`, ledge candidates, presentation clock | sim |
| 8 | 6369–6372 | slow input, remote bomb sync, `linkArticles.syncOwners` | sim |
| 9 | 6378–6390 | footstools | sim |
| 10 | 6391–6418 | `prepareItemInput` + `applyInput` | sim |
| 11 | 6419–6421 | prone-food / recovery events (before physics), **`inputCaptureBuffer.captureFrame`** | sim |
| 12 | 6423–6450 | ledge trump | sim |
| 13 | 6461, 6464 | `baseStage.tickHazards` (body + **visual** sync), `stageBackground.tick` | sim + **render** |
| 14 | 6471–6484 | Pikachu special entities | sim |
| 15 | 6485–6540 | `stepCharacterPhysics` (substeps, hurtbox sampling, separation) | sim |
| 16 | 6541–6552 | hammer start, held-item positions | sim |
| 17 | 6561–6562 | `applyHazardEffects`, remote bomb sync | sim |
| 18 | 6564–6788 | item spawn manager … inventory sweep; containers at :6626 | sim + **render** |
| 19 | 6789–6881 | projectile spawn, item shots | sim + **render** |
| 20 | 6882–6899 | swing flash | **render** |
| 21 | 6900–6906 | commit catches / items / recovery / food / DK heavy; `linkArticles.commit` + `step` | sim |
| 22 | 6908–7049 | thrown items | sim + **render** (container sync) |
| 23 | 7050–7055 | choreography `afterPhysics`, FX clock, `stepAncientArrows`, world items, Smash Ball | sim |
| 24 | 7058–7089 | `renderTraps`, swing-flash and explosion aging | **render** |
| 25 | 7090–7257 | projectile flight, sweeps, reflect / absorb / hit, `syncOwners` | sim + **render** |
| 26 | 7258–7316 | position KO scan, respawns, eliminations | sim |
| 27 | 7317–7334 | `matchRules.update`, `matchEndDetector.update` | sim |
| 28 | 7336–7378 | stop recording, replay, `ResultsScene` | host |

### 8.3 Sub-step status

| Sub-step | Status 2026-10-15 | Notes |
|---|---|---|
| 5.1 golden harness | **Done**, with deviations | `src/match/simDigest.ts`, `MatchScene.getSimDigest()` / `setRecordedInputs()`; `sim-golden.mjs` calls them. Deviation: its own FNV-1a 64 hash, not `stateChecksum.ts`. Not done: the Link and Final goldens (scenarios added now, not recorded). Last proof: 15/18 IDENTICAL on `index-p1zRT-JT.js`, 3 not rerun (`docs/review/2026-10-14/gate-followups/RESULT.md`). Superseded by proposal A below |
| 5.2 `PhysicsHost` retype | **Not done**, except the delete | `src/creatures/` deleted 2026-10-15. Still to do: Character's `scene` field retype and deleting `HitboxScene` + 38 casts (Character.ts, B3-owned tonight), plus `attacks.ts`, `pikachuSpecialRuntime`, the DK pose modules and their tests |
| 5.3 own Matter world | **Rehearsed** 6/6 IDENTICAL (`step5/REHEARSAL-5.3.md`); not landed | Facade at the top of `create()`. It needs `engine` (added to `PhysicsWorld`, see 8.6), `autoUpdate` (dropped) and `setBounds` (now optional). Delete the engine reset at :3857–3859. Rerun the rehearsal on the settled tree |
| 5.4 stage runtime | **Partly done** | Done: the one viewport transform (F8, `renderStage` takes `viewportSize`); the Phaser-free lava factory; Phaser-free lava/wind sensor bodies and their per-step sync (`hazardBodies.ts`). The port has no Phaser left on its game path. Open: split `renderStage` into bodies vs rectangles; BaseStage owning bodies through `PhysicsHost`; moving the hazard **visual** sync from `tickHazards` into `updateRender` |
| 5.5 visuals out of the step | Not started | Same 4 slices; rows 13, 18–20, 22, 24, 25 above |
| 5.6 extract MatchSim | Not started; 5.6d mostly done by others | `LinkArticles` and `ordinaryProjectileCheckpoint` are already modules. MatchSim also takes the history checkpoint/evidence (8.4 A) and the single input contract (8.4 B) |
| 5.7 headless runner | Not started | — |
| 5.8 render contract | **Partly done** | `src/sim/view.ts`, `hudView.ts`, `artFrameSelector`, `cameraFraming` exist; `fighterDraw()` and the Phaser render switch are open |

Invalidated by tonight's changes:
- §2 and §1 line numbers (use 8.2);
- §5.1 item 1: "extend `stateChecksum.ts`" (see A below);
- §5.6d's checkpoint pair. `captureFinalRuntimeSnapshot` now includes
  `linkArticles.snapshot()` and `ordinaryProjectiles`, and the Link fields
  moved into `LinkArticles`;
- §4's snapshot paragraph. Re-simulation restore exists, as match history;
- every golden recorded so far. They are bound to their build, and tonight's
  changes alter the simulation (8.5).

### 8.4 Two proposals (decide before re-recording)

**A. One canonical world record: golden digest = `fnv1a64(captureMatchHistoryEvidence())`.**

Today two whole-world canonical records exist side by side:
- `simDigest.buildSimRecord` + `canonicalJson`, for the goldens;
- `captureMatchHistoryEvidence` + `canonicalMatchHistoryEvidence`, for the
  history restore check.

That breaks the one-implementation rule, and the history record is the
stricter and richer of the two: all Character scalars, pairs, CPU and item
history, and latches.

Every golden must be re-recorded anyway (8.5), so the bit-for-bit argument
for keeping the old record no longer holds. The change:
1. Add `itemExplosions` (x, y, framesLeft, done, without the Phaser `area`)
   to the evidence. Today only simDigest has explosions.
2. `getSimDigest()` returns `{ text: evidence, hash: fnv1a64(evidence) }`.
3. Delete `buildSimRecord`, `canonicalJson`, `SimDigestSource` and
   `MatchScene.simDigestBaseBodyId`. The evidence uses the first platform
   body's id as its base. Keep `fnv1a64` in `simDigest.ts`, or fold it into
   `MatchHistoryEvidence.ts`.
4. `sim-golden.mjs` already diffs JSON dumps; the evidence is JSON, so it is
   unchanged.

Costs and checks:
- The evidence throws on non-finite numbers and opaque objects. A recording
  can fail loudly where the old record silently dropped the field. That is
  intended: it forces snapshot completeness.
- It is larger per frame (vertices, bounds, pairs), so measure record time
  on `ffa-items` (2,400 frames).
- Run the warmup and 144 Hz self-checks: the evidence normalises body ids and
  collision groups, so they should pass.

Lands with MatchScene edits, so it waits for B3.

**B. One recorded-input contract: CPU slots are always sampled; a given input overrides the output.**

Two recorded-input paths exist today:
- `setRecordedInputs` (goldens) **skips** the CPU and its ball/Final
  wrappers. This needed the `cpuBallAttackHeld` patch, and it will diverge on
  `cpuBallGoals` / `cpuFinalStrategies` as soon as a Smash Ball is in play.
  The Final golden cannot verify with it.
- `historyRestore` **runs** the CPU and wrappers, then overwrites every live
  slot with the recorded input (:6332). That rebuilds the CPU's private state
  exactly as the recording run had it.

Keep the second semantics only:
- `MatchSim.step(inputs)`: `inputs[i]` given means it wins; `null` means the
  slot's CPU output is used.
- A slot that has a CPU controller (from `matchConfig`, `inputType: 'ai'`)
  is sampled every step either way. Its wrappers' side effects happen as in
  the recording run.
- This fixes F7 the same way for goldens, history and VCR rewind.
- Delete `recordedInputs`, `setRecordedInputs`' special branch and the
  `cpuBallAttackHeld` patch. `setRecordedInputs` becomes a thin host call
  that installs the timeline the same way `historyRestore` does.

Cost: the CPU runs during verify, which the recording run did anyway.
`'final-ball'` (8.5) cannot be verified until B lands.

### 8.5 Golden plan

**Inventory**

| Set | Where | Bound to | State |
|---|---|---|---|
| 6 goldens of 2026-10-13 | `step5/golden/` | `index-2KfQg9H6.js` | stale, keep as history |
| 6 goldens of 2026-10-14 | `step5/golden-2026-10-14/` (+ `BASELINE.md`) | `index-Dy8I1zeM.js` | 18/18 after the gate merge; 15/18 after the digest move, 3 never rerun. Stale after tonight |
| Rehearsal 5.3 | `step5/REHEARSAL-5.3.md`, `rehearsal-5.3-verify.jsonl` | rehearsal builds | method to reuse |
| 28 item replays (v7, DK/Pikachu) | `docs/review/2026-10-11/ultimate-items/phase-*/replay*/` | old builds | input timelines with no hashes. Usable later as input-driven goldens (a `record --from-replay` mode, not built) |
| History acceptance | `tools/match-history-{checkpoint,targeted}-acceptance.mjs` | candidate URL + bundle sha | gated by `PF_FINAL_VERIFICATION_READY=1`; separate gate |

Tools: `port/scripts/golden/scenarios.mjs` (scenarios),
`port/scripts/golden/sim-golden.mjs` (`record` / `verify --warmup N --hz H`)
and `tools/replay-resim.mjs` (trace a `.replay.json`; it double-applies the
CPU wrappers, F7, so it is not a golden tool).

**Scenarios** (`scenarios.mjs`, Hard CPUs, seed 20261013): flat-items, lava,
moving, wind, crumbling, ffa-items, plus three added 2026-10-15 and not yet
recorded:
- `link-dk`: Link vs DK, flat, no items;
- `link-pikachu-items`: Link vs Pikachu, flat, items high;
- `final-ball`: Link vs DK vs Pikachu, items high, Smash Ball and meter on,
  3,600 frames.

**What tonight shifts** (so nothing recorded earlier can be compared):
- `SIMULATION_BUILD_ID`: `src/` changed, including this refresh's stage
  modules;
- the 367 autolink angle now uses the attacker's momentum (SmashWiki
  Autolink_angle). That changes DK and Pikachu 367 moves, which appear in
  every DK/Pikachu golden;
- B3: trip stand and intangibility, shield-break pop-up / jump / wake-up, and
  ledge timings on the shared paths. Any golden with a trip (banana peel in
  the item scenarios) or a shield break shifts;
- Link is now drawn and wired (A4.2); the Link scenarios are new;
- `captureFinalRuntimeSnapshot` changed shape (Link fields moved into
  `linkArticles`, `ordinaryProjectiles` added), so the `finals` section of
  every record changes;
- proposal A changes the digest schema itself;
- the hazard body sync was refactored (`hazardBodies.ts`) without changing
  formulas or write order. The lava/wind/flat goldens are the proof.

**Re-record and verify procedure (coordinator, once A4.2 and B3 have landed)**

1. Decide A and B. If adopted, land them first; B is required for `final-ball`.
2. `npm run typecheck && npm run build`, then `npm run preview` (serves
   `dist/` on :4173 under `/platform-fighter/`). Note the bundle name
   (`index-*.js`) and its sha256. Do not let another agent rebuild `dist/`
   until step 5 is done: on 2026-10-14 a shared rebuild invalidated 3 checks.
3. Record, under the repo's `flock .tmp/dk-heavy.lock`, from `port/scripts/golden/`:
   ```bash
   export PF_GAME_URL=http://127.0.0.1:4173/platform-fighter/
   export PF_GOLDEN_DIR=$PWD/../../../docs/review/2026-10-13/threejs-port/step5/golden-2026-10-15
   node sim-golden.mjs record all 2>&1 | tee $PF_GOLDEN_DIR/record.log
   ```
   Each line must show `errors: 0`, and `frames` must equal the scenario's
   frames. Fewer frames means the match ended early, which is fine only if
   the log says so.
4. Verify every golden against itself on the same bundle, three ways:
   ```bash
   for g in $PF_GOLDEN_DIR/*.json; do
     node sim-golden.mjs verify $g
     node sim-golden.mjs verify $g --warmup 600
     node sim-golden.mjs verify $g --hz 144
   done 2>&1 | tee $PF_GOLDEN_DIR/verify-baseline.raw
   ```
   Pass condition: 27/27 IDENTICAL (9 scenarios × 3). A divergence here is a
   determinism bug; fix it before trusting any comparison. Without B,
   `final-ball` is expected to diverge on the CPU's ball state, so record the
   other 8 (24/24) and add `final-ball` after B.
5. Write `golden-2026-10-15/BASELINE.md`: bundle, sha256, build id, the
   commands, the results. Then add a PLAN.md log line.
6. From then on, every 5.x sub-step: rebuild, then `verify` all goldens
   (plain is enough per slice; all three modes at each sub-step end). A
   change that alters the simulation on purpose means re-recording, never
   comparing across builds.

### 8.6 New modules this refresh (2026-10-15)

All Phaser-free, outside the read-only files. Targeted tests pass: the 4
new or changed test files, plus all of `src/stages` and `src/entities` (31
files, 834 tests), `CustomStageScene` and `LavaCollisionWatcher`. tsc has not
been run on these changes; it is in the coordinator's combined pass.

- `src/stages/stageViewport.ts` (+ test) holds the one
  `computeStageViewportTransform`. It replaces 3 identical copies
  (`renderStage`, the `BaseStage` constructor, `LavaHazardRenderer`, which
  re-exports it). `StageRenderOptions.viewportSize?` is new, and BaseStage
  passes its own viewport to `renderStage`, so bodies and transform always
  agree (F8). The live game is unchanged: MatchScene passes no viewport, so
  both still use `scene.scale.gameSize`.
- `createLavaHazardFromStageHazard` (+ `LavaStageHazardLike`) moved into
  `src/entities/LavaHazard.ts`, next to the wind factory; `LavaHazardRenderer`
  re-exports it. `port/src/arena/hazards/index.ts` imports it from the
  entity, so the port has no Phaser on its game path (PLAN "Blocked on
  step 5", item 1).
- `src/stages/hazardBodies.ts` (+ test on the real `createMatterPhysicsWorld`)
  holds `createLavaHazardBody` / `syncLavaHazardBody` and
  `createWindHazardBody` / `syncWindHazardBody`: the simulation half of the
  hazards, with the same body options, formulas and write order as before.
  The Phaser renderers call them and only draw rectangles from the returned
  geometry.
  - Recorded quirk: the sync writes `position` and `vertices` in place and
    never updates `bounds` (static bodies are not run through `Body.update`).
    MatchSim keeps it verbatim; changing it would shift the goldens.
- `PhysicsWorld.world.engine` (`PhysicsEngineState`: `pairs.list`,
  `timing.timestamp`) is implemented by `createMatterPhysicsWorld`, with a
  test. MatchScene's history evidence and its engine reset read
  `this.matter.world.engine`, so the 5.3 facade needs it.
- `src/creatures/` deleted (dead code, F2, 5.2). The doc comment at
  `src/actors/Actor.ts:13` still points to it and is left as is.

### 8.7 Remaining order and estimate

Everything below edits MatchScene or Character, so it starts after A4.2
and B3 land. 0.5 d is about one agent-day.

| # | Sub-step | Estimate | Verification |
|---|---|---|---|
| 0 | Re-record the goldens (8.5), after A and B | 0.5 d (A 0.5 d, B 0.5 d before it) | 24/24, then 27/27 IDENTICAL |
| 1 | 5.3 own world: facade in `create()`, drop the engine reset and `autoUpdate` | 0.5 d | goldens; rehearsal rerun; dev server boots |
| 2 | 5.2 retype: Character `scene` → `PhysicsHost`, delete `HitboxScene` + casts | 0.5 d | tsc; physics tests; goldens |
| 3 | 5.4 rest: `renderStage` bodies vs rectangles, BaseStage over `PhysicsHost`, hazard visuals into `updateRender` | 1 d | goldens; stage tests |
| 4 | 5.5 visuals out of the step (4 slices: hit/sfx events, projectiles, items, traps/flash/explosions + `diveLanding`) | 2 d | goldens per slice; screenshots |
| 5 | 5.6 extract `src/sim/MatchSim.ts`: a shell with world/stage/fighters/controllers/recording/history (A, B), items, projectiles + thrown, Final runtime (Link articles already out), CPU path | 3.5 d | goldens per slice; tsc; probes on `scene.sim` |
| 6 | 5.7 headless runner (`tools/sim-replay.ts`, `goldenReplays.test.ts`, import-graph test, steps/s) | 1 d | Node vs browser hashes identical |
| 7 | 5.8 `fighterDraw()`, Phaser render on `SimView` | 1 d | parity capture |

**Total remaining:** about 10.5 working days (range 8–14), down from 14. 5.1
and the parts of 5.4 and 5.8 above are done, and 5.6d is mostly done. Match
history adds about half a day to 5.6a, because MatchSim must own the
restart-and-resimulate restore.

**What the extraction needs once A4.2 and B3 land** (moves, not copies):
- MatchScene's `create()` sim part (stage, fighters, controllers, listener
  registration order: fighters' listeners before the scene's :4895–4938)
  moves to `MatchSim.create(options)`. The host keeps the bindings store,
  `InputResolver`, camera, HUD, audio, pause and the music toggle.
- Step rows 1–27 (8.2) move to `MatchSim.step`. Rows 4 and 28 stay in the
  host; the render rows go to the render callback first (5.5).
- `captureMatchHistory{Evidence,Checkpoint}`, `finishMatchHistoryRestore`,
  `captureFinalRuntimeSnapshot` / `restore…`, `getSimDigest` and
  `buildCpuWorld` with its wrappers move to MatchSim. The host keeps only the
  `scene.restart` and the pause-menu relaunch of a restore.
- The `passThrough` / `upperPlatformRecovery` physics tests that extract
  MatchScene methods by AST point at the moved functions.
- `window.__game` probes: alias `scene.sim` fields only where the DK, Pikachu
  and Link qualification probes need them (step 7).
