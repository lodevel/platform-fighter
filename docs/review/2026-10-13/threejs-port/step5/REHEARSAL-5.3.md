# Rehearsal: sub-step 5.3 (own Matter world), 2026-10-13

This was done before the gate, on scratch copies of the tree; the real `src/`
was not touched. The question it answers: if MatchScene runs on the port's
`createMatterPhysicsWorld()` instead of Phaser's built-in Matter world, do
matches stay bit-identical?

**Answer: yes, 6 of 6 golden scenarios are `IDENTICAL`.**

## Method

1. **Snapshot.** One copy of `src/` was taken at 19:3x, while the other agent
   was mid-edit. Today's tree does not boot: the fresh Link's data fails
   validation (`link.fair` auto-cancel `endFrame: null`, `link.side_special`
   boomerang). Two rehearsal-only patches went into **both** copies:
   - an open-ended auto-cancel window becomes frame 9999;
   - a validation error that names a Link move warns instead of throwing.

   The goldens use DK and Pikachu only. `publicDir` was turned off and the
   assets were symlinked, to keep builds fast.
2. **A, the baseline:** the snapshot, built (`index-DVsxOSC2.js`) and served
   on :4197.
3. **B, the swap:** the snapshot plus the port's `physics/` modules. The first
   statement of `MatchScene.create()` replaces the scene's `matter` with a
   facade over `createMatterPhysicsWorld()`:
   `{ add, body, world: { ...own.world, autoUpdate: false, setBounds: noop } }`.
   Built as `index-Bd2075Or.js`, served on :4196. A and B differ only by
   that change.
4. **Recording and verification:** the six goldens were recorded on A with
   `sim-golden.mjs record all` and verified on B.

## Results

- **B against A's goldens:** flat-items, lava, moving, wind and crumbling
  (1,800 frames each) and ffa-items (2,400 frames, 4 players): **all
  `IDENTICAL`**, with no page errors. Details in `rehearsal-5.3-verify.jsonl`.
- **The swap is live in B.** In a started match on A, `scene.matter` is
  Phaser's plugin and holds the 12 bodies. On B it is the facade: it holds
  all 12 bodies, including the fighters, and Phaser's world holds **0**.
- **The comparison is sensitive.** A control build of B with the new world's
  step 1% longer **DIVERGES at frame 1**: body positions differ in the 3rd
  decimal.
- **Finding:** a control that only changed `Resolver._restingThresh`
  (4 → 2) stayed `IDENTICAL` on lava.
  - The resolver globals (STEP5-DESIGN F4) have no observable effect in
    these scenarios. Fighter motion is set by velocity each frame.
  - Keep setting them anyway, for parity with Phaser.
- **The Matter fork** (`phaser/src/physics/matter-js/CustomMain.js`) bundles
  in a production `vite build` with no config change. Dev-server
  pre-bundling was not exercised.

## Consequence for the gate

5.3 can land as this facade: one block at the top of `create()` plus the
`src/physics/` modules. The 24 `this.matter.*` call sites move over without
being edited, because they read `this.matter`. 5.2 (the `PhysicsHost` retype
and removing the `HitboxScene` casts) stays a type-only change.

At the gate, rerun this rehearsal on the settled tree, which must then boot
without the patches.

## Follow-up the same day: vendored Matter (step 9 prerequisite)

- `port/scripts/vendor-matter.mjs` copies the fork byte for byte into
  `port/src/pending/physics/matter/source/`: 28 files, MIT licences
  included, and `--check` re-verifies them against `node_modules`. It then
  generates one ES module, `matter.js`, with esbuild.
- `createMatterPhysicsWorld` imports that bundle instead of
  `phaser/src/physics/matter-js/CustomMain.js`.
  - `matter.d.ts` replaces the old module shim.
  - The port tests now compare the bundle with an engine hand-built from
    the vendored CommonJS sources. 18/18 pass.
- **Rehearsal build B with the vendored bundle** (`index-DM1Vf0AZ.js`)
  against A's goldens: crumbling, ffa-items, flat-items, lava, moving, wind
  are **6/6 `IDENTICAL`**, with 0 page errors.
- The game's physics no longer depends on the `phaser` package.
- Still to do in step 9: the global `MatterJS` type declarations
  (`phaser/types/matter.d.ts`, 5,264 lines). Copy them in and replace the
  four `Phaser.GameObjects.GameObject` references with `unknown`.
