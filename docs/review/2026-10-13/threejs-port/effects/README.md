# Match effects and simulation-driven animation in the port (2026-10-13)

## Effects (from the game's own formatters)

- `engine/shapes/shapeLayer.ts` draws immediate-mode circles (fill plus an
  anti-aliased stroke in one shader), lines and boxes in design px, pooled.
  The old `match/fxLayer.ts` is replaced and deleted.
- In `match/effects/`, each effect draws exactly what its formatter returns:
  - `damageAreas.ts`: blast discs and projectile hit boxes at their real
    areas (additive);
  - `hitSparks.ts`: `computeHitSparkVisual` (core plus shards, aged in
    simulation frames, at most 24 live);
  - `fighterOverlays.ts`: `computeShieldBubbleVisual`, and the charge bar as
    `ChargeIndicator` applies `computeChargeIndicatorVisual` (bar only,
    track 0x101014). The labelled readout comes with step 6.
- `SimView` gains a `hit {x, y, damage, seed}` event, plus each fighter's
  `body`, `chargeProgress` and `shield`.
- Captures: `sandbox-f150` (shield), `-f172` (blast spark), `-f480` (shot
  spark), `-f575` (charge bar).

## Explosion art

- `match/effects/explosionArt.ts` draws MatchScene's `spawnExplosionArt`:
  - the additive 3-frame burst, 18 frames with compounding growth, fading
    on the smoke frame;
  - 12 embers under gravity and 5 rising smoke puffs, with the same
    constants.
- It is a pure function of the blast's age, driven by a new `explosion`
  event. The burst sits on an effect sprite layer above the smoke and
  embers, as depth 7 is above 5 and 6.
- The sprite layer gained `blend: 'add'` and a render-order base. Phaser
  parity is unchanged: max diff 1, 0 pixels over 2.
- Captures `sandbox-f171/176/182/192`: flash, then fireball and embers, then
  smoke rising and embers falling, then fading.

## Animation from simulation snapshots

- `pending/characters/artFrameSelector.ts`:
  - `createArtFrameSelector` is the Phaser sprite driver's art choice
    without the sprite.
  - `characterAnimationSheets` is the animation list the game registers.
  - `MANIFEST_ART_CATALOG` gives the frame counts without Phaser.
- `artFrameSelector.check.ts` drives the real `createSimulationSpriteAnimationDriver`
  and the selector with the same 160-snapshot sequences. These cover DK jab,
  DK forward smash and Pikachu jab, through idle, run, jump and fall, an
  attack with hitlag, a freeze, a rewind and hitstun. Every pose is
  identical.
- `FighterView.animation` is now the `SimulationAnimationSnapshot`, as
  STEP5-DESIGN §4 says. `MatchView` keeps one selector per fighter and
  places the pose with the sheet metrics MatchScene uses (`fighterDrawFromArt`).
  The menus' idle poses share the same metrics table.
- Pikachu's Skull Bash and Quick Attack body rotation, rebased on
  `PIKACHU_*_ROT_PIVOT` as MatchScene does. `fighters/poses.check.ts`
  proves the rebase leaves the image in place for both facings.
- Captures: `sandbox-f60` (DK run), `-f150` (Pikachu shield pose),
  `-f200` (tumble), `-f480` (DK hurt), `-f575` (DK smash charge),
  `-f610` (smash swing).

## Left for the gate (code still being edited by the other agent)

- **Item poses.** `MatchScene.syncHeldItemRender` handles generic weapons
  (socket, grip at the bottom, mirrored, foreshortened by `length`) plus
  containers, recovery items and Link articles. Extract it to a pure item
  presentation once items phases 9–10 land, then fill `ItemView` from it.
- **Traps:** fresh Link's bombs (`MatchScene.renderTraps`).
- **Fresh Link's body pose:** `getLinkBodyPose`, and Final Smash poses.
